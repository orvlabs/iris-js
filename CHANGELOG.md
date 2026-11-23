# Changelog

## 0.2.0

Breaking: the client moves to the Iris public API under `/api`.

- `createIris()` returns one method per route (`sendEmail`, `listEmails`, `getEmail`, `cancelEmail`, `checkEmailAddresses`, `listEvents`, `getStats`, `listSuppressions`, `deleteSuppression`, `revokeSecret`, `getInboundAttachment`, `createVerification`, `checkVerification`, `cancelVerification`, `resendVerification`) instead of the raw `GET`/`POST` client.
- The key is sent as `Authorization: Bearer`; `Iris-Version` defaults to `API_VERSION` (`2026-11-23`), set another with `version`.
- Request and answer bodies are snake_case: `from`, `to`, `html`, `text`, `template`, `data`, `attachments[].filename`, `send_at`, `payment.amount_xof`.
- `sendEmail(body, { idempotencyKey })` sends `Idempotency-Key`.
- List methods return an async iterator over every page.
- Errors throw `IrisError` with `status`, `code`, `message`, `fix` and `docs`; the `IrisError` type alias is now this class.
- Webhook verification is unchanged.

## 0.1.1

- Typed client generated from the OpenAPI document, Standard Webhooks and `X-Iris-Signature` verification.
