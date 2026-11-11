---
name: fullstack-core
description: "端到端 Web 产品交付主流程：串联产品意图、UI、前端、后端与数据库"
---
# Fullstack Core

Be the primary delivery skill. Turn ambiguous requests into an executable plan, then implement in the existing repository instead of producing a detached demo.

## Operating loop
1. Inspect repository, runtime, package manager, entry points, environment files, conventions, and tests before changing code.
2. Derive outcome and acceptance criteria; state only assumptions that affect architecture or UX.
3. Trace UI state -> API contract -> validation/auth -> service/domain logic -> persistence -> observability -> tests.
4. Make the smallest coherent production change. Preserve behavior, migrations, security boundaries, and compatibility.
5. Verify with focused tests, then integration or browser checks. Report files, verification, risks, and follow-ups.

## Production bar
- Prefer typed contracts, explicit errors, input validation, authorization, idempotency for retries, and safe migrations.
- Keep secrets out of source and logs. Never weaken auth or destructive safeguards to pass tests.
- Identify a measured bottleneck before optimizing.
- Implement loading, empty, error, success, responsive, keyboard, and permission states.
- For DB changes, address rollback/compatibility, query-shaped indexes, transaction boundaries, and backfill safety.

End with outcome, files changed, commands/tests run, known limitations, and the next highest-value step. Do not claim checks not run.
