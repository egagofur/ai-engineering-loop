# Query and Database Best Practices

Reference for database design, query optimization, and data access patterns.

## N+1 query prevention

N+1 happens when code fetches N parent records, then one query per parent for related data. Prevent it with joins, eager loading, or batch loading using `WHERE parent_id IN (...)`. Enable query logging in development to catch repeated query shapes.

## Index strategy

- B-tree indexes support equality, ranges, sorting, and prefix matching.
- Index foreign keys, frequent `WHERE` columns, and `ORDER BY` columns used in pagination.
- Composite indexes follow leftmost prefix: `(status, created_at)` supports `status` and `status + created_at`, not `created_at` alone.
- Partial indexes help when queries target a minority subset.
- Covering indexes help read-heavy queries when the index contains all selected columns.
- Avoid over-indexing write-heavy tables.

## Query anti-patterns

| Anti-pattern | Problem | Fix |
|---|---|---|
| `SELECT *` | Wastes bandwidth and may expose data | Select needed columns |
| Function in WHERE | Prevents index use | Use range predicates |
| Leading wildcard LIKE | Cannot use normal B-tree | Full-text or suffix strategy |
| Implicit conversion | Forces row conversion | Match types |
| OR across columns | Often skips indexes | UNION indexed queries |
| Unbounded list | Memory/latency risk | Pagination/limit |
| DISTINCT as fix | Hides bad joins | Fix join logic |
| Correlated subquery per row | Repeated work | JOIN/lateral/batch |

## Pagination

Offset: simple, supports jump to page N, degrades at high offsets.

Cursor: stable performance at depth, better for feeds/large datasets, cannot jump to arbitrary page.

## Transactions

Keep transactions short. Compute and validate before opening. Open, write, commit. Always rollback on failure.

Use the lowest isolation level that satisfies consistency. Higher isolation reduces throughput.

## Bulk operations

Use batch inserts/updates/deletes instead of per-row loops. Start with batches around 500–1000 rows and tune.

## Migrations

Prefer additive migrations for zero-downtime deploys. For renames/removals: add new, migrate data, deploy code, then remove old later. Never edit migrations already applied to shared environments.

## Connection pooling

Start with conservative pool sizes, monitor utilization and latency, then adjust. Too few connections queue requests; too many exhaust database resources.
