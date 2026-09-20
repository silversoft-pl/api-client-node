'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('../lib/index.js');
const { start } = require('./server.js');

const KEY = 'sekret-testowy-0123456789abcdef';

test('klient wewnętrznego API', async (t) => {
    const { server, base, reset } = await start();
    t.after(() => server.close());

    const client = (options = {}) => new Client({ url: base, key_id: 'test-klient', key: KEY, ...options });

    await t.test('podpisany POST przechodzi weryfikację na serwerze', async () => {
        const response = await client().post('/v1/users/update_profile', { user: { id: 1 } });

        assert.equal(response.error, null);
        assert.equal(response.status, 200);
        assert.equal(response.data.method, 'POST');
        assert.equal(response.data.key_id, 'test-klient');
    });

    await t.test('ciało dociera co do bajta', async () => {
        const response = await client().post('/echo', { nazwa: 'Żółć ĄĘŚĆ', emoji: '🔐' });

        assert.equal(response.data.body, '{"nazwa":"Żółć ĄĘŚĆ","emoji":"🔐"}');
        assert.equal(response.data.content_type, 'application/json');
    });

    await t.test('duże ciało przechodzi w całości', async () => {
        const body = { plik: Buffer.from('0123456789abcdef'.repeat(65536)).toString('base64') };
        const response = await client().post('/v1/files/upload', body);

        assert.equal(response.error, null);
        assert.equal(response.data.body_length, Buffer.byteLength(JSON.stringify(body), 'utf8'));
    });

    await t.test('GET z parametrami query', async () => {
        const response = await client().get('/v1/items/list', { types: ['seo'], od: '2025-01-01' });

        assert.equal(response.error, null);
        assert.match(response.data.query, /types%5B0%5D=seo/);
    });

    await t.test('stary schemat dalej działa', async () => {
        const response = await client({ key_id: 'stary-klient', auth: 'legacy' }).post('/echo', { x: 1 });

        assert.equal(response.error, null);
        assert.equal(response.data.key_id, 'stary-klient');
    });

    await t.test('klient oznaczony jako podpisany nie przechodzi starym nagłówkiem', async () => {
        const response = await client({ auth: 'legacy' }).post('/echo', { x: 1 });

        assert.notEqual(response.error, null);
        assert.equal(response.status, 401);
    });

    await t.test('zły klucz jest odrzucany', async () => {
        const response = await client({ key: 'zupelnie-inny-sekret-0123456789' }).post('/echo', { x: 1 });

        assert.notEqual(response.error, null);
        assert.equal(response.status, 401);
    });

    await t.test('niepowodzenie wywołania to co innego niż niepowodzenie aplikacji', async () => {
        const response = await client().post('/blad-aplikacji', { x: 1 });

        assert.equal(response.error, null, 'wywołanie się udało: 200 i poprawny JSON');
        assert.equal(response.data.success, false, 'aplikacja zgłosiła niepowodzenie w ciele');
    });

    await t.test('kod 422 niesie komunikat z ciała', async () => {
        const response = await client().post('/422', { x: 1 });

        assert.notEqual(response.error, null);
        assert.equal(response.status, 422);
        assert.equal(response.error, 'walidacja nie przeszła');
    });

    await t.test('niepoprawny JSON jest niepowodzeniem mimo kodu 200', async () => {
        const response = await client().get('/niepoprawny-json');

        assert.notEqual(response.error, null);
        assert.equal(response.status, 200);
        assert.match(response.error, /JSON/);
        assert.equal(response.raw, 'to nie jest json');
    });

    for (const code of [400, 403, 404, 500, 502]) {
        await t.test(`kod ${code} jest niepowodzeniem`, async () => {
            const response = await client().get('/status', { code });

            assert.notEqual(response.error, null);
            assert.equal(response.status, code);
            assert.notEqual(response.error, null);
        });
    }

    await t.test('domyślny User-Agent niesie identyfikator klucza', async () => {
        assert.equal((await client().get('/echo')).data.user_agent, 'test-klient (@silversoft/api-client)');
    });

    await t.test('własny User-Agent', async () => {
        assert.equal((await client({ user_agent: 'my-service/2.1' }).get('/echo')).data.user_agent, 'my-service/2.1');
    });

    await t.test('własne nagłówki są wysyłane i objęte podpisem', async () => {
        const response = await client({ headers: { 'X-Wlasny': 'wartosc' } }).post('/echo', { x: 1 });

        assert.equal(response.error, null);
        assert.equal(response.data.custom, 'wartosc');
    });

    await t.test('nagłówki można dodać na pojedynczym żądaniu', async () => {
        const c = client({ headers: { 'X-Wlasny': 'z-konstruktora' } });

        assert.equal((await c.get('/echo', {}, { headers: { 'X-Wlasny': 'z-zadania' } })).data.custom, 'z-zadania');
        assert.equal((await c.get('/echo')).data.custom, 'z-konstruktora');
    });

    await t.test('krótki timeout przerywa żądanie', async () => {
        const response = await client({ timeout: 1 }).get('/wolno');

        assert.notEqual(response.error, null);
        assert.equal(response.status, 0);
        assert.match(response.error, /limit czasu/);
    });

    await t.test('ponowienia są domyślnie wyłączone', async () => {
        reset();
        const response = await client().get('/zlicz');

        assert.notEqual(response.error, null);
        assert.equal(response.status, 503);
        assert.equal(response.retries, 0);
    });

    await t.test('ponowienia działają, gdy włączone', async () => {
        reset();
        const response = await client({ retries: 3, retry_delay: 10 }).get('/zlicz');

        assert.equal(response.error, null);
        assert.equal(response.retries, 2);
        assert.equal(response.data.proby, 3);
    });

    await t.test('POST nie jest ponawiany mimo włączonych ponowień', async () => {
        reset();
        const response = await client({ retries: 3, retry_delay: 10 }).post('/zlicz', { x: 1 });

        assert.equal(response.status, 503);
        assert.equal(response.retries, 0, 'POST został ponowiony, a nie wolno — powstałyby duplikaty');
    });

    await t.test('nagłówki odpowiedzi są dostępne', async () => {
        const response = await client().get('/echo');

        assert.match(response.headers['content-type'], /application\/json/);
    });

    await t.test('value zwraca wartość domyślną, gdy pola nie ma', async () => {
        const response = await client().get('/echo');

        assert.equal(response.value('nie-ma-takiego-pola', 'brak'), 'brak');
        assert.equal(response.value('method'), 'GET');
    });
});
