## Why

The current implementation depends on MongoDB capped collections and tailable cursors for real-time subscription. In Mongo-compatible environments that do not support capped/tailable behavior (such as AWS DocumentDB), pub/sub does not work, which limits deployment options.

## What Changes

- Add configurable transport modes: `mode = auto | capped | polling`.
- In default `auto` mode, prefer the existing `capped + tailable` path; automatically fall back to polling on a normal collection when unsupported.
- Add `pollInterval` to control polling frequency (default `1000ms`).
- Add polling collection TTL configuration (for example `pollTtlSeconds`) to clean up expired messages and prevent long-term buildup from affecting query performance.
- Preserve existing semantics: consume only messages published after subscription start by default (no historical replay), and keep at-least-once delivery semantics.
- Keep existing capped-related options (`size`, `max`, `recreate`) and ignore them in polling mode without breaking API compatibility.

## Capabilities

### New Capabilities
- `mongo-transport-fallback`: ensure pub/sub remains available in Mongo-compatible environments without capped/tailable support by automatically falling back to polling, while still allowing explicit `auto/capped/polling` mode selection.

### Modified Capabilities
- None.

## Impact

- Affected code:
  - `lib/channel.js` (initialization, mode selection, listener main loops, fallback logic)
  - `lib/connection.js` / `lib/index.js` (forwarding mode and polling options)
  - `test/channel.js` (new coverage for auto/capped/polling paths)
  - `README.md` and `example/*` (configuration and behavior updates)
- API impact:
  - New optional configuration: `mode`, `pollInterval`, `pollTtlSeconds`
  - Existing API remains backward compatible
- Runtime impact:
  - Polling mode increases query frequency and read cost; latency depends on `pollInterval`
  - TTL cleanup automatically removes old messages when enabled, reducing long-term growth risk in polling collections
