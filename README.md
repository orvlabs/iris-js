# @orvlabs/iris

Typed client for the [Iris API](https://iris.orvlabs.com/docs). Types come from the OpenAPI document, so every route, body and error is checked at compile time. A new version is published, with npm provenance, whenever the API changes.

Server only (Node 20.19+): never ship your API key to a browser.

```sh
npm install @orvlabs/iris
```

```ts
import { createIris } from '@orvlabs/iris';

const iris = createIris({ apiKey: process.env.IRIS_API_KEY! });

const { data, error } = await iris.POST('/v3/smtp/email', {
  body: { sender: { email: 'no-reply@example.sn' }, to: [{ email: 'awa@example.sn' }], subject: 'Hello', htmlContent: '<p>Hi</p>' },
});
if (error) console.error(error.code, error.message);
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
