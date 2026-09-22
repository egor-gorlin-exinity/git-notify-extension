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
