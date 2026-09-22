# OAuth read_api Fork Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить PAT-авторизацию расширения на OAuth 2.0 authorization code + PKCE со скоупом `read_api`, прибитым в коде, и свести поддержку к одному инстансу gitlab.com.

**Architecture:** Чистое ядро PKCE выносится в `src/background/auth/pkce.ts` без браузерных зависимостей — оно единственное покрыто тестами. Браузерно-связанный слой (`launchWebAuthFlow`, хранилище) живёт в `src/background/auth/oauth.ts`. Токен добывается ровно в одной точке — `initGitlabApi`, которая становится `async`; остальные модули про OAuth не знают. Мультиаккаунт сохраняется: OAuth-токены лежат внутри существующего `Account`, структура `accounts: Account[]` не трогается.

**Tech Stack:** TypeScript 5.4, React 18, `@gitbeaker/rest` 40, `@primer/react` 36, parcel 2.12, localforage, webextension-polyfill, MV3.

**Spec:** `docs/superpowers/specs/2026-09-22-gitlab-notify-oauth-fork-design.md`

## Global Constraints

- Целевой инстанс — только `https://gitlab.com`. Никакой конфигурируемости хоста.
- OAuth scope — ровно `read_api`. Никаких write-вызовов к GitLab API.
- Application ID (public PKCE client, не секрет, коммитится): `218dec9a8f0b8feb3e371cd3c760fdf0d69f1072f846984f0f543ac7f7cfb07f`
- Redirect URI (посимвольно, слэш на конце значим): `https://kgkmfbiljlfababkljfakpjmlpldogie.chromiumapp.org/`
- Extension ID: `kgkmfbiljlfababkljfakpjmlpldogie`. Публичный ключ для манифеста — в `extension-key.pub.b64` в корне репозитория. Приватный ключ `extension-key.pem` — в `.gitignore`, **никогда не коммитить**.
- Client secret не используется и нигде не хранится.
- Access token GitLab живёт 7200 с; обновляемся с запасом 60 с до истечения.
- pnpm не в PATH. Полный путь: `C:\Users\Egor.Gorlin\AppData\Local\Microsoft\WinGet\Packages\pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe\pnpm.exe`. Далее в плане — `$PNPM`.
- Ветка работы: `oauth-readonly`. Коммиты частые, по одному на задачу.
- После каждой задачи `$PNPM run lint` (это `tsc --noEmit` + eslint) должен проходить.

---

## File Structure

| Файл | Ответственность |
|---|---|
| `src/background/auth/pkce.ts` | **создать.** Чистые функции: генерация verifier, S256-challenge, проверка окна протухания, single-flight. Без браузерных API кроме Web Crypto. |
| `src/background/auth/pkce.test.ts` | **создать.** Единственный тест-файл, `node --test`. |
| `src/background/auth/oauth.ts` | **создать.** `login`, `logout`, `getFreshAccessToken`. Знает про `browser.identity` и хранилище. |
| `src/config/config.prod.ts` | **изменить.** Константы инстанса и OAuth-клиента. |
| `src/manifest/manifest.json` | **изменить.** `identity`, `host_permissions`, `key`. |
| `src/common/types.ts` | **изменить.** Тип `Account`. |
| `src/common/storage/configuration.ts` | **изменить.** `defaultEmptyAccount`, выпилить legacy-миграцию. |
| `src/background/utils/initGitlabApi.ts` | **изменить.** Становится `async`, отдаёт `oauthToken`. |
| `src/common/errors.ts` | **изменить.** Удалить `GitLabAddressNotSet`, `GitLabIsCE`. |
| `src/manifest-v2/`, `src/background/endpoints/setTodoAsDone.ts` | **удалить.** |

---

## Task 1: Выпилить MV2/Firefox и снять базовую линию сборки

Задача сознательно идёт первой: она разом проверяет, что тулчейн жив (node v24 против parcel 2.12 — риск из спеки), и даёт первый зелёный коммит.

**Files:**
- Delete: `src/manifest-v2/manifest.json` (и каталог `src/manifest-v2/`)
- Modify: `package.json`

**Interfaces:**
- Consumes: ничего.
- Produces: рабочая сборка `dist/mv3`. Скрипт `$PNPM run build:dev` — точка проверки для всех последующих задач.

- [ ] **Step 1: Разрешить сборочные скрипты, которые нужны parcel**

pnpm 12 по умолчанию блокирует postinstall-скрипты и валит установку с `ERR_PNPM_IGNORED_BUILDS`. Parcel'у нужны нативные модули `@swc/core`, `lmdb` и `msgpackr-extract`.

Механизм этой версии — `allowBuilds` в `pnpm-workspace.yaml`, **не** `pnpm.onlyBuiltDependencies` в `package.json`. Файл pnpm уже создал сам, с заглушками. Привести его к виду:

```yaml
allowBuilds:
  '@swc/core': true
  lmdb: true
  msgpackr-extract: true
```

Разрешаем ровно три пакета, а не «всё подряд»: `pnpm approve-builds --all` открыл бы постинсталл-скрипты всему дереву зависимостей.

Файл должен попасть в коммит задачи — без него установка у любого другого не пройдёт.

- [ ] **Step 2: Установить зависимости и убедиться, что сборка проходит ДО изменений**

```bash
cd /c/Development/extrade/3rd-party/git-notify-extension
PNPM="C:/Users/Egor.Gorlin/AppData/Local/Microsoft/WinGet/Packages/pnpm.pnpm_Microsoft.Winget.Source_8wekyb3d8bbwe/pnpm.exe"
"$PNPM" install
"$PNPM" run copy-config:prod
"$PNPM" run build:dev
```

Ожидается: установка без `ERR_PNPM_IGNORED_BUILDS`, `dist/mv3` создан. Если parcel падает на node v24 — переключиться на node 18 (`nvm use 18`) и повторить; это запасной ход, зафиксированный в спеке. Не двигаться дальше, пока сборка не зелёная.

- [ ] **Step 3: Удалить каталог MV2**

```bash
git rm -r src/manifest-v2
```

- [ ] **Step 4: Вычистить MV2 из `package.json`**

Удалить ключ `targets.mv2` целиком:

```json
    "targets": {
        "mv3": {
            "source": "src/manifest/manifest.json",
            "context": "service-worker",
            "sourceMap": false
        }
    },
```

Заменить три скрипта:

```json
        "build:prod": "rm -rf dist/; pnpm run copy-config:prod; pnpm run build:prod:mv3",
        "zip": "pnpm run zip:chrome; pnpm run zip:edge; pnpm run zip:source",
```

Удалить строки `"build:prod:mv2"` и `"zip:firefox"` полностью.

Заменить `browserslist`:

```json
    "browserslist": [
        "last 2 Chrome versions"
    ],
```

- [ ] **Step 5: Пересобрать и проверить, что ничего не отвалилось**

```bash
"$PNPM" run lint
"$PNPM" run build:dev
```

Ожидается: оба зелёные, `dist/mv3` на месте, `dist/mv2` не создаётся.

- [ ] **Step 6: Коммит**

```bash
git add -A
git commit -m "chore: drop MV2/Firefox target, Edge-only fork"
```

---

## Task 2: Удалить write-поверхность (`setTodoAsDone`)

Единственная write-операция расширения. Несовместима с `read_api`, поэтому уходит целиком — вместе с кнопками, которые её дёргают.

**Files:**
- Delete: `src/background/endpoints/setTodoAsDone.ts`
- Modify: `src/background/endpoints/index.ts:4`, `src/background/index.ts:2,74-76`, `src/popup/pages/Todos.tsx`, `src/popup/components/TodoItem.tsx`

**Interfaces:**
- Consumes: ничего.
- Produces: сообщение `{ type: 'setTodoAsDone' }` больше не существует ни на одной стороне.

- [ ] **Step 1: Удалить endpoint и его реэкспорт**

```bash
git rm src/background/endpoints/setTodoAsDone.ts
```

`src/background/endpoints/index.ts` целиком становится:

```ts
export * from './getLatestDataFromGitLab';
export * from './getMembersOfGroup';
export * from './getProjectsList';
```

- [ ] **Step 2: Убрать обработчик сообщения из background**

В `src/background/index.ts` строка 2 — убрать `setTodoAsDone` из импорта:

```ts
import { getMembersOfGroup, getProjectsList } from './endpoints/index.js';
```

Удалить блок (строки 74-76):

```ts
    if (message.type === 'setTodoAsDone') {
        return setTodoAsDone(message.accountUuid, message.todoId);
    }
```

- [ ] **Step 3: Убрать кнопку «Mark all as done»**

`src/popup/pages/Todos.tsx` целиком становится:

```tsx
import { ActionList } from '@primer/react';
import { TodoItem } from '../components/TodoItem';
import { EmptyItems } from '../components/EmptyItems';
import { TodoSchema } from '@gitbeaker/rest';

interface Props {
    todos: TodoSchema[];
}

export const Todos = (props: Props): JSX.Element => {
    const todosLength = props.todos.length;

    if (!props.todos || todosLength === 0) {
        return <EmptyItems />;
    }

    return (
        <>
            {todosLength > 1 ? (
                <div className={'subNav'}>
                    <p className={'subNavText'}>{todosLength} tasks to complete</p>
                </div>
            ) : null}
            <ActionList className={'mrList'}>
                {props.todos.map((todo: TodoSchema) => (
                    <TodoItem todo={todo} key={todo.id} />
                ))}
            </ActionList>
        </>
    );
};
```

- [ ] **Step 4: Убрать кнопку с каждого todo**

В `src/popup/components/TodoItem.tsx` удаляются: импорты `useCallback`/`useState`, `browser`, `Button`, `Tooltip`, `CheckIcon`, `ErrorFlash`; состояния `visibility` и `error`; колбэк `setTodoAsDone`; блок `<Box display={'flex'}>` с кнопкой; строка с `{error ? <ErrorFlash .../> : <></>}`. Класс элемента перестаёт зависеть от `visibility`.

Шапка файла становится:

```tsx
import { Avatar, Box, ActionList, Label, Link, Text } from '@primer/react';
import { ClockIcon } from '@primer/octicons-react';
import { calculateTimeElapsed } from '../helpers';
import { createNewTab } from '../utils/createNewTab';
import { TodoSchema } from '@gitbeaker/rest';
```

Тело компонента становится:

```tsx
export const TodoItem = (props: Props) => {
    const { todo } = props;

    const timeElapsed = calculateTimeElapsed(todo.created_at);

    return (
        <ActionList.Item className={'mrItem'}>
            <Box display="flex" flexWrap="wrap">
                <Box className={'avatarsList'}>
                    <Avatar src={todo.author.avatar_url} alt={todo.author.name} square size={40} sx={{ mr: 2 }} />
                </Box>
                <Box mr={2} style={{ flex: 1 }}>
                    <Link
                        as="a"
                        href={todo.target_url}
                        onClick={(event: React.MouseEvent<HTMLElement>) => createNewTab(event, todo.target_url)}
                        className={'mrTitle'}
                    >
                        {actionToText(todo.author.name, todo.action_name)} !{String(todo.target.iid)}
                    </Link>
                    <div>
                        <Text className={'todoBody'} title={todo.body}>
                            &#34;{todo.body}&#34;
                        </Text>
                        <Label size="small" sx={{ color: 'neutral.emphasis' }} className={'mrLabel'}>
                            <ClockIcon /> &#160;{timeElapsed}
                        </Label>
                    </div>
                </Box>
            </Box>
        </ActionList.Item>
    );
};
```

`actionToText` и `interface Props` остаются без изменений.

- [ ] **Step 5: Проверить и закоммитить**

```bash
"$PNPM" run lint && "$PNPM" run build:dev
git add -A
git commit -m "feat: remove write surface, read_api compatible"
```

Ожидается: lint зелёный. Если eslint ругается на неиспользуемый импорт — значит что-то из шага 4 не дочищено.

---

## Task 3: Удалить режим GitLab CE

На gitlab.com корпоративного тарифа approvals есть всегда, ветвление мертво. Заодно уходит первое поле из `Account`.

**Files:**
- Modify: `src/background/utils/fetchMRExtraInfo.ts`, `src/background/endpoints/getLatestDataFromGitLab.ts:131,159`, `src/common/errors.ts`, `src/common/types.ts:45`, `src/common/storage/configuration.ts:63,81`, `src/config/config.prod.ts`, `src/options/components/Account.tsx:50-60`

**Interfaces:**
- Consumes: ничего.
- Produces: `fetchMRExtraInfo({ gitlabApi, mrList })` — параметр `gitlabCE` исчезает из сигнатуры. Поле `Account.gitlabCE` исчезает.

- [ ] **Step 1: Упростить `fetchMRExtraInfo`**

Шапка `src/background/utils/fetchMRExtraInfo.ts` становится:

```ts
import {
    ExpandedMergeRequestSchema,
    MergeRequestLevelMergeRequestApprovalSchema,
    MergeRequestSchemaWithBasicLabels
} from '@gitbeaker/rest';
import { GitlabAPI, MergeRequestsDetails } from '../../common/types';

interface FetchMRExtraInfoParams {
    gitlabApi: GitlabAPI;
    mrList: MergeRequestSchemaWithBasicLabels[];
}

export const fetchMRExtraInfo = async (params: FetchMRExtraInfoParams): Promise<MergeRequestsDetails[]> => {
    const { gitlabApi, mrList } = params;
```

Блок `requestsToExecute` (строки 22-46) становится:

```ts
    const requestsToExecute = mrList.map((mr) =>
        Promise.all([
            gitlabApi.MergeRequests.show(mr.project_id, mr.iid) as Promise<ExpandedMergeRequestSchema>,
            gitlabApi.MergeRequestApprovals.showConfiguration(mr.project_id, {
                mergerequestIId: mr.iid
            }) as Promise<MergeRequestLevelMergeRequestApprovalSchema>
        ])
    );
```

Блок `mrWithDetails` (строки 50-62) становится:

```ts
    const mrWithDetails = mrDetails.map((mr) => ({
        ...mr[0],
        approvals: mr[1]
    }));
```

Проверка `if (approvals instanceof Error) throw new GitLabIsCE()` удаляется: `Promise.all` при отказе реджектится, а не отдаёт `Error` значением, поэтому ветка была недостижима.

- [ ] **Step 2: Убрать `gitlabCE` из вызовов**

В `src/background/endpoints/getLatestDataFromGitLab.ts` два вызова, строки 128-132 и 156-160. Оба теряют последний аргумент:

```ts
                fetchMRExtraInfo({
                    gitlabApi,
                    mrList: requests
                }),
```

```ts
                fetchMRExtraInfo({
                    gitlabApi,
                    mrList: mrGiven
                }),
```

- [ ] **Step 3: Убрать класс ошибки**

Из `src/common/errors.ts` удалить целиком:

```ts
export class GitLabIsCE extends GlobalError {
    constructor() {
        super('GitLabIsCE', 'You are likely using GitLab CE.\nPlease check the box in the options.');
    }
}
```

- [ ] **Step 4: Убрать поле из типа, дефолта и конфига**

`src/common/types.ts` — убрать строку `gitlabCE: boolean;` из `interface Account`.

`src/common/storage/configuration.ts` — убрать `gitlabCE: false,` из `defaultEmptyAccount` и `gitlabCE: Boolean(account.gitlabCE),` из legacy-блока.

`src/config/config.prod.ts` — убрать `gitlabCE: false,` из закомментированного примера.

- [ ] **Step 5: Убрать чекбокс из UI**

В `src/options/components/Account.tsx` удалить `FormControl` целиком (строки 50-60, от `<FormControl>` до `</FormControl>` включая `Checkbox` с `name="gitlabCE"`).

- [ ] **Step 6: Проверить и закоммитить**

```bash
"$PNPM" run lint && "$PNPM" run build:dev
git add -A
git commit -m "feat: drop GitLab CE mode, approvals always available"
```

---

## Task 4: Чистое ядро PKCE с тестами

Единственная задача с TDD-циклом — здесь живёт вся нетривиальная логика.

**Files:**
- Create: `src/background/auth/pkce.ts`
- Create: `src/background/auth/pkce.test.ts`

**Interfaces:**
- Consumes: ничего (только Web Crypto из `globalThis`).
- Produces:
  - `createVerifier(): string`
  - `challengeFromVerifier(verifier: string): Promise<string>`
  - `needsRefresh(expiresAt: number, now?: number): boolean`
  - `createSingleFlight<V>(): (key: string, fn: () => Promise<V>) => Promise<V>`
  - `REFRESH_MARGIN_MS: number` (значение `60_000`)

- [ ] **Step 1: Написать падающий тест**

Создать `src/background/auth/pkce.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeFromVerifier, createVerifier, needsRefresh, createSingleFlight } from './pkce.ts';

test('challengeFromVerifier соответствует эталону RFC 7636 Appendix B', async () => {
    const challenge = await challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('createVerifier даёт base64url без паддинга длиной в допустимом диапазоне', () => {
    const verifier = createVerifier();
    assert.match(verifier, /^[A-Za-z0-9\-_]+$/);
    assert.ok(verifier.length >= 43 && verifier.length <= 128, `длина ${verifier.length} вне 43..128`);
    assert.notEqual(verifier, createVerifier());
});

test('needsRefresh уважает окно в 60 секунд', () => {
    const now = 1_000_000;
    assert.equal(needsRefresh(now + 61_000, now), false, 'до окна обновляться не должны');
    assert.equal(needsRefresh(now + 59_000, now), true, 'внутри окна обновляемся');
    assert.equal(needsRefresh(now - 1, now), true, 'протухший токен обновляем');
});

test('createSingleFlight схлопывает параллельные вызовы по одному ключу', async () => {
    let calls = 0;
    const flight = createSingleFlight<string>();
    const slow = () =>
        new Promise<string>((resolve) => {
            calls += 1;
            setTimeout(() => resolve('token'), 10);
        });

    const [a, b] = await Promise.all([flight('same', slow), flight('same', slow)]);

    assert.equal(a, 'token');
    assert.equal(b, 'token');
    assert.equal(calls, 1, 'должен быть ровно один сетевой вызов');
});

test('createSingleFlight не мешает разным ключам и отпускает после ошибки', async () => {
    const flight = createSingleFlight<string>();
    let calls = 0;
    const fn = () => {
        calls += 1;
        return Promise.resolve('x');
    };

    await Promise.all([flight('a', fn), flight('b', fn)]);
    assert.equal(calls, 2, 'разные ключи не схлопываются');

    await assert.rejects(flight('c', () => Promise.reject(new Error('boom'))));
    await flight('c', fn);
    assert.equal(calls, 3, 'после отказа ключ должен освободиться');
});
```

- [ ] **Step 2: Запустить тест и убедиться, что он падает**

```bash
node --test src/background/auth/pkce.test.ts
```

Ожидается: FAIL, `Cannot find module './pkce.ts'`.

Если node ругается на TypeScript-синтаксис — значит стриппинг типов не включён. Тогда запускать как `node --experimental-strip-types --test src/background/auth/pkce.test.ts` и использовать этот вариант команды во всех последующих шагах.

- [ ] **Step 3: Написать минимальную реализацию**

Создать `src/background/auth/pkce.ts`:

```ts
/** Запас до истечения access-токена, при котором обновляемся заранее. */
export const REFRESH_MARGIN_MS = 60_000;

const base64url = (bytes: ArrayBuffer | Uint8Array): string => {
    const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    let binary = '';
    for (const byte of view) {
        binary += String.fromCharCode(byte);
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

/** Случайный code_verifier: 32 байта -> 43 символа base64url, нижняя граница RFC 7636. */
export const createVerifier = (): string => base64url(crypto.getRandomValues(new Uint8Array(32)));

/** S256-челлендж: base64url(SHA-256(verifier)) без паддинга. */
export const challengeFromVerifier = async (verifier: string): Promise<string> => {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
    return base64url(digest);
};

/** Истёк ли токен или истечёт в пределах запаса. */
export const needsRefresh = (expiresAt: number, now: number = Date.now()): boolean =>
    expiresAt - now <= REFRESH_MARGIN_MS;

/**
 * Схлопывает параллельные вызовы по одному ключу в один.
 * GitLab при refresh инвалидирует старый refresh-токен, поэтому два одновременных
 * обновления одного аккаунта дали бы invalid_grant на втором и разлогин на ровном месте.
 */
export const createSingleFlight = <V>() => {
    const inFlight = new Map<string, Promise<V>>();

    return (key: string, fn: () => Promise<V>): Promise<V> => {
        const existing = inFlight.get(key);
        if (existing) {
            return existing;
        }
        const promise = fn().finally(() => inFlight.delete(key));
        inFlight.set(key, promise);
        return promise;
    };
};
```

- [ ] **Step 4: Запустить тест и убедиться, что он проходит**

```bash
node --test src/background/auth/pkce.test.ts
```

Ожидается: PASS, 5 тестов.

- [ ] **Step 5: Добавить скрипт теста в `package.json`**

В блок `scripts` добавить путь явно, без glob: на Windows скрипты уходят не в bash, и `src/**/*.test.ts` приедет в node нераскрытым.

```json
        "test": "node --test src/background/auth/pkce.test.ts",
```

Проверить: `"$PNPM" test` — PASS. Если на шаге 2 понадобился `--experimental-strip-types`, добавить флаг и сюда.

- [ ] **Step 6: Коммит**

```bash
git add src/background/auth/pkce.ts src/background/auth/pkce.test.ts package.json
git commit -m "feat: PKCE core with single-flight refresh guard"
```

---

## Task 5: Константы инстанса и манифест

**Files:**
- Modify: `src/config/config.prod.ts`, `src/manifest/manifest.json`

**Interfaces:**
- Consumes: ничего.
- Produces: именованные экспорты `GITLAB_HOST`, `OAUTH_CLIENT_ID`, `OAUTH_SCOPE` из `../../config/config`.

- [ ] **Step 1: Добавить константы в конфиг**

В начало `src/config/config.prod.ts`, после импорта, добавить:

```ts
/** Единственный поддерживаемый инстанс. Форк намеренно не умеет self-hosted. */
export const GITLAB_HOST = 'https://gitlab.com';

/**
 * Application ID публичного OAuth-клиента (PKCE, Confidential = No).
 * Не секрет: без code_verifier и согласия пользователя он бесполезен.
 */
export const OAUTH_CLIENT_ID = '218dec9a8f0b8feb3e371cd3c760fdf0d69f1072f846984f0f543ac7f7cfb07f';

/** Только чтение. Расширение не делает write-вызовов, и приложение прав на них не просит. */
export const OAUTH_SCOPE = 'read_api';
```

- [ ] **Step 2: Прописать разрешения и ключ в манифест**

Взять значение публичного ключа:

```bash
cat extension-key.pub.b64
```

В `src/manifest/manifest.json` заменить строку `permissions` и добавить два ключа:

```json
    "permissions": ["storage", "alarms", "unlimitedStorage", "identity"],
    "host_permissions": ["https://gitlab.com/*"],
    "key": "<вставить содержимое extension-key.pub.b64 одной строкой>"
```

`host_permissions` обязателен: `/api/v4` отдаёт CORS-заголовки и работал бы без них, а `/oauth/token` — нет. `key` фиксирует extension ID, от которого зависит redirect URI.

- [ ] **Step 3: Пересобрать и проверить ID расширения**

```bash
"$PNPM" run lint && "$PNPM" run build:dev
```

Загрузить `dist/mv3` как распакованное расширение в Edge (`edge://extensions`, Developer mode → Load unpacked) и убедиться, что ID ровно `kgkmfbiljlfababkljfakpjmlpldogie`. Если ID другой — значение `key` вставлено неверно, redirect URI не совпадёт и авторизация не пройдёт.

- [ ] **Step 4: Коммит**

```bash
git add src/config/config.prod.ts src/manifest/manifest.json
git commit -m "feat: pin gitlab.com instance, OAuth client and extension ID"
```

---

## Task 6: Перевести авторизацию на OAuth

Самая крупная задача, и она атомарна: смена полей `Account` каскадом ломает типы во всех потребителях, промежуточного зелёного состояния не существует.

**Files:**
- Create: `src/background/auth/oauth.ts`
- Modify: `src/common/types.ts`, `src/common/storage/configuration.ts`, `src/background/utils/initGitlabApi.ts`, `src/common/errors.ts`, `src/common/storage/globalError.ts:3,20`, `src/background/endpoints/getLatestDataFromGitLab.ts:29`, `src/background/endpoints/getProjectsList.ts:6`, `src/background/endpoints/getMembersOfGroup.ts:9`, `src/popup/App.tsx:31,37,107`, `src/popup/components/Content.tsx:76`, `src/options/App.tsx:35-38`, `src/options/components/Account.tsx`

**Interfaces:**
- Consumes: `createVerifier`, `challengeFromVerifier`, `needsRefresh`, `createSingleFlight` из `./pkce`; `GITLAB_HOST`, `OAUTH_CLIENT_ID`, `OAUTH_SCOPE` из конфига.
- Produces:
  - `login(): Promise<Account>` — проводит флоу и возвращает готовый аккаунт (в хранилище его кладёт вызывающий).
  - `logout(account: Account): Promise<void>` — отзывает токен на стороне GitLab.
  - `getFreshAccessToken(account: Account): Promise<string>` — валидный access-токен, при необходимости обновляет и persist'ит.
  - `initGitlabApi({ account }): Promise<GitlabAPI>` — теперь `async`.

- [ ] **Step 1: Поменять тип `Account`**

В `src/common/types.ts`:

```ts
export interface Account {
    uuid: string;
    accessToken: string;
    refreshToken: string;
    /** epoch ms, момент истечения accessToken */
    expiresAt: number;
    draftInToReviewTab: boolean;
    projectDirectoryPrefix: string;
}
```

- [ ] **Step 2: Написать OAuth-модуль**

Создать `src/background/auth/oauth.ts`:

```ts
import * as browser from 'webextension-polyfill';
import { Account } from '../../common/types';
import { GITLAB_HOST, OAUTH_CLIENT_ID, OAUTH_SCOPE } from '../../config/config';
import { getConfiguration, updateAccountConfiguration } from '../../common/storage';
import { createSingleFlight, createVerifier, challengeFromVerifier, needsRefresh } from './pkce';
import { GitLabTokenNotSet } from '../../common/errors';

interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
}

const redirectUri = () => browser.identity.getRedirectURL();

const requestTokens = async (body: Record<string, string>): Promise<TokenResponse> => {
    const response = await fetch(`${GITLAB_HOST}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString()
    });

    if (!response.ok) {
        throw new Error(`OAuth token request failed: ${response.status} ${await response.text()}`);
    }

    return response.json() as Promise<TokenResponse>;
};

/** Проводит authorization code + PKCE и возвращает свежий аккаунт. */
export const login = async (): Promise<Account> => {
    const verifier = createVerifier();
    const challenge = await challengeFromVerifier(verifier);
    const state = createVerifier();

    const authUrl = new URL(`${GITLAB_HOST}/oauth/authorize`);
    authUrl.searchParams.set('client_id', OAUTH_CLIENT_ID);
    authUrl.searchParams.set('redirect_uri', redirectUri());
    authUrl.searchParams.set('response_type', 'code');
    authUrl.searchParams.set('scope', OAUTH_SCOPE);
    authUrl.searchParams.set('state', state);
    authUrl.searchParams.set('code_challenge', challenge);
    authUrl.searchParams.set('code_challenge_method', 'S256');

    const redirect = await browser.identity.launchWebAuthFlow({ url: authUrl.toString(), interactive: true });

    const returned = new URL(redirect);
    if (returned.searchParams.get('state') !== state) {
        throw new Error('OAuth state mismatch');
    }

    const code = returned.searchParams.get('code');
    if (!code) {
        throw new Error(`OAuth authorization failed: ${returned.searchParams.get('error') ?? 'no code returned'}`);
    }

    const tokens = await requestTokens({
        client_id: OAUTH_CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri(),
        code_verifier: verifier
    });

    return {
        uuid: globalThis.crypto.randomUUID(),
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000,
        draftInToReviewTab: true,
        projectDirectoryPrefix: ''
    };
};

/** Отзывает авторизацию на стороне GitLab. Ошибку глушим: локально аккаунт всё равно удаляется. */
export const logout = async (account: Account): Promise<void> => {
    try {
        await fetch(`${GITLAB_HOST}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, token: account.refreshToken }).toString()
        });
    } catch (error) {
        console.error('Token revocation failed, removing account locally anyway:', error);
    }
};

const persistTokens = async (uuid: string, tokens: TokenResponse): Promise<void> => {
    const settings = await getConfiguration(['accounts']);
    const index = settings.accounts.findIndex((candidate) => candidate.uuid === uuid);
    if (index === -1) {
        return;
    }
    await updateAccountConfiguration(index, {
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token,
        expiresAt: Date.now() + tokens.expires_in * 1000
    });
};

const refreshFlight = createSingleFlight<string>();

/** Валидный access-токен. Обновляет заранее и схлопывает параллельные обновления. */
export const getFreshAccessToken = async (account: Account): Promise<string> => {
    if (!account?.refreshToken) {
        throw new GitLabTokenNotSet();
    }

    if (!needsRefresh(account.expiresAt)) {
        return account.accessToken;
    }

    return refreshFlight(account.uuid, async () => {
        let tokens: TokenResponse;
        try {
            tokens = await requestTokens({
                client_id: OAUTH_CLIENT_ID,
                grant_type: 'refresh_token',
                refresh_token: account.refreshToken,
                redirect_uri: redirectUri()
            });
        } catch (error) {
            // Авторизацию отозвали или refresh-токен истёк — вернуть в состояние «не залогинен».
            console.error('Token refresh failed, signing out:', error);
            await persistTokens(account.uuid, { access_token: '', refresh_token: '', expires_in: 0 });
            throw new GitLabTokenNotSet();
        }

        await persistTokens(account.uuid, tokens);
        return tokens.access_token;
    });
};
```

- [ ] **Step 3: Переписать `initGitlabApi`**

`src/background/utils/initGitlabApi.ts` целиком:

```ts
import { Gitlab } from '@gitbeaker/rest';
import { GitLabTokenNotSet } from '../../common/errors';
import { Account, GitlabAPI } from '../../common/types';
import { getFreshAccessToken } from '../auth/oauth';

interface InitGitlabApiParams {
    account: Account;
}

export const initGitlabApi = async (params: InitGitlabApiParams): Promise<GitlabAPI> => {
    const { account } = params;

    if (!account) {
        throw new GitLabTokenNotSet();
    }

    // host не задаётся: дефолт @gitbeaker/rest — https://gitlab.com, единственный поддерживаемый инстанс.
    return new Gitlab({
        oauthToken: await getFreshAccessToken(account),
        queryTimeout: 10000
    });
};
```

- [ ] **Step 4: Проставить `await` у трёх вызывающих**

`src/background/endpoints/getLatestDataFromGitLab.ts` строка 29:

```ts
        gitlabApi = await initGitlabApi({ account });
```

`src/background/endpoints/getProjectsList.ts` строка 6:

```ts
    const gitlabApi = await initGitlabApi({ account: settings.accounts[0] });
```

`src/background/endpoints/getMembersOfGroup.ts` строка 9:

```ts
    const gitlabApi = await initGitlabApi({ account: settings.accounts[0] });
```

- [ ] **Step 5: Убрать `GitLabAddressNotSet`**

Из `src/common/errors.ts` удалить класс `GitLabAddressNotSet` целиком.

`src/common/storage/globalError.ts` строка 3 — убрать из импорта; строка 20 становится:

```ts
        const color = error instanceof GitLabTokenNotSet ? 'orange' : 'red';
```

`src/popup/components/Content.tsx` — убрать строку `error.name === 'GitLabAddressNotSet' ||` из условия.

- [ ] **Step 6: Заменить адрес в попапе на константу**

`src/popup/App.tsx`: удалить строку 31 (`const [gitlabAddress, setGitlabAddress] = useState('');`) и строку 37 (`setGitlabAddress(...)`). Добавить импорт `import { GITLAB_HOST } from '../config/config';` и передать константу в `Footer` (строка 107):

```tsx
                    gitlabAddress={GITLAB_HOST}
```

- [ ] **Step 7: Вычистить legacy-миграцию и пустой аккаунт**

`src/common/storage/configuration.ts` — удалить блок legacy-миграции целиком:

```ts
        // Convert accounts string to array if needed
        if (typeof settings.accounts === 'string') { ... }
```

Удалить `defaultEmptyAccount` целиком вместе с импортом `Account`, если тот больше не используется в файле. Аккаунт теперь рождается только из `login()`: пустой аккаунт без токенов бессмысленен, а его единственный потребитель (`addNewAccount`) переписывается на шаге 8.

После удаления проверить, что на него нет ссылок:

```bash
grep -rn "defaultEmptyAccount" src/
```

Ожидается: пусто.

- [ ] **Step 8: Кнопка входа вместо полей токена и адреса**

`src/options/App.tsx` — `addNewAccount` (строки 35-38) становится:

```tsx
    const addNewAccount = async () => {
        try {
            const account = await login();
            await updateConfigurationInMemory({ accounts: [...(configuration?.accounts || []), account] });
        } catch (error) {
            console.error('Login failed:', error);
        }
    };
```

Добавить импорт `import { login } from '../background/auth/oauth';` и убрать `defaultEmptyAccount` из импорта на строке 8. Текст кнопки на строке 145 — `Sign in with GitLab`.

`src/options/components/Account.tsx` — удалить оба `FormControl` с токеном (строки 61-85) и адресом (86-103) вместе с импортами `KeyIcon`, `ServerIcon`, `TextInput` там, где они больше не нужны, и `Link`. Вместо них показать состояние авторизации перед блоком с кнопками:

```tsx
            <Flash variant={account.refreshToken ? 'success' : 'warning'}>
                {account.refreshToken
                    ? `Signed in to ${GITLAB_HOST} (read-only)`
                    : 'Not signed in — remove this account and sign in again'}
            </Flash>
```

Добавить импорт `import { GITLAB_HOST } from '../../config/config';`. Кнопка `Remove this account` обзаводится отзывом токена — заменить проп `removeAccount` в `src/options/App.tsx` (строка 142):

```tsx
                        removeAccount={() => removeAccount(index)}
```

и сам `removeAccount` (строки 40-45):

```tsx
    const removeAccount = async (index: number) => {
        const accounts = configuration?.accounts || [];
        await logout(accounts[index]);
        void clearAccountStorage(accounts[index].uuid);
        accounts.splice(index, 1);
        await updateConfigurationInMemory({ accounts });
    };
```

Импорт дополняется: `import { login, logout } from '../background/auth/oauth';`

- [ ] **Step 9: Проверить сборку и тесты**

```bash
"$PNPM" run lint && "$PNPM" test && "$PNPM" run build:dev
```

Ожидается: всё зелёное. Любая оставшаяся ссылка на `account.token`, `account.address` или `gitlabCE` проявится здесь ошибкой типов.

- [ ] **Step 10: Коммит**

```bash
git add -A
git commit -m "feat: replace PAT with OAuth PKCE read_api authentication"
```

---

## Task 7: Сквозная проверка вручную

Автотестами это не покрывается: нужен настоящий редирект через браузер и живой GitLab.

**Files:** никаких изменений, только проверка. Правки по результатам — отдельными коммитами.

**Interfaces:**
- Consumes: собранный `dist/mv3` из Task 6.
- Produces: подтверждение, что флоу работает от начала до конца.

- [ ] **Step 1: Собрать и загрузить**

```bash
"$PNPM" run build:dev
```

`edge://extensions` → Developer mode → Load unpacked → `dist/mv3`. Проверить, что ID — `kgkmfbiljlfababkljfakpjmlpldogie`.

- [ ] **Step 2: Пройти вход**

Options → `Sign in with GitLab`. Ожидается: открывается окно GitLab с экраном согласия, в котором указан **только** объём `read_api`. Подтвердить.

Ожидается: окно закрывается, в списке аккаунтов появляется запись с зелёным `Signed in to https://gitlab.com (read-only)`.

Если GitLab показывает ошибку redirect URI — значение `key` в манифесте не совпадает с тем, из которого выведен зарегистрированный callback.

- [ ] **Step 3: Проверить данные**

Открыть попап. Ожидается: вкладки To Review / Under Review / Issues / To-Do List наполняются данными из `exinity-corporate/extrade`, бейдж показывает счётчики.

- [ ] **Step 4: Проверить, что write-поверхности нет**

В To-Do List у элементов не должно быть кнопки с галочкой, а над списком — кнопки «Mark all as done».

- [ ] **Step 5: Проверить обновление токена**

В `edge://extensions` открыть service worker → Console. Оставить расширение работать дольше двух часов (или временно уменьшить `REFRESH_MARGIN_MS` в `pkce.ts` до значения, превышающего 7200 с, пересобрать и дождаться одного цикла опроса).

Ожидается: данные продолжают обновляться, в консоли нет `invalid_grant`, разлогина не происходит. Вернуть `REFRESH_MARGIN_MS` в `60_000`, если меняли.

- [ ] **Step 6: Проверить отзыв**

Options → `Remove this account`. Затем на `gitlab.com/-/user_settings/applications` убедиться, что приложение больше не числится авторизованным.

- [ ] **Step 7: Финальный коммит и пуш**

```bash
git add -A
git commit -m "docs: implementation plan for OAuth read_api fork"
git push -u origin oauth-readonly
```

Пуш выполнять только после подтверждения владельцем репозитория.
