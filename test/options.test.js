'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Client, ClientError, Options } = require('../lib/index.js');

const base = { url: 'https://x.example', key_id: 'a', key: 'b' };

const zle = [
    ['brak url', { key_id: 'a', key: 'b' }, /url/],
    ['brak key_id', { url: 'https://x', key: 'b' }, /key_id/],
    ['brak key', { url: 'https://x', key_id: 'a' }, /key/],
    ['nieznana opcja', { ...base, timout: 5 }, /Nieznane opcje/],
    ['headers nie obiekt', { ...base, headers: 'x' }, /headers/],
    ['request nie obiekt', { ...base, request: [] }, /request/],
    ['retry_methods nie tablica', { ...base, retry_methods: 'GET' }, /retry_methods/],
];

for (const [name, options, pattern] of zle) {
    test(`odrzuca błędną konfigurację: ${name}`, () => {
        assert.throws(() => new Client(options), (error) => error instanceof ClientError && pattern.test(error.message));
    });
}

test('nie wolno nadpisać klucza na pojedynczym żądaniu', () => {
    const client = new Client(base);

    assert.rejects(() => client.get('/echo', {}, { key: 'inny' }), ClientError);
});

test('ukośnik na końcu adresu bazowego nie dubluje się w URL-u', () => {
    const client = new Client({ ...base, url: 'https://x.example/' });

    assert.equal(client.url('/api/a'), 'https://x.example/api/a');
    assert.equal(client.url('api/a'), 'https://x.example/api/a');
});

test('pełny adres w ścieżce jest używany bez zmian', () => {
    assert.equal(new Client(base).url('https://inny.example/a'), 'https://inny.example/a');
});

test('nadpisanie opcji na żądaniu nie zmienia klienta', () => {
    const options = new Options({ ...base, timeout: 30 });

    assert.equal(options.with({ timeout: 5 }).get('timeout'), 5);
    assert.equal(options.get('timeout'), 30);
});

test('nagłówki z żądania są scalane z tymi z konstruktora', () => {
    const options = new Options({ ...base, headers: { A: '1', B: '2' } });

    assert.deepEqual(options.with({ headers: { B: '3', C: '4' } }).get('headers'), { A: '1', B: '3', C: '4' });
});

test('domyślny User-Agent powstaje z identyfikatora klucza', () => {
    assert.equal(new Options(base).get('user_agent'), 'a (@silversoft/api-client)');
});

test('wejście ESM wystawia te same nazwy co CommonJS', async () => {
    const esm = await import('../index.mjs');
    const cjs = require('../lib/index.js');

    for (const name of Object.keys(cjs)) {
        assert.equal(typeof esm[name], typeof cjs[name], `brak eksportu "${name}" w index.mjs`);
    }
});
