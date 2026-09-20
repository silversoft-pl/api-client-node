# @silversoft/api-client (Node)

Klient **wewnętrznego API**: JSON po HTTP, z podpisem zgodnym z RFC 9421. Bez zależności
zewnętrznych — transport to `node:http`/`node:https`, a jedyną zależnością jest nasz
[@silversoft/api-signer][signer-repo].

```
npm install @silversoft/api-client
```

[![Node](https://img.shields.io/badge/Node-%3E%3D18-5fa04e)](package.json)

Odpowiednik dla PHP: **[silversoft/api-client][php-repo]**.

---

## Do czego, a do czego nie

**Do wewnętrznego API** — usług, które sami utrzymujemy i które uwierzytelniają się nagłówkiem
`Api-Authorization` albo podpisem RFC 9421. Klient zdejmuje z aplikacji trzy rzeczy, które dziś
robi każda z nich osobno: budowanie nagłówka autoryzacji, serializację ciała i interpretację
odpowiedzi.

**Nie do API zewnętrznych.** Mają inne uwierzytelnianie, inne formaty i inne wymagania, a wciągnięcie
tego tutaj zamieniłoby wąskie narzędzie w ogólny klient HTTP — czyli inny produkt.

## Szybki start

```js
import { Client } from '@silversoft/api-client';

const client = new Client({
    url: process.env.API_URL,
    key_id: 'moja-usluga',
    key: process.env.API_SECRET,
    auth: 'signed',              // 'legacy' dopóki serwer nie przeszedł na podpisy
});

const response = await client.post('/v1/users/update_profile', { user });

if (response.error !== null) {
    console.error('API:', response.error);
    return;
}

console.log(response.data.user);
```

Działa i ESM, i CommonJS:

```js
import { Client } from '@silversoft/api-client';
const { Client } = require('@silversoft/api-client');
```

`GET` z parametrami:

```js
const response = await client.get('/v1/items/list', { types: ['seo'], od: '2025-01-01' });
```

Tablice są kodowane jak `http_build_query` w PHP (`types[0]=seo`), żeby obie paczki wołały to samo
API identycznie.

## `Response`

| Pole | Znaczenie |
|---|---|
| `.data` | zdekodowany JSON |
| `.status` | kod HTTP; `0` przy błędzie transportu |
| `.error` | powód niepowodzenia wywołania: kod spoza 2xx, błąd transportu albo niepoprawny JSON. **`null` oznacza powodzenie** |
| `.raw` | surowa odpowiedź, do diagnostyki |
| `.headers` | nagłówki odpowiedzi, klucze małymi literami |
| `.retries` | ile ponowień było potrzebne |

### Wynik wywołania a wynik operacji

`response.error` mówi o **wywołaniu**: czy udało się połączyć, czy serwis odpowiedział kodem 2xx
i czy odpowiedź jest poprawnym JSON-em. To, czy serwis wykonał żądaną operację, jest w ciele
odpowiedzi — wiele API zwraca to jako pole `success`:

```js
if (response.error !== null) {
    // nie udało się wywołać
}
if (!response.data.success) {
    // wywołanie przeszło, operacji nie wykonano
}
```

`response.value('pole', domyslna)` czyta z ciała z wartością zapasową.

## Opcje

Wszystkie ustawia się w konstruktorze; część można nadpisać na pojedynczym żądaniu jako trzeci
argument `get()` / `post()` / `request()`.

| Opcja | Domyślnie | Znaczenie | Per żądanie |
|---|---|---|---|
| `url` | — | adres bazowy usługi (wymagane) | nie |
| `key_id` | — | nazwa aplikacji, czyli `keyid` podpisu (wymagane) | nie |
| `key` | — | sekret (wymagane) | nie |
| `auth` | `signed` | `signed` (RFC 9421) albo `legacy` (`Api-Authorization`) | nie |
| `alg` | `hmac-sha256` | algorytm podpisu | nie |
| `timeout` | `30` | limit całego żądania w **sekundach** | tak |
| `connect_timeout` | `10` | limit nawiązania połączenia w sekundach | tak |
| `verify` | `true` | weryfikacja certyfikatu TLS | tak |
| `user_agent` | `<key_id> (@silversoft/api-client)` | nagłówek `User-Agent` | tak |
| `headers` | `{}` | własne nagłówki dokładane do każdego żądania | tak |
| `request` | `{}` | opcje przekazywane wprost do `http.request` — odpowiednik opcji `curl` w wariancie PHP | tak |
| `retries` | `0` | liczba ponowień | tak |
| `retry_delay` | `200` | odstęp w **milisekundach**, narastająco | tak |
| `retry_methods` | `['GET', 'HEAD']` | metody, które wolno ponawiać | tak |
| `retry_statuses` | `[429, 500, 502, 503, 504]` | kody wyzwalające ponowienie | tak |
| `tag` | `null` | parametr `tag` podpisu | tak |
| `lifetime` | `300` | ważność podpisu w sekundach | tak |

Timeouty są w sekundach, a nie w milisekundach jak zwykle w Node — celowo, żeby konfiguracja
przenosiła się jeden do jednego między tą paczką a wariantem PHP.

```js
const client = new Client({
    url: 'https://service.example.com',
    key_id: 'my-service',
    key: process.env.API_SECRET,
    timeout: 180,
    user_agent: 'my-service/2.1',
    headers: { 'X-Zrodlo': 'reporting' },
    request: { family: 4 },
    retries: 3,
});

const response = await client.post('/v1/files/upload', payload, { timeout: 600 });
```

Własne nagłówki są **objęte podpisem** — nie da się ich dostrzyknąć ani usunąć po drodze.

### Ponowienia

Domyślnie wyłączone i po włączeniu obowiązują tylko metody z `retry_methods`, czyli `GET` i `HEAD`.
`POST` nie jest ponawiany, nawet przy `retries > 0`: bez wiedzy o idempotentności endpointu
ponowienie tworzy duplikaty. Jeśli konkretny `POST` jest idempotentny, włącz to świadomie:

```js
await client.post('/api/idempotentny', body, { retries: 3, retry_methods: ['POST'] });
```

## Duże ładunki

Wewnętrzne API przesyła pliki jako base64 w JSON-ie, nie jako `multipart/form-data` — i tak musi
zostać, bo podpisane endpointy multipartu nie obsługują. Ciało wielomegabajtowe przechodzi bez
problemu; pamiętaj tylko o `timeout` odpowiednim do rozmiaru.

## Migracja ze starego schematu

Tryb autoryzacji jest opcją, nie gałęzią w kodzie:

```js
{ auth: 'legacy' }   // Api-Authorization: base64("<key_id>|<klucz>")
{ auth: 'signed' }   // RFC 9421 (Signature-Input + Signature)
```

Dzięki temu aplikacja przechodzi na podpisy zmianą konfiguracji.

## Bezpieczeństwo

Model bezpieczeństwa opisuje [api-signer][signer-repo] — tu obowiązują te same założenia:
TLS przy każdym wywołaniu, jeden klucz na parę usług, jeden klucz na środowisko, co najmniej
32 bajty entropii, klucze nigdy w repozytorium.

Klient nie wyłącza weryfikacji TLS sam z siebie. `verify: false` bywa potrzebne na lokalnym
środowisku z certyfikatem z podpisem własnym, ale poza nim jest błędem.

## Testy

Testy idą przez prawdziwy serwer HTTP i prawdziwe gniazdo, a serwer testowy **weryfikuje podpis**
tak jak zrobiłaby to aplikacja. Dzięki temu pokryta jest cała droga — podpisanie, transport,
weryfikacja — a nie tylko atrapa transportu.

```bash
npm install --no-save ../api-signer-node
node --test test/
```

## Licencja

MIT — patrz [LICENSE](LICENSE).

[signer-repo]: https://github.com/silversoft-pl/api-signer-node
[php-repo]: https://github.com/silversoft-pl/api-client-php
