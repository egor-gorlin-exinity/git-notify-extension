import { Configuration } from '../common/types';

/** Единственный поддерживаемый инстанс. Форк намеренно не умеет self-hosted. */
export const GITLAB_HOST = 'https://gitlab.com';

/**
 * Application ID публичного OAuth-клиента (PKCE, Confidential = No).
 * Не секрет: без code_verifier и согласия пользователя он бесполезен.
 */
export const OAUTH_CLIENT_ID = '218dec9a8f0b8feb3e371cd3c760fdf0d69f1072f846984f0f543ac7f7cfb07f';

/** Только чтение. Расширение не делает write-вызовов, и приложение прав на них не просит. */
export const OAUTH_SCOPE = 'read_api';

export const config = {
    mode: 'production',
    defaultTab: 'to_review',
    alertBadgeCounters: [0],
    /** Аккаунты заводятся только OAuth-логином из настроек, вручную сюда не пишутся. */
    accounts: [],
    refreshRate: 60
} satisfies Configuration;
