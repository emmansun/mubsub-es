## Context

The current `mubsub-es` subscription pipeline is built on MongoDB `capped collection + tailable cursor`. This approach is low-latency and simple on native MongoDB, but it strongly depends on backend capabilities. Mongo-compatible databases such as AWS DocumentDB do not support capped collections/tailable cursors, so subscriptions fail in those environments.

This change introduces a transport strategy with automatic fallback, while preserving the existing MongoDB path and API compatibility.

## Goals / Non-Goals

**Goals:**
- In default `mode=auto`, prefer the existing `capped+tailable` path.
- Automatically fall back to polling on a normal collection when capped/tailable is unavailable.
- Support explicit modes: `mode=capped` (force capped) and `mode=polling` (force polling).
- Support TTL cleanup policy for polling collections to avoid unbounded growth.
- Keep default semantics: consume only post-subscription messages (no replay) and preserve at-least-once delivery semantics.
- Maintain backward compatibility for existing parameters and call patterns.

**Non-Goals:**
- No exactly-once semantics.
- No change to core public API method signatures (`publish`/`subscribe`/`off`).
- No cross-process coordinator or external message middleware.

## Decisions

1. Introduce a transport mode selection layer (`auto|capped|polling`)
- Approach: choose mode during channel initialization and start the corresponding listener loop.
- Rationale: decouples capability detection/fallback from event dispatch, minimizing impact to existing emit logic.
- Alternative considered: only auto fallback with no explicit mode. Rejected due to poor operability for debugging and tuning.

2. Use a “capped first, polling fallback” strategy in `auto` mode
- Approach: attempt existing capped collection create/validation first; switch to polling when unsupported behavior is detected.
- Rationale: satisfies “prefer tailable when available” while preserving the low-latency path.
- Alternative considered: static detection via env/connection metadata. Rejected as unreliable across Mongo-compatible implementations.

3. Use `_id` high-watermark progression for polling
- Approach: initialize with current `latest _id`; poll with `_id > lastSeenId` in ascending order and reuse existing event dispatch per document.
- Rationale: avoids schema migration, remains compatible with current document format, and supports default no-replay behavior.
- Alternative considered: add sequence/timestamp index fields. Rejected because it requires migration and additional index changes.

4. Keep parameter compatibility
- Approach: keep `size/max/recreate`; apply only in capped mode and silently ignore in polling mode.
- Rationale: preserves compatibility while enabling new behavior.
- Alternative considered: redefine option semantics globally. Rejected due to migration ambiguity and extra cost.

5. Set default polling interval to `1000ms`
- Approach: add `pollInterval` (default `1000ms`) so callers can trade off latency vs cost.
- Rationale: conservative default that limits read pressure in compatibility-first environments.
- Alternative considered: lower defaults (100/250ms). Rejected due to significantly higher default read load.

6. Add optional TTL for polling collections
- Approach: add `pollTtlSeconds` (disabled by default), create a TTL index on a time field for polling collections, and write that time field on publish.
- Rationale: prevents unbounded growth and long-term query degradation in persistent polling deployments.
- Alternative considered: offline cleanup jobs managed by application teams. Rejected because cleanup timing is less predictable and operational burden increases.

## Risks / Trade-offs

- [Higher read cost in polling mode] → Provide `pollInterval` and document tuning guidance.
- [TTL too short can reduce message retention window] → Keep TTL disabled by default and document retention sizing by consumer lag window.
- [At-least-once may produce duplicates] → Keep semantics explicit and recommend consumer idempotency by message `_id`.
- [Fallback detection may misclassify errors] → Use recognizable unsupported-error patterns and allow explicit mode override.
- [Two listener paths increase maintenance complexity] → Share event dispatch/subscription APIs and isolate transport-specific fetch loops, with expanded tests.

## Migration Plan

1. Add mode configuration and initialization routing in `lib/channel.js`, while preserving the current tailable listener implementation.  
2. Implement polling listener loops and high-watermark progression logic.  
3. Forward `mode` and `pollInterval` through connection/entry layers.  
4. Add polling TTL configuration and TTL index initialization logic.  
5. Expand test coverage for `mode=capped`, `mode=polling`, and `mode=auto` fallback; include TTL scenarios: default-disabled `pollTtlSeconds`, TTL-enabled polling, TTL ignored in capped mode, and capped-only error path on existing non-capped collections.  
6. Update README and examples with mode behavior, TTL strategy, and semantic boundaries.  
7. Roll out progressively: validate `auto` behavior on both backend types in staging before production.

Rollback strategy: if compatibility regressions are found, temporarily force `mode=capped` (for capped-capable environments only) or roll back to the previous version.

## Open Questions

- Should unsupported-error matching for automatic fallback be configurable (for example, custom codes/keywords)?
- Should polling support an additional batch-size limit (for example, `batchSize`) to control per-cycle read volume?
- Should README include a dedicated list of known DocumentDB limitations for expectation management?
- Should the TTL time-field name be configurable, or should it remain an internal fixed field?
