import { createHmac, timingSafeEqual } from 'node:crypto';
import createClient, { type ClientOptions } from 'openapi-fetch';
import { Webhook } from 'standardwebhooks';
import type { components, paths } from './generated/api.js';

export type { components, paths } from './generated/api.js';

export type IrisOptions = ClientOptions & { apiKey: string };

/** Typed client of every route of the Iris OpenAPI document. Use from your server only. */
export function createIris({ apiKey, baseUrl = 'https://iris.orvlabs.com', headers, ...options }: IrisOptions) {
	return createClient<paths>({ ...options, baseUrl, headers: { ...headers, 'api-key': apiKey } });
}

export type Iris = ReturnType<typeof createIris>;

/** Verifies an inbound email or email event delivery (Standard Webhooks, whsec_ secret) and returns the parsed body; throws if invalid. */
export function verifyWebhook<T = InboundEmail | EmailEvent>(secret: string, rawBody: string, headers: Headers | Record<string, string>): T {
	return new Webhook(secret).verify(rawBody, headers instanceof Headers ? Object.fromEntries(headers) : headers) as T;
}

/** Checks X-Iris-Signature of a payment event; during a secret rotation the header carries two signatures, either may match. */
export function verifyPaymentWebhook(secret: string, rawBody: string | Uint8Array, timestamp: string, signature: string, maxAgeSeconds = 300): boolean {
	if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > maxAgeSeconds) return false;
	const expected = Buffer.from(`v1=${createHmac('sha256', secret).update(`${timestamp}.`).update(rawBody).digest('hex')}`);
	return signature.split(' ').some((s) => {
		const got = Buffer.from(s);
		return got.length === expected.length && timingSafeEqual(got, expected);
	});
}

export type IrisError = components['schemas']['Error'];
export type InboundEmail = components['schemas']['InboundEmail'];
export type EmailEvent = components['schemas']['EmailEvent'];
export type PaymentEvent = components['schemas']['PaymentEvent'];
