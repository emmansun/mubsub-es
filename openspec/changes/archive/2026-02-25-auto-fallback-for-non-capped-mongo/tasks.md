## 1. Transport Mode Architecture

- [x] 1.1 Add channel options `mode` (`auto|capped|polling`) and `pollInterval` (default `1000`) with backward-compatible defaults.
- [x] 1.2 Refactor channel initialization to resolve transport mode before starting listeners.
- [x] 1.3 Implement explicit mode handling: `capped` forces tailable path, `polling` forces polling path, `auto` attempts capped then fallback.

## 2. Capped and Fallback Behavior

- [x] 2.1 Preserve existing capped collection create/validate flow for capped-capable backends.
- [x] 2.2 Add unsupported-capability error detection and automatic fallback from capped to polling in `auto` mode.
- [x] 2.3 Ensure `capped` mode surfaces initialization errors instead of silently falling back.

## 3. Polling Transport Implementation

- [x] 3.1 Implement polling listener loop using `_id` high-water mark (`_id > lastSeenId`, ascending order).
- [x] 3.2 Reuse existing event dispatching (`event`, `message`, `document`) so subscriber behavior remains consistent.
- [x] 3.3 Enforce default no-history behavior by initializing polling start point at latest message at subscription startup.
- [x] 3.4 Ignore capped-only options (`size`, `max`, `recreate`) in polling mode without breaking API calls.
- [x] 3.5 Add optional `pollTtlSeconds` config and apply TTL policy for polling collections when enabled.
- [x] 3.6 Ensure message documents include the required time field for TTL expiration evaluation.

## 4. Tests and Regression Coverage

- [x] 4.1 Add/adjust channel tests for forced `polling` mode publish-subscribe behavior.
- [x] 4.2 Add/adjust channel tests for `auto` mode fallback when capped/tailable is unavailable.
- [x] 4.3 Verify no-history replay and unsubscribe semantics in both capped and polling modes.
- [x] 4.4 Add tests for TTL edge cases: `pollTtlSeconds` default-disabled, enabled in polling mode, and ignored in capped mode (including capped-only error path on non-capped existing collections).
- [x] 4.5 Run full test suite and resolve regressions introduced by the change.

## 5. Documentation and Examples

- [x] 5.1 Update README with transport modes, fallback behavior, delivery semantics, and `pollInterval`/`pollTtlSeconds` guidance.
- [x] 5.2 Update examples to show optional `mode`, `pollInterval`, and `pollTtlSeconds` usage.
- [x] 5.3 Document compatibility expectations for Mongo-compatible backends that do not support capped/tailable.
