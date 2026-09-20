'use strict';

const { prepare } = require('@silversoft/api-signer');
const { ClientError } = require('./errors.js');
const { Options } = require('./options.js');
const { Response } = require('./response.js');
const { Transport } = require('./transport.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Klient wewnętrznego API.
 *
 * Zakres jest celowo wąski: JSON po HTTP do własnych usług, z podpisem
 * z `@silversoft/api-signer`. Usługi trzecich stron mają inne wymagania
 * i zostają poza tą paczką.
 */
class Client {
    constructor(options, transport = null) {
        this.options = new Options(options);
        this.transport = transport ?? new Transport();
    }

    get(path, query = {}, options = {}) {
        return this.request('GET', withQuery(path, query), null, options);
    }

    post(path, body = null, options = {}) {
        return this.request('POST', path, body, options);
    }

    put(path, body = null, options = {}) {
        return this.request('PUT', path, body, options);
    }

    delete(path, body = null, options = {}) {
        return this.request('DELETE', path, body, options);
    }

    async request(method, path, body = null, options = {}) {
        const effective = Object.keys(options).length === 0 ? this.options : this.options.with(options);
        const upper = String(method).toUpperCase();
        const url = this.url(path);

        const signerOptions = { headers: effective.get('headers'), lifetime: effective.get('lifetime') };
        if (effective.get('tag') !== null) signerOptions.tag = effective.get('tag');

        const signed = prepare(effective.credential(), upper, url, body, signerOptions);

        const headers = { ...signed.headers, 'User-Agent': effective.get('user_agent') };
        const attempts = Math.max(0, Number(effective.get('retries'))) + 1;
        const retryable = effective.get('retry_methods').includes(upper);

        let result = null;
        let retries = 0;

        for (let attempt = 0; attempt < attempts; attempt++) {
            if (attempt > 0) {
                await sleep(Number(effective.get('retry_delay')) * attempt);
                retries++;
            }

            result = await this.transport.send(upper, url, signed.body, headers, {
                timeout: Number(effective.get('timeout')),
                connect_timeout: Number(effective.get('connect_timeout')),
                verify: effective.get('verify'),
                request: effective.get('request'),
            });

            if (!retryable || !shouldRetry(result, effective)) break;
        }

        return toResponse(result, retries);
    }

    url(path) {
        if (/^https?:\/\//i.test(path)) return path;

        return `${this.options.get('url')}/${String(path).replace(/^\/+/, '')}`;
    }
}

function withQuery(path, query) {
    const entries = Object.entries(query ?? {});
    if (entries.length === 0) return path;

    const params = new URLSearchParams();
    for (const [name, value] of entries) {
        if (Array.isArray(value)) {
            // Zgodnie z http_build_query po stronie PHP, żeby obie paczki wołały to samo API tak samo.
            value.forEach((item, index) => params.append(`${name}[${index}]`, String(item)));
            continue;
        }
        params.append(name, String(value));
    }

    return path + (path.includes('?') ? '&' : '?') + params.toString();
}

function shouldRetry(result, options) {
    if (result.error !== null) return true;

    return options.get('retry_statuses').includes(result.status);
}

function errorFrom(data, status) {
    for (const field of ['result', 'message', 'error']) {
        const value = data && typeof data === 'object' ? data[field] : null;
        if (typeof value === 'string' && value !== '') return value;
    }

    const errors = data && typeof data === 'object' ? data.errors : null;
    if (errors && (Array.isArray(errors) ? errors.length > 0 : true)) {
        return [].concat(errors).map(String).join(', ');
    }

    return `Serwer odpowiedział kodem ${status}.`;
}

function toResponse(result, retries) {
    if (result === null) throw new ClientError('Żądanie nie zostało wykonane.');

    if (result.error !== null) {
        return new Response({
            status: result.status, data: null,
            raw: result.body, error: result.error, headers: result.headers, retries,
        });
    }

    let data = null;
    let decodeError = null;

    if (result.body !== '') {
        try {
            data = JSON.parse(result.body);
        } catch (e) {
            decodeError = `Odpowiedź nie jest poprawnym JSON-em: ${e.message}`;
        }
    }

    const ok = result.status >= 200 && result.status < 300;

    return new Response({
        status: result.status,
        data,
        raw: result.body,
        error: ok && decodeError === null ? null : (decodeError ?? errorFrom(data, result.status)),
        headers: result.headers,
        retries,
    });
}

module.exports = { Client };
