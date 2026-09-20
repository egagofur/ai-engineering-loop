# API Design Guidelines

Reference for designing consistent, predictable REST APIs.

## HTTP method semantics

| Method | Purpose | Idempotent | Safe | Typical Success |
|---|---|---|---|---|
| GET | Retrieve resources | Yes | Yes | 200 |
| POST | Create resource | No | No | 201 |
| PUT | Replace resource | Yes | No | 200 |
| PATCH | Partially update | Yes | No | 200 |
| DELETE | Remove resource | Yes | No | 200 or 204 |

## Resource URL patterns

```text
GET    /v1/products
POST   /v1/products
GET    /v1/products/{id}
PUT    /v1/products/{id}
PATCH  /v1/products/{id}
DELETE /v1/products/{id}
```

Sub-resources should usually stop at two levels:

```text
GET /v1/users/{id}/orders
GET /v1/users/{id}/orders/{order_id}
```

For non-CRUD operations, use action sub-resources sparingly:

```text
POST /v1/orders/{id}/cancel
POST /v1/users/{id}/verify-email
POST /v1/reports/generate
```

## Response envelopes

Success:

```json
{ "status_code": 200, "message": "Success", "data": {} }
```

Paginated success:

```json
{
  "status_code": 200,
  "message": "Success",
  "data": [],
  "meta": { "total": 150, "page": 3, "limit": 20, "total_pages": 8 }
}
```

Error:

```json
{
  "status_code": 422,
  "message": "Validation failed",
  "error": "VALIDATION_ERROR",
  "details": [{ "field": "email", "message": "must be a valid email address" }]
}
```

## Pagination

Offset pagination: `page`, `limit`. Cap `limit`.

Cursor pagination: `after`, `limit`, response `next_cursor`. Prefer for feeds and large datasets.

## Filtering and sorting

Filters as query params: `?status=active&role=admin`.

Sort with allow-listed fields: `?sort=-created_at,name`.

Reject unsupported filters/sorts instead of silently ignoring them.

## Bulk operations

Batch create/delete should report partial success when appropriate. Include per-item errors with indexes or IDs.

## Long-running operations

Return `202 Accepted` with a task ID, process asynchronously, and expose a status endpoint.

## Versioning

Use URL path versioning (`/v1`). Never introduce breaking changes to a published version. Adding optional fields/endpoints is usually non-breaking; removing fields or changing types is breaking.
