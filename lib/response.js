'use strict';

/**
 * Wynik wywołania. `error === null` oznacza, że wywołanie się powiodło:
 * kod 2xx i poprawny JSON.
 */
class Response {
    constructor({ status, data, raw, error = null, headers = {}, retries = 0 }) {
        this.status = status;
        this.data = data;
        this.raw = raw;
        this.error = error;
        this.headers = headers;
        this.retries = retries;
    }

    /** Wartość z ciała odpowiedzi albo `fallback`, gdy jej nie ma. */
    value(name, fallback = null) {
        if (this.data && typeof this.data === 'object' && name in this.data) return this.data[name];

        return fallback;
    }
}

module.exports = { Response };
