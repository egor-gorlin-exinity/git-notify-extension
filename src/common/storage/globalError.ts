import localforage from 'localforage';
import { setBadge } from '../utils/setBadge.js';
import { GlobalError, GitLabTokenNotSet } from '../errors.js';

// Create a localforage instance for global error storage
const globalErrorStorage = localforage.createInstance({
    name: 'AppData',
    storeName: 'globalError'
});

export const setGlobalError = async (error: Error | null): Promise<void> => {
    if (error) {
        const globalError: GlobalError = {
            name: error.name,
            message: error.message,
            stack: error.stack || ''
        };

        const color = error instanceof GitLabTokenNotSet ? 'orange' : 'red';
        await setBadge('!', color);

        try {
            await globalErrorStorage.setItem('globalError', globalError);
        } catch (storageError) {
            console.error('Failed to store global error:', storageError);
        }
    } else {
        await setBadge('', 'black'); // Clear badge
        try {
            await globalErrorStorage.removeItem('globalError');
        } catch (storageError) {
            console.error('Failed to remove global error:', storageError);
        }
    }
};

export const getGlobalError = async (): Promise<GlobalError | null> => {
    try {
        const globalError = await globalErrorStorage.getItem<GlobalError>('globalError');
        return globalError || null;
    } catch (storageError) {
        console.error('Failed to retrieve global error:', storageError);
        return null;
    }
};
