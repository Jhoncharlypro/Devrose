# backend/api/utils/

Reserved for **cross-cutting helpers** that don't belong to any one view,
model, or serializer — date format converters, slug builders, regex
constants used in multiple apps, etc.

Currently empty by design. Importing from `api.utils.X` is acceptable (and
preferred) over redefining the same helper inside a view. If you end up
adding helpers that ARE specific to a single feature, push them into
`api/views/<feature>.py` or a feature-local module instead.
