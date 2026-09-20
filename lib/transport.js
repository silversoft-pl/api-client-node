'use strict';

const http = require('node:http');
const https = require('node:https');
const { URL } = require('node:url');

/**
 * Warstwa transportowa na `node:http`/`node:https`. Oddzielona od `Client`, żeby
 * testy mogły ją podmienić, i żeby całe zetknięcie z siecią było w jednym pliku.
 *
 * Świadomie nie `fetch`: wyłączenie weryfikacji TLS i osobny limit na nawiązanie
 * połączenia wymagałyby tam agenta undici, a tu są zwykłymi opcjami.
 */
class Transport {
    /**
     * @returns {Promise<{status: number, body: string, headers: Object, error: string|null}>}
     */
    send(method, url, body, headers, options) {
        return new Promise((resolve) => {
            let target;
            try {
                target = new URL(url);
            } catch (e) {
                resolve({ status: 0, body: '', headers: {}, error: `Niepoprawny adres: ${url}` });
                return;
            }

            const secure = target.protocol === 'https:';
            const transport = secure ? https : http;
            const payload = Buffer.from(body ?? '', 'utf8');

            const requestOptions = {
                method,
                protocol: target.protocol,
                hostname: target.hostname,
                port: target.port || (secure ? 443 : 80),
                path: target.pathname + target.search,
                headers: { ...headers, 'Content-Length': payload.length },
                ...options.request,
            };

            if (secure && options.verify === false) {
                requestOptions.rejectUnauthorized = false;
            }

            let settled = false;
            const finish = (result) => {
                if (settled) return;
                settled = true;
                resolve(result);
            };

            const request = transport.request(requestOptions, (response) => {
                const chunks = [];
                response.on('data', (chunk) => chunks.push(chunk));
                response.on('end', () => finish({
                    status: response.statusCode ?? 0,
                    body: Buffer.concat(chunks).toString('utf8'),
                    headers: response.headers,
                    error: null,
                }));
                response.on('error', (error) => finish({ status: 0, body: '', headers: {}, error: error.message }));
            });

            request.setTimeout(options.timeout * 1000, () => {
                request.destroy();
                finish({ status: 0, body: '', headers: {}, error: `Przekroczono limit czasu ${options.timeout} s.` });
            });

            const connectTimer = setTimeout(() => {
                request.destroy();
                finish({
                    status: 0,
                    body: '',
                    headers: {},
                    error: `Przekroczono limit nawiązania połączenia ${options.connect_timeout} s.`,
                });
            }, options.connect_timeout * 1000);

            request.on('socket', (socket) => {
                socket.on('connect', () => clearTimeout(connectTimer));
                if (!socket.connecting) clearTimeout(connectTimer);
            });

            request.on('error', (error) => {
                clearTimeout(connectTimer);
                finish({ status: 0, body: '', headers: {}, error: error.message });
            });

            request.on('close', () => clearTimeout(connectTimer));

            if (payload.length > 0) request.write(payload);
            request.end();
        });
    }
}

module.exports = { Transport };
