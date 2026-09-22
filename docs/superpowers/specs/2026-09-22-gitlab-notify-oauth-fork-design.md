# Личный форк git-notify-extension: OAuth вместо PAT, только gitlab.com

**Дата:** 2026-09-22
**Статус:** дизайн утверждён, план реализации не написан
**Upstream:** https://github.com/Mikescops/git-notify-extension (`master` @ `233a19a`, MV3, v2.3.0, ISC)
**Форк:** https://github.com/egor-gorlin-exinity/git-notify-extension
**Клон:** `C:\Development\extrade\3rd-party\git-notify-extension` (`upstream` remote привязан)

## Задача

Расширение «GitLab Notify» (в сторах — «Git Notify») показывает merge requests, issues,
todo и статусы пайплайнов. Конфигурация требует вручную выпустить Personal Access Token
и вставить его в настройки. Форкаем, чтобы заменить это на OAuth-приложение.

## Почему именно OAuth, и что он на самом деле решает

OAuth со скоупом `api` **не уменьшает радиус поражения** по сравнению с PAT со скоупом
`api`: refresh-токен лежит в том же хранилище и чеканит access-токены до самого отзыва.
Для атакующего, читающего диск, это одно и то же.

Настоящая причина форка другая, и она инвертирует наивный аргумент:

> При PAT скоуп выбирает **пользователь** в момент выпуска токена.
> При OAuth скоуп декларирует **приложение** в authorize-запросе.

Сегодня владелец расширения держит `read_api`-токен по собственному решению, вопреки
подсказке в UI («requires `api` right»). После перехода на OAuth такой свободы не будет —
объём прав станет свойством кода. Поэтому переход на OAuth **обязан** сопровождаться
прибиванием `read_api` в самом приложении, иначе он станет регрессом в контроле.

Что форк даёт по факту: вход в один клик вместо копипаста секрета, экран согласия с явным
объёмом прав, отзыв одной кнопкой в «Authorized applications», access-токен живёт 2 часа,
и — главное — невозможность случайно выдать расширению больше прав, чем ему нужно.

## Целевой инстанс

**gitlab.com.** Подтверждено по git-remote рабочих репозиториев:
`git@gitlab.com:exinity-corporate/extrade/*`. Self-hosted в обиходе нет.

Следствия:

- `host` в gitbeaker по умолчанию `https://gitlab.com` — опция удаляется, а не заменяется.
- CE-чекбокс («у моего инстанса нет approvals») удаляется в положении «approvals есть»:
  корпоративный тариф gitlab.com их имеет.

## Границы

Не делаем: поддержку self-hosted, Firefox/MV2, публикацию в сторы, любые write-операции
к GitLab API, сохранение обратной совместимости с PAT-конфигом.

**Мультиаккаунт оставляем.** В `master` он реальный и несущий: `Configuration.accounts` —
массив, `routine` перебирает аккаунты через `Promise.all`, у каждого свой инстанс
localforage по `uuid`, бейдж консолидирует счётчики по всем. Вырезать его — глубокая
операция на агрегации и попапе, и к self-hosted он отношения не имеет. Меняем только
содержимое `Account`, структуру не трогаем.

## Изменения

### Тип `Account` — было / стало

```ts
// было (src/common/types.ts)            // стало
{ uuid, gitlabCE, token, address,        { uuid, accessToken, refreshToken, expiresAt,
  draftInToReviewTab,                      draftInToReviewTab,
  projectDirectoryPrefix }                 projectDirectoryPrefix }
```

Уходят `gitlabCE`, `token`, `address`. Приходит тройка OAuth-токенов. `uuid` остаётся
ключом аккаунта и хранилища.

### Удаляем

| Что | Где | Почему |
|---|---|---|
| `src/manifest-v2/` | + `targets.mv2`, `build:prod:mv2`, `zip:firefox` и firefox из `browserslist` в `package.json` | Firefox не нужен, форк под Edge |
| `setTodoAsDone.ts` | + экспорт в `endpoints/index.ts`, + кнопка в попапе | единственная write-операция, несовместима с `read_api` |
| `account.address` | `initGitlabApi.ts:16-26`, `Account.tsx:97`, `popup/App.tsx:37`, `configuration.ts:62,81`, `config.prod.ts` | только gitlab.com; в попапе адрес становится константой для построения ссылок |
| `account.gitlabCE` | `getLatestDataFromGitLab.ts:131,159`, `fetchMRExtraInfo.ts:10,16,28,55`, `Account.tsx:54-57`, `configuration.ts:63,81`, `types.ts:45` | approvals прибиты включёнными |
| `account.token` | `initGitlabApi.ts:12`, `Account.tsx:79`, `configuration.ts:61,81` | заменяется тройкой OAuth-токенов |
| `GitLabAddressNotSet`, `GitLabIsCE` | `common/errors.ts`, `storage/globalError.ts:3,20`, `popup/components/Content.tsx:76` | вместе с полями |
| legacy-миграция аккаунтов | `configuration.ts:59-67` (ветка `typeof settings.accounts === 'string'`) | мапит ровно те поля, которые удаляем; для свежего форка мёртвый код |

### Оставляем

`projectDirectoryPrefix` — **оставить**. Это не про self-hosted: подрезает отображение
вложенных групп, а рабочие пути имеют вид `exinity-corporate/extrade/<repo>`, то есть фича
ровно для этого случая и полезна.

Сборка на parcel, поллинг по alarm, попап, React-дерево, остальные три endpoint,
мультиаккаунт — не трогаем.

### Добавляем: `src/background/auth/oauth.ts`

Единственный новый модуль. Три экспорта, все принимают/возвращают аккаунт по `uuid`:

```ts
login(): Promise<Account>                            // новый аккаунт: флоу -> токены
logout(uuid: string): Promise<void>                  // POST /oauth/revoke + удаление аккаунта
getFreshAccessToken(account: Account): Promise<string>
```

PKCE на штатном `crypto`, новых зависимостей нет:
`code_verifier` — 32 случайных байта из `crypto.getRandomValues`, base64url без паддинга;
`code_challenge` — base64url(SHA-256(verifier)) без паддинга через `crypto.subtle.digest`;
`code_challenge_method=S256`.

Эндпоинты GitLab: `/oauth/authorize`, `/oauth/token`, `/oauth/revoke`.
Приложение — public client, **client secret отсутствует и не требуется**.

### Одновременный refresh — single-flight по `uuid`

Это не теоретическая осторожность. `initGitlabApi` вызывается **на каждый** вызов
endpoint (`getLatestDataFromGitLab.ts:29`, `getMembersOfGroup.ts:9`, `getProjectsList.ts:6`),
а попап может дёрнуть `getProjectsList` ровно в тот момент, когда `routine` опрашивает API.
GitLab при refresh инвалидирует старый refresh-токен, поэтому два параллельных refresh для
одного аккаунта дадут `400 invalid_grant` на втором — и разлогинят пользователя на ровном
месте.

Лечится одной картой in-flight промисов, `Map<uuid, Promise<string>>`: второй запрос
подписывается на первый, а не шлёт свой.

### Client ID — в `src/config/config.prod.ts`

`src/config` целиком в `.gitignore`, исключение — `config.prod.ts`, и сборка копирует его
в `config.ts` через `copy-config:prod`. То есть это и есть штатное место для вшитой
константы. Client ID публичного PKCE-клиента не секрет, коммитить его правильно.

Туда же переезжает адрес `https://gitlab.com` как единственная константа инстанса.

### Манифест

```jsonc
"permissions":      ["storage", "alarms", "unlimitedStorage", "identity"],
"host_permissions": ["https://gitlab.com/*"],
"key":              "<base64 DER публичного ключа>"
```

`host_permissions` несёт нагрузку, а не косметику: `/api/v4` отдаёт CORS-заголовки и поэтому
работает сегодня без них, а `/oauth/token` — нет, и обмен кода без host-permission упадёт.

`key` фиксирует ID расширения. Без него ID выводится из пути к каталогу, и redirect URI
разъезжается при любом переносе папки, а GitLab требует точного совпадения.

## Поток данных

```
alarm -> routine -> (по каждому аккаунту) initGitlabApi(account)
                                             -> getFreshAccessToken(account)   [single-flight]
                                             -> new Gitlab({ oauthToken })
                                             -> GitLab API
```

Токен добывается ровно в одной точке, вызывающие про OAuth не знают. `initGitlabApi`
становится `async` — это вся рябь, которая расходится по четырём (после удаления
`setTodoAsDone` — трём) вызывающим:

```ts
export const initGitlabApi = async ({ account }: InitGitlabApiParams): Promise<GitlabAPI> =>
    new Gitlab({ oauthToken: await getFreshAccessToken(account), queryTimeout: 10000 });
```

`oauthToken` — штатная опция `@gitbeaker/rest`, наравне с `token` и `jobToken`.
Access-токен GitLab живёт 7200 с, обновляемся с запасом 60 с до `expiresAt`. Refresh
инвалидирует обе выданные ранее строки и возвращает новую пару — записываем обе через
`updateAccountConfiguration`.

## Обработка ошибок

| Ситуация | Поведение |
|---|---|
| у аккаунта нет refresh-токена | попап в состоянии «не залогинен», кнопка Login (переиспользуем `Onboarding.tsx`) |
| refresh вернул `400 invalid_grant` | авторизацию отозвали или она истекла: чистим токены аккаунта, туда же |
| `launchWebAuthFlow` отменён пользователем | тихо возвращаемся, состояние не меняем |
| сетевые и прочие ошибки API | существующий канал `globalError` / `collectedErrors`, не трогаем |

`GitLabTokenNotSet` остаётся как класс, но переезжает на смысл «не залогинен» —
`globalError.ts:20` красит его оранжевым, а не красным, и это поведение нам подходит.

## Проверка

**Тест-раннера в репозитории нет** — ни jest, ни vitest, ни `test`-скрипта. Значит один
самостоятельный файл без фреймворков, запускаемый `node --test`.

Нетривиальных мест три, на них и тест:

- `code_challenge` против known-answer вектора RFC 7636, Appendix B:
  verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk`
  → challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM`
- окно протухания: не обновляемся при `expiresAt - now > 60s`, обновляемся при меньшем;
- single-flight: два параллельных `getFreshAccessToken` для одного `uuid` дают **один**
  сетевой вызов.

## Разовая настройка

Порядок обязателен: redirect URI зависит от ID расширения, ID зависит от `key`.

1. **Пользователь:** форк на github.com — **сделано**, склонирован, `upstream` привязан.
2. **Исполнитель:** генерирует RSA-ключ, выводит из него ID расширения, прописывает `key`
   в манифест. Redirect URI: `https://<ext-id>.chromiumapp.org/`
3. **Пользователь:** `gitlab.com/-/user_settings/applications` → новое приложение:
   redirect URI из шага 2, scope **только `read_api`**, галка *Confidential* **снята**.
   Application ID передаётся исполнителю.
4. **Исполнитель:** вшивает client ID в `config.prod.ts`, собирает; пользователь грузит
   unpacked в Edge.

## Окружение

`git` 2.45.2, node v24.13.0, npm 11.6.2 присутствуют. **pnpm отсутствует** — ставится через
`corepack enable`.

## Риски

**Корпоративная политика на OAuth-приложения.** `exinity-corporate` — корпоративная группа
gitlab.com, в ней возможны ограничения на сторонние OAuth-приложения или enforced SAML SSO.
Работающий сегодня `read_api` PAT доказывает доступ к API, но не то, что пройдёт
authorize-флоу. Проверяется на шаге 3 настройки — **до** написания кода.

**Версия node.** `package.json` объявляет `engines: { node: "18.x.x" }`, установлен v24.13.0,
parcel — 2.12 (начало 2024). Сборка может упереться; проверяется первым же прогоном
`pnpm install && pnpm run build:dev`, до любых правок кода. Запасной ход — nvm на 18.x.

**Расхождение с upstream.** Выбран вариант с широкой чисткой, а не минимальный патч:
приоритет отдан чистоте кода, а не дешёвым мерджам. `upstream` как remote добавлен, но
конфликты при подтягивании ожидаемы и приемлемы.

## Поправка к раннему анализу

Лицензия — **ISC**, объявлена в `package.json` (`"license": "ISC"`, автор Corentin Mors).
Отдельного файла LICENSE в репозитории нет, из-за чего GitHub API отдаёт `spdx_id: null`;
на это я и опирался, когда раньше называл репозиторий «all rights reserved». Это неверно:
ISC — пермиссивная лицензия, форк и распространение разрешены при сохранении копирайта.
Ограничения на публикацию, которое я упоминал, не существует.
