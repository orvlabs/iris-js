# @orvlabs/iris

Typed client for the [Iris API](https://iris.orvlabs.com/docs). Types come from the OpenAPI document, so every body, query and answer is checked at compile time. A new version is published, with npm provenance, whenever the API changes.

Server only (Node 20.19+): never ship your API key to a browser.

```sh
npm install @orvlabs/iris
```

## Send an email

```ts
import { createIris, IrisError } from '@orvlabs/iris';

const iris = createIris({ apiKey: process.env.IRIS_API_KEY! });

const { id } = await iris.sendEmail(
  {
    from: 'Boutique <commandes@boutique.sn>',
    to: 'Awa <awa@example.sn>',
    subject: 'Votre commande',
    html: '<p>Merci {{params.prenom}} !</p>',
    data: { prenom: 'Awa' },
  },
  { idempotencyKey: 'commande-CMD-2041' },
);
```

With the same `idempotencyKey` (an order number, for example), a retry after a network timeout does not send the email twice. The key is kept 24 hours; reusing it with another body throws `idempotency_key_reused`.

Use a test key (`iris_test_…`) while you build: it is checked exactly like a real one, but nothing is delivered and no units are used.

## Ask for a payment

```ts
await iris.sendEmail({
  from: 'factures@boutique.sn',
  to: 'awa@example.sn',
  subject: 'Votre facture',
  html: '<p>Votre facture est prête.</p>{{bloc_paiement}}',
  payment: { amount_xof: 15000, reference: 'FAC-2026-0042', description: 'Facture FAC-2026-0042', methods: ['wave', 'orange_money'] },
});
```

Amounts are whole CFA francs. The same reference and amount reuse the same 221 Pay link; link your merchant account in the console first.

## Handle errors

Every method throws an `IrisError` on an answer other than 2xx.

```ts
try {
  await iris.sendEmail(email);
} catch (e) {
  if (!(e instanceof IrisError)) throw e; // network failure
  console.error(e.status, e.code, e.message, e.fix, e.docs);
  if ([429, 502, 503].includes(e.status)) {
    // retry later, with an increasing delay and the same idempotencyKey
  }
}
```

Branch on `status` and `code`; `message` and `fix` are readable French that may change, `docs` links the page of the code.

## Lists

`listEmails`, `listEvents` and `listSuppressions` fetch the next page as you iterate.

```ts
for await (const email of iris.listEmails({ to: 'awa@example.sn' })) {
  console.log(email.id, email.status);
}

for await (const event of iris.listEvents({ type: 'email.bounced' })) {
  console.log(event.email_id, event.recipient);
}
```

## Other routes

| Method | Route |
| --- | --- |
| `getEmail(id)` | `GET /api/emails/{id}` |
| `cancelEmail(id)` | `POST /api/emails/{id}/cancel`, a scheduled email or its `batch_id` |
| `checkEmailAddresses({ emails })` | `POST /api/emails/check` |
| `getStats({ from, to })` | `GET /api/stats`, `YYYY-MM-DD`, UTC, both included |
| `deleteSuppression(email)` | `DELETE /api/suppressions/{email}` |
| `revokeSecret(id)` | `POST /api/secrets/{id}/revoke` |
| `getInboundAttachment(delivery, index)` | `GET /api/inbound/{delivery}/attachments/{index}`, a `Blob` |
| `createVerification`, `checkVerification`, `cancelVerification`, `resendVerification` | `/v1/verify` |

## Options

```ts
createIris({
  apiKey: process.env.IRIS_API_KEY!,
  version: '2026-11-23', // Iris-Version; defaults to the version these types describe (API_VERSION)
  baseUrl: 'https://iris.orvlabs.com',
  fetch, // your own fetch, for a proxy or tests
});
```

## Webhooks

Verify against the raw body, before parsing it.

```ts
import { verifyWebhook, verifyPaymentWebhook } from '@orvlabs/iris';

// Inbound email and email events (Standard Webhooks, whsec_ secret): throws if invalid.
// headers: a plain object (Express, Fastify) or a Fetch Headers (Next, Hono).
const event = verifyWebhook(secret, rawBody, headers);

// Payment events.
const ok = verifyPaymentWebhook(secret, rawBody, headers['x-iris-timestamp'], headers['x-iris-signature']);
```

Deduplicate on the event `id`: retries carry the same one.

Every route, field and error code is in the [API reference](https://iris.orvlabs.com/docs).
