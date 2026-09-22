import localforage from 'localforage';
import { Account, Configuration, TabId } from '../types';
import { config } from '../../config/config';
import { logger } from '../logger';

const configStorage = localforage.createInstance({
    name: 'AppConfig',
    storeName: 'configuration'
});

// Update configuration
export const updateConfiguration = async (objectToStore: Partial<Configuration>): Promise<void> => {
    try {
        for (const [key, value] of Object.entries(objectToStore)) {
            await configStorage.setItem(key, value);
        }
        logger('Configuration Updated');
    } catch (error) {
        console.error('Error updating configuration:', error);
    }
};

/**
 * Все записи аккаунтов в этом контексте идут по очереди: `accounts` — один ключ localforage,
 * и read-modify-write двух перекрывающихся вызовов теряет первую запись. С тех пор как фоновый
 * воркер обновляет токены, такая потеря означает мёртвый refresh-токен, а не просто откат галочки.
 *
 * ponytail: цепочка сериализует записи только внутри одного JS-контекста. Окно «страница настроек
 * против service worker» остаётся — потолок известен и принят; кросс-контекстный лок (запись через
 * один runtime-канал) — если он когда-нибудь выстрелит на практике.
 */
let accountWrites: Promise<void> = Promise.resolve();

// Update specific account configuration, addressed by uuid: an index drifts when accounts are removed
export const updateAccountConfiguration = (uuid: string, objectToStore: Partial<Account>): Promise<void> => {
    const write = accountWrites.then(async () => {
        const settings = await getConfiguration(['accounts']);
        const accounts = Array.isArray(settings.accounts) ? settings.accounts : [];
        const accountIndex = accounts.findIndex((account) => account.uuid === uuid);
        if (accountIndex === -1) {
            return;
        }
        accounts[accountIndex] = { ...accounts[accountIndex], ...objectToStore };
        await updateConfiguration({ accounts });
    });
    accountWrites = write.catch(() => undefined); // отказ одной записи не должен травить очередь
    return write;
};

// Read configuration
export const getConfiguration = async <T extends keyof Configuration>(keys: T[]): Promise<Pick<Configuration, T>> => {
    const settings: Partial<Configuration> = {};

    try {
        for (const key of keys) {
            const value = await configStorage.getItem<Configuration[T]>(key as string);
            settings[key] = value !== null ? value : (config as Configuration)[key];
        }

        // Handle legacy mapping for defaultTab
        if (typeof settings.defaultTab === 'number') {
            const legacyMapping: { [key: number]: TabId } = {
                0: 'to_review',
                1: 'under_review',
                2: 'issues',
                3: 'todo_list'
            };
            settings.defaultTab = legacyMapping[settings.defaultTab] ?? 'to_review';
        }

        return settings as Pick<Configuration, T>;
    } catch (error) {
        console.error('Error reading configuration:', error);
        throw error;
    }
};
