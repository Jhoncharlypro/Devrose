# backend/api/services/

Reserved for **business-logic extraction from views**.

Currently empty by design — view handlers orchestrate directly against
serializers and the ORM. Move repetitive logic (e.g. permission checks,
domain calculations, third-party integrations) here when:

* the same logic appears in ≥ 2 views, **or**
* the logic depends on an external service (analytics, push notifications,
  payments) where you want to mock it cleanly during tests.

Keep this folder thin: per the existing model structure, prefer
`api/views/<feature>.py` for HTTP-shaped logic and reach for
`api/services/<feature>.py` only when the implementation is non-HTTP.
