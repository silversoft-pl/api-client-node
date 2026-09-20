'use strict';

const { Credential } = require('@silversoft/api-signer');
const { ClientError } = require('./errors.js');

const DEFAULTS = {
    url: null,
    key_id: null,
    key: null,
    auth: 'signed',
    alg: 'hmac-sha256',
    timeout: 30,            // sekundy, jak w wariancie PHP
    connect_timeout: 10,    // sekundy
    verify: true,
    user_agent: null,
    headers: {},
    request: {},            // opcje przekazywane wprost do http.request — odpowiednik opcji `curl` w PHP
    retries: 0,
    retry_delay: 200,       // milisekundy
    retry_methods: ['GET', 'HEAD'],
    retry_statuses: [429, 500, 502, 503, 504],
    tag: null,
    lifetime: 300,
};

/** Opcje, które wolno nadpisać na pojedynczym żądaniu. */
const PER_REQUEST = [
    'timeout', 'connect_timeout', 'verify', 'headers', 'request',
    'retries', 'retry_delay', 'retry_methods', 'retry_statuses',
    'tag', 'lifetime', 'user_agent',
];

/** Konfiguracja klienta, z walidacją w jednym miejscu. */
class Options {
    constructor(options) {
        const unknown = Object.keys(options).filter((name) => !(name in DEFAULTS));
        if (unknown.length > 0) {
            throw new ClientError(`Nieznane opcje klienta: ${unknown.join(', ')}.`);
        }

        this.values = { ...DEFAULTS, ...options };

        for (const required of ['url', 'key_id', 'key']) {
            if (!this.values[required]) throw new ClientError(`Opcja "${required}" jest wymagana.`);
        }

        this.values.url = String(this.values.url).replace(/\/+$/, '');

        if (this.values.user_agent === null) {
            this.values.user_agent = `${this.values.key_id} (@silversoft/api-client)`;
        }

        for (const name of ['headers', 'request']) {
            if (typeof this.values[name] !== 'object' || this.values[name] === null || Array.isArray(this.values[name])) {
                throw new ClientError(`Opcja "${name}" musi być obiektem.`);
            }
        }
        for (const name of ['retry_methods', 'retry_statuses']) {
            if (!Array.isArray(this.values[name])) throw new ClientError(`Opcja "${name}" musi być tablicą.`);
        }
    }

    with(overrides) {
        const unknown = Object.keys(overrides).filter((name) => !PER_REQUEST.includes(name));
        if (unknown.length > 0) {
            throw new ClientError(`Tych opcji nie można nadpisać na pojedynczym żądaniu: ${unknown.join(', ')}.`);
        }

        const merged = Object.create(Options.prototype);
        merged.values = { ...this.values };

        for (const [name, value] of Object.entries(overrides)) {
            if ((name === 'headers' || name === 'request') && value && typeof value === 'object') {
                merged.values[name] = { ...this.values[name], ...value };
                continue;
            }
            merged.values[name] = value;
        }

        return merged;
    }

    get(name) {
        return this.values[name];
    }

    credential() {
        return new Credential(this.values.key_id, this.values.key, this.values.alg, this.values.auth);
    }
}

Options.DEFAULTS = DEFAULTS;
Options.PER_REQUEST = PER_REQUEST;

module.exports = { Options };
