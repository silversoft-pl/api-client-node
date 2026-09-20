'use strict';

/** Błąd konfiguracji albo użycia. Niepowodzenie samego wywołania zwraca Response, nie wyjątek. */
class ClientError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ClientError';
    }
}

module.exports = { ClientError };
