import * as browser from 'webextension-polyfill';
import { getMembersOfGroup, getProjectsList } from './endpoints/index.js';
import { getConfiguration, setGlobalError } from '../common/storage/index.js';
import { routine, RoutineResult } from './routine.js';
import { logger } from '../common/logger.js';
import { FailFetchSettings, GitLabNoAccount, GlobalError } from '../common/errors.js';

/**
 * routine() не бросает пер-аккаунтные ошибки — оно возвращает их данными.
 * Достаём из них GlobalError (signed-out, no account): попап различает такие
 * по `.name` и показывает нужный экран. Обычные ошибки выборки остаются
 * обычными Error и глобальными не становятся.
 *
 * Поднимаем до глобальной, только когда не осталось ни одного работающего аккаунта:
 * Content.tsx разворачивает GlobalError в полноэкранный Onboarding, и один разлогиненный
 * аккаунт иначе прятал бы исправные за «настройте расширение», не говоря даже какой сломан.
 * Пока хоть один аккаунт жив, это доносит пер-аккаунтный ErrorFlash — он уже печатает uuid.
 */
const globalErrorFrom = ({ polledAccounts, collectedErrors }: RoutineResult): GlobalError | null => {
    const globalErrors = collectedErrors.map(
        (entry) => entry.errors.find((error): error is GlobalError => error instanceof GlobalError) ?? null
    );

    if (globalErrors.length !== polledAccounts || !globalErrors.every(Boolean)) {
        return null;
    }

    return globalErrors[0] ?? null;
};

logger('Background script loaded');

let time: number; // dynamic interval
getConfiguration(['accounts', 'refreshRate']).then(async (settings) => {
    if (!settings) {
        await setGlobalError(new FailFetchSettings());
    }

    if (!settings.accounts || settings.accounts.length === 0) {
        await setGlobalError(new GitLabNoAccount());
    }

    time = settings.refreshRate;

    browser.alarms.create('fetchGitLab', { when: Date.now() });

    browser.alarms.onAlarm.addListener(async () => {
        try {
            await setGlobalError(globalErrorFrom(await routine({})));
        } catch (error) {
            if (error instanceof Error) {
                await setGlobalError(error);
            }
        }
        logger('Next refresh in', time);
        await browser.alarms.clear('fetchGitLab');
        browser.alarms.create('fetchGitLab', { when: Date.now() + time * 1000 });
    });
});

browser.runtime.onMessage.addListener((message) => {
    if (message.type === 'ping') {
        return Promise.resolve('pong');
    }

    if (message.type === 'getLatestDataFromGitLab') {
        return new Promise(async (resolve) => {
            try {
                const result = await routine({});
                await setGlobalError(globalErrorFrom(result));
                resolve(result.collectedErrors.length === 0);
            } catch (error) {
                if (error instanceof Error) {
                    await setGlobalError(error);
                }
                resolve(false);
            }
        });
    }

    if (message.type === 'testAccount') {
        return new Promise(async (resolve) => {
            try {
                const result = await routine({ accountUuids: [message.accountUuid] });
                await setGlobalError(globalErrorFrom(result));
                resolve(result.collectedErrors.length === 0);
            } catch (error) {
                if (error instanceof Error) {
                    await setGlobalError(error);
                }
                resolve(false);
            }
        });
    }

    if (message.type === 'getProjectsList') {
        return getProjectsList();
    }

    if (message.type === 'getMembersOfGroup') {
        return getMembersOfGroup(message.groupId);
    }

    if (message.type === 'updateRefreshRate') {
        time = message.interval;
        return;
    }
});
