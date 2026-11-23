import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { Webhook } from 'standardwebhooks';
import { createIris, IrisError, verifyPaymentWebhook, verifyWebhook } from '../dist/index.js';

async function serve(handler) {
	const seen = [];
	const server = createServer(async (req, res) => {
		let body = '';
		for await (const chunk of req) body += chunk;
		seen.push({ method: req.method, url: req.url, headers: req.headers, body: body && JSON.parse(body) });
		const [status, payload, type = 'application/json'] = handler(req);
		res.writeHead(status, { 'content-type': type }).end(typeof payload === 'string' ? payload : JSON.stringify(payload));
	});
	await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
	test.after(() => server.close());
	return { seen, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('sends with the Bearer key, the API version and the idempotency key', async () => {
	const { seen, baseUrl } = await serve(() => [202, { id: 'm1', status: 'queued' }]);
	const iris = createIris({ apiKey: 'iris_test_x', baseUrl });
	const sent = await iris.sendEmail({ from: 'Boutique <commandes@boutique.sn>', to: 'awa+factures@example.sn', subject: 'Reçu', html: '<p>Merci</p>' }, { idempotencyKey: 'CMD-2041' });
	assert.deepEqual(sent, { id: 'm1', status: 'queued' });
	const [req] = seen;
	assert.equal(`${req.method} ${req.url}`, 'POST /api/emails');
	assert.equal(req.headers.authorization, 'Bearer iris_test_x');
	assert.equal(req.headers['iris-version'], '2026-11-23');
	assert.equal(req.headers['idempotency-key'], 'CMD-2041');
	assert.equal(req.body.to, 'awa+factures@example.sn');

	await createIris({ apiKey: 'k', baseUrl, version: '2027-01-01' }).sendEmail({ from: 'a@b.sn', to: 'c@d.sn' });
	assert.equal(seen[1].headers['iris-version'], '2027-01-01');
	assert.equal(seen[1].headers['idempotency-key'], undefined);
});

test('throws an IrisError with code, message, fix, docs and status', async () => {
	const error = { code: 'not_enough_credits', message: 'Crédits épuisés', fix: 'Rechargez des crédits', docs: 'https://iris.orvlabs.com/docs/erreurs#not_enough_credits' };
	const { baseUrl } = await serve((req) => {
		if (req.url.startsWith('/api/emails/')) return [404, '404 page not found', 'text/plain'];
		if (req.url.startsWith('/v1/')) return [404, { code: 'not_found', message: 'Vérification introuvable' }];
		return [402, { error }];
	});
	const iris = createIris({ apiKey: 'k', baseUrl });
	await assert.rejects(iris.sendEmail({ from: 'a@b.sn' }), (e) => {
		assert.ok(e instanceof IrisError);
		assert.deepEqual({ status: e.status, code: e.code, message: e.message, fix: e.fix, docs: e.docs }, { status: 402, ...error });
		return true;
	});
	await assert.rejects(iris.getEmail('x'), { name: 'IrisError', status: 404, code: 'http_error', message: '404 page not found' });
	await assert.rejects(iris.cancelVerification('v1'), { status: 404, code: 'not_found', message: 'Vérification introuvable', fix: '' });
});

test('iterates every page of a list', async () => {
	const pages = { '': { data: [{ email: 'a@b.sn' }, { email: 'c@d.sn' }], next_cursor: 'p2' }, p2: { data: [{ email: 'e@f.sn' }], next_cursor: null } };
	const { seen, baseUrl } = await serve((req) => [200, pages[new URL(req.url, 'http://x').searchParams.get('cursor') ?? '']]);
	const emails = [];
	for await (const s of createIris({ apiKey: 'k', baseUrl }).listSuppressions()) emails.push(s.email);
	assert.deepEqual(emails, ['a@b.sn', 'c@d.sn', 'e@f.sn']);
	assert.deepEqual(seen.map((r) => r.url), ['/api/suppressions', '/api/suppressions?cursor=p2']);
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
