import * as browser from 'webextension-polyfill';
import { Account } from '../../common/types';
import { GITLAB_HOST, OAUTH_CLIENT_ID, OAUTH_SCOPE } from '../../config/config';
import { getConfiguration, updateAccountConfiguration } from '../../common/storage';
import { createSingleFlight, createVerifier, challengeFromVerifier, isRevokedGrant, needsRefresh } from './pkce';
import { GitLabTokenNotSet } from '../../common/errors';

interface TokenResponse {
    access_token: string;
    refresh_token: string;
    expires_in: number;
}

/** Отказ /oauth/token с сохранёнными статусом и кодом ошибки: по ним решается, отозвана ли авторизация. */
class OAuthTokenError extends Error {
    constructor(
        readonly status: number,
        readonly errorCode: string | undefined,
        message: string
    ) {
        super(message);
    }
}

const redirectUri = () => browser.identity.getRedirectURL();

const requestTokens = async (body: Record<string, string>): Promise<TokenResponse> => {
    const response = await fetch(`${GITLAB_HOST}/oauth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(body).toString()
    });

    if (!response.ok) {
        const text = await response.text();
        let errorCode: string | undefined;
        try {
            errorCode = (JSON.parse(text) as { error?: string }).error;
        } catch {
            // не JSON: кода ошибки нет, решаем по одному статусу
        }
        throw new OAuthTokenError(response.status, errorCode, `OAuth token request failed: ${response.status} ${text}`);
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
        const response = await fetch(`${GITLAB_HOST}/oauth/revoke`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: OAUTH_CLIENT_ID, token: account.refreshToken }).toString()
        });
        if (!response.ok) {
            console.error(`Token revocation refused: ${response.status} ${await response.text()}`);
        }
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
            const refusal = error instanceof OAuthTokenError ? error : null;
            if (!isRevokedGrant(refusal?.status ?? 0, refusal?.errorCode)) {
                // Сеть, 5xx, 429 — refresh-токен ещё жив. Пробрасываем: это пер-аккаунтная
                // ошибка (не GlobalError), следующий поллинг повторит с тем же токеном.
                console.error('Token refresh failed, keeping the session:', error);
                throw error;
            }
            // Авторизацию отозвали или refresh-токен истёк — вернуть в состояние «не залогинен».
            console.error('Authorization revoked, signing out:', error);
            await persistTokens(account.uuid, { access_token: '', refresh_token: '', expires_in: 0 });
            throw new GitLabTokenNotSet();
        }

        await persistTokens(account.uuid, tokens);
        return tokens.access_token;
    });
};
