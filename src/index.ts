import { createHmac, timingSafeEqual } from 'node:crypto';
import createClient, { type ClientOptions } from 'openapi-fetch';
import { Webhook } from 'standardwebhooks';
import type { components, paths } from './generated/api.js';

export type { components, paths } from './generated/api.js';

type Schemas = components['schemas'];
export type SendEmailRequest = Schemas['SendEmailRequest'];
export type SendEmailResponse = Schemas['SendEmailResponse'];
export type Email = Schemas['Email'];
export type Event = Schemas['Event'];
export type Stats = Schemas['Stats'];
export type Suppression = Schemas['Suppression'];
export type AddressCheckRequest = Schemas['AddressCheckRequest'];
export type AddressCheck = Schemas['AddressCheck'];
export type VerificationRequest = Schemas['VerificationRequest'];
export type Verification = Schemas['Verification'];
export type VerificationCheck = Schemas['VerificationCheck'];
export type VerificationStatus = Schemas['VerificationStatus'];
export type InboundEmail = Schemas['InboundEmail'];
export type EmailEvent = Schemas['EmailEvent'];
export type PaymentEvent = Schemas['PaymentEvent'];

/** API version these types describe, sent as Iris-Version unless you pass another `version`. */
export const API_VERSION = '2026-11-23';

export type IrisOptions = ClientOptions & { apiKey: string; version?: string };

/** An answer other than 2xx. Branch on `status` and `code`; `message` and `fix` are French text that may change. */
export class IrisError extends Error {
	override name = 'IrisError';
	constructor(readonly status: number, readonly code: string, message: string, readonly fix: string, readonly docs: string) {
		super(message);
	}
}

async function call<T>(request: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
	const { data, error, response } = await request;
	if (response.ok) return data as T;
	// /v1/verify still answers a flat {code, message} without fix or docs.
	const body = typeof error === 'object' && error ? ((error as Partial<Schemas['Error']>).error ?? (error as Partial<Schemas['Error']['error']>)) : undefined;
	if (body?.code) throw new IrisError(response.status, body.code, body.message ?? '', body.fix ?? '', body.docs ?? '');
	throw new IrisError(response.status, 'http_error', typeof error === 'string' && error ? error : response.statusText, '', '');
}

async function* paginate<T>(page: (cursor?: string) => Promise<{ data: T[]; next_cursor: string | null }>): AsyncGenerator<T, void, undefined> {
	let cursor: string | undefined;
	do {
		const p = await page(cursor);
		yield* p.data;
		cursor = p.next_cursor ?? undefined;
	} while (cursor);
}

type Query<P extends '/api/emails' | '/api/events' | '/api/stats'> = Omit<NonNullable<paths[P]['get']['parameters']['query']>, 'cursor'>;

/** Client of the Iris API. Use from your server only: the key must stay secret. Every method throws an IrisError on a non-2xx answer. */
export function createIris({ apiKey, version = API_VERSION, baseUrl = 'https://iris.orvlabs.com', headers, ...options }: IrisOptions) {
	const client = createClient<paths>({ ...options, baseUrl, headers: { ...headers, Authorization: `Bearer ${apiKey}`, 'Iris-Version': version } });
	return {
		/** Queues an email (202). Pass the same `idempotencyKey`, an order number for example, on a retry so it is not sent twice. */
		sendEmail: (body: SendEmailRequest, { idempotencyKey }: { idempotencyKey?: string } = {}) =>
			call(client.POST('/api/emails', { body, params: { header: { 'Idempotency-Key': idempotencyKey } } })),
		/** Every email of the key's project, newest first, fetching the next page as you iterate. */
		listEmails: (query: Query<'/api/emails'> = {}) =>
			paginate((cursor) => call(client.GET('/api/emails', { params: { query: { ...query, cursor } } }))),
		getEmail: (id: string) => call(client.GET('/api/emails/{id}', { params: { path: { id } } })),
		/** Cancels a scheduled email (its `id` or `batch_id`) that has not left yet, and gives its units back. */
		cancelEmail: (id: string) => call(client.POST('/api/emails/{id}/cancel', { params: { path: { id } } })),
		checkEmailAddresses: (body: AddressCheckRequest) => call(client.POST('/api/emails/check', { body })),
		/** Events of the key's project, newest first, fetching the next page as you iterate. */
		listEvents: (query: Query<'/api/events'> = {}) =>
			paginate((cursor) => call(client.GET('/api/events', { params: { query: { ...query, cursor } } }))),
		/** Totals over `from`..`to` (YYYY-MM-DD, UTC, both included); the last 30 days by default. */
		getStats: (query: Query<'/api/stats'> = {}) => call(client.GET('/api/stats', { params: { query } })),
		listSuppressions: () => paginate((cursor) => call(client.GET('/api/suppressions', { params: { query: { cursor } } }))),
		deleteSuppression: async (email: string): Promise<void> => {
			await call(client.DELETE('/api/suppressions/{email}', { params: { path: { email } } }));
		},
		revokeSecret: (id: string) => call(client.POST('/api/secrets/{id}/revoke', { params: { path: { id } } })),
		/** Downloads attachment `index` of an inbound email; its name and type are in the webhook's `attachments`. */
		getInboundAttachment: (delivery: string, index: number) =>
			call(client.GET('/api/inbound/{delivery}/attachments/{index}', { params: { path: { delivery, index } }, parseAs: 'blob' })),
		createVerification: (body: VerificationRequest) => call(client.POST('/v1/verify', { body })),
		checkVerification: (body: VerificationCheck) => call(client.POST('/v1/verify/check', { body })),
		cancelVerification: (id: string) => call(client.POST('/v1/verify/{id}/cancel', { params: { path: { id } } })),
		resendVerification: (id: string) => call(client.POST('/v1/verify/{id}/resend', { params: { path: { id } } })),
	};
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
