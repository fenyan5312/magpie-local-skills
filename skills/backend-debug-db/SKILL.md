---
name: backend-debug-db
description: "系统性排查后端服务、API、ORM、SQL 与数据库故障，从取证到根因"
---
# Backend Debug and Database

Narrow the failing boundary; preserve evidence. Capture exact error, timestamp, correlation ID, environment, inputs, recent deploy/config/migration changes, and reproducibility. Trace handler -> validation/auth -> service -> dependency -> ORM/SQL -> transaction/commit. Compare expected/actual data; inspect schema, constraints, indexes, isolation, parameters, and generated SQL safely. For performance use EXPLAIN/plans, timings, row estimates, locks, pool saturation, and slow-query logs. For consistency inspect transaction boundaries, retries, idempotency, races, time zones, and cache invalidation. For migrations assess ordering, nullability, defaults, backfill size, locks, old-version compatibility, and rollback.

Make the smallest root-cause fix. Add a regression test or diagnostic guard. Validate success, invalid input, concurrency/retry, and recovery. Never delete data, disable constraints, expose secrets, or swallow errors to hide a DB problem. Report root cause, evidence, fix, verification, impact, and prevention; separate facts from hypotheses.
