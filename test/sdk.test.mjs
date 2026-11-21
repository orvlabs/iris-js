import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Webhook } from 'standardwebhooks';
import { createIris, verifyPaymentWebhook, verifyWebhook } from '../dist/index.js';

test('sends the api-key header to the base URL', async () => {
	let seen;
	const fetch = async (req) => { seen = req; return new Response('{"messageId":"m1"}', { status: 201, headers: { 'content-type': 'application/json' } }); };
	const iris = createIris({ apiKey: 'iris_test_x', baseUrl: 'http://x', fetch });
	const { data } = await iris.POST('/v3/smtp/email', { body: { sender: { email: 'a@b.sn' }, to: [{ email: 'c@d.sn' }], subject: 's', htmlContent: 'h' } });
	assert.equal(seen.url, 'http://x/v3/smtp/email');
	assert.equal(seen.headers.get('api-key'), 'iris_test_x');
	assert.equal(data.messageId, 'm1');
});

test('verifies a Standard Webhooks delivery', () => {
	const secret = 'whsec_' + Buffer.from('secret-secret-secret').toString('base64');
	const body = '{"id":"e1"}', id = 'msg_1', ts = new Date();
	const headers = { 'webhook-id': id, 'webhook-timestamp': String(Math.floor(ts / 1000)), 'webhook-signature': new Webhook(secret).sign(id, ts, body) };
	assert.deepEqual(verifyWebhook(secret, body, headers), { id: 'e1' });
	assert.throws(() => verifyWebhook(secret, body + ' ', headers));
	assert.deepEqual(verifyWebhook(secret, body, new Headers(headers)), { id: 'e1' });
});

test('verifies X-Iris-Signature, including during rotation', () => {
	const ts = String(Math.floor(Date.now() / 1000)), body = '{"id":"p1"}';
	const sig = (k) => 'v1=' + createHmac('sha256', k).update(`${ts}.${body}`).digest('hex');
	assert.ok(verifyPaymentWebhook('new', body, ts, sig('new')));
	assert.ok(verifyPaymentWebhook('old', body, ts, `${sig('new')} ${sig('old')}`));
	assert.ok(!verifyPaymentWebhook('other', body, ts, sig('new')));
	assert.ok(!verifyPaymentWebhook('new', body, '1', sig('new')));
});
