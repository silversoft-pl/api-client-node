'use strict';

const http = require('node:http');
const { URL } = require('node:url');
const { Credential, Policy, Request, keyIdOf, verify } = require('@silversoft/api-signer');

/**
 * Serwer testowy: weryfikuje podpis tak, jak zrobiłaby to prawdziwa aplikacja,
 * i odsyła to, co otrzymał. Dzięki temu testy przechodzą przez sieć i przez
 * weryfikację, a nie tylko przez atrapę transportu.
 */

const KEYS = {
    'test-klient': { auth: 'signed', alg: 'hmac-sha256', key: 'sekret-testowy-0123456789abcdef' },
    'stary-klient': { auth: 'legacy', key: 'sekret-testowy-0123456789abcdef' },
};

let counter = 0;

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        req.on('data', (chunk) => chunks.push(chunk));
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        req.on('error', reject);
    });
}

function start() {
    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url, 'http://127.0.0.1');
        const body = await readBody(req);

        const send = (status, payload) => {
            res.writeHead(status, { 'Content-Type': 'application/json' });
            res.end(typeof payload === 'string' ? payload : JSON.stringify(payload));
        };

        if (url.pathname === '/status') {
            const code = Number(url.searchParams.get('code') ?? 200);
            send(code, { success: true, code });
            return;
        }

        if (url.pathname === '/niepoprawny-json') {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end('to nie jest json');
            return;
        }

        if (url.pathname === '/zlicz') {
            counter++;
            send(counter < 3 ? 503 : 200, { success: true, proby: counter });
            return;
        }

        if (url.pathname === '/wolno') {
            setTimeout(() => send(200, { success: true }), 2000);
            return;
        }

        const request = new Request(req.method, url.pathname, url.search, body, req.headers);
        const keyId = keyIdOf(request);

        if (keyId === null || !KEYS[keyId]) {
            send(401, { success: false, errors: ['nieznany klient'] });
            return;
        }

        const credential = Credential.fromConfig(keyId, KEYS[keyId]);

        if (credential.isLegacy()) {
            if (request.header('api-authorization') !== credential.legacyHeader()) {
                send(401, { success: false, errors: ['zły klucz'] });
                return;
            }
        } else {
            const result = verify(request, credential, new Policy());
            if (result.failed) {
                send(401, { success: false, errors: [result.reason] });
                return;
            }
        }

        if (url.pathname === '/blad-aplikacji') {
            send(200, { success: false, errors: ['coś poszło nie tak'] });
            return;
        }

        if (url.pathname === '/422') {
            send(422, { success: false, result: 'walidacja nie przeszła' });
            return;
        }

        send(200, {
            success: true,
            method: req.method,
            path: url.pathname,
            query: url.search,
            body,
            body_length: Buffer.byteLength(body, 'utf8'),
            key_id: keyId,
            user_agent: req.headers['user-agent'] ?? null,
            custom: req.headers['x-wlasny'] ?? null,
            content_type: req.headers['content-type'] ?? null,
        });
    });

    return new Promise((resolve) => {
        server.listen(0, '127.0.0.1', () => {
            resolve({ server, base: `http://127.0.0.1:${server.address().port}`, reset: () => { counter = 0; } });
        });
    });
}

module.exports = { start };
