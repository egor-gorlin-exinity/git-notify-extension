import { test } from 'node:test';
import assert from 'node:assert/strict';
import { challengeFromVerifier, createVerifier, isRevokedGrant, needsRefresh, createSingleFlight } from './pkce.ts';

test('challengeFromVerifier соответствует эталону RFC 7636 Appendix B', async () => {
    const challenge = await challengeFromVerifier('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk');
    assert.equal(challenge, 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
});

test('challengeFromVerifier кодирует обе замены base64url', async () => {
    // Вектор RFC 7636 содержит '-', но не '_': эта пара пиннит и '+' -> '-', и '/' -> '_'.
    assert.equal(await challengeFromVerifier('test'), 'n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is0V1sFbDwCgg');
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
    assert.equal(needsRefresh(now + 60_000, now), true, 'граница окна включительная');
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

test('isRevokedGrant чистит токены только на отказанном гранте', () => {
    assert.equal(isRevokedGrant(400, 'invalid_grant'), true, 'отозванная или истёкшая авторизация');
    assert.equal(isRevokedGrant(401), true, 'отозванный токен');
    assert.equal(isRevokedGrant(400, 'invalid_request'), false, 'другой 400 — не отзыв');
    assert.equal(isRevokedGrant(400), false, '400 без кода ошибки — не отзыв');
    assert.equal(isRevokedGrant(500), false, 'сбой GitLab — не отзыв');
    assert.equal(isRevokedGrant(429), false, 'rate limit — не отзыв');
    assert.equal(isRevokedGrant(0), false, 'сеть не ответила — статуса нет, не отзыв');
});
