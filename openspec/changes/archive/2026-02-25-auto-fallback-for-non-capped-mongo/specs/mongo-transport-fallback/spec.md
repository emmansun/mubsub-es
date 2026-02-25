## ADDED Requirements

### Requirement: Channel transport mode selection
The system SHALL support channel transport mode selection with `auto`, `capped`, and `polling` values.

#### Scenario: Uses auto mode by default
- **WHEN** a channel is created without an explicit `mode` option
- **THEN** the channel transport mode SHALL be `auto`

#### Scenario: Honors explicit mode selection
- **WHEN** a channel is created with `mode` set to `capped` or `polling`
- **THEN** the implementation SHALL use the explicitly selected mode

### Requirement: Auto mode prefers capped and falls back to polling
In `auto` mode, the system SHALL prefer `capped + tailable` transport and SHALL automatically fallback to polling when capped/tailable capabilities are unavailable.

#### Scenario: Uses capped transport when supported
- **WHEN** `mode=auto` and the backend supports capped collection and tailable cursor behavior
- **THEN** the channel SHALL start and consume events through the capped/tailable transport path

#### Scenario: Falls back to polling when capped is unsupported
- **WHEN** `mode=auto` and capped collection or tailable cursor behavior is unsupported by the backend
- **THEN** the channel SHALL start and consume events through the polling transport path without requiring caller-side changes

### Requirement: Polling transport continuity
The polling transport SHALL consume newly published events by advancing a monotonic high-water mark and SHALL preserve at-least-once delivery semantics.

#### Scenario: Delivers new events in polling mode
- **WHEN** a subscriber is active in `polling` mode and new messages are published
- **THEN** the subscriber SHALL receive those messages in polling cycles after publication

#### Scenario: Preserves at-least-once semantics on transient errors
- **WHEN** transient errors or reconnect conditions occur in `polling` mode
- **THEN** delivery semantics SHALL remain at-least-once and may include duplicates

### Requirement: No historical replay by default
Subscriptions SHALL consume only messages published after subscription startup unless a future feature explicitly enables replay.

#### Scenario: Skips historical messages for late subscribers in capped mode
- **WHEN** messages were published before a subscriber starts in capped transport
- **THEN** the late subscriber SHALL NOT receive those historical messages by default

#### Scenario: Skips historical messages for late subscribers in polling mode
- **WHEN** messages were published before a subscriber starts in polling transport
- **THEN** the late subscriber SHALL NOT receive those historical messages by default

### Requirement: Polling interval configurability
The system SHALL provide a configurable polling interval for polling transport, with a default interval of 1000 milliseconds.

#### Scenario: Applies default polling interval
- **WHEN** polling transport is used and `pollInterval` is not provided
- **THEN** the polling cycle SHALL run with a default interval of 1000 milliseconds

#### Scenario: Applies custom polling interval
- **WHEN** polling transport is used and `pollInterval` is provided
- **THEN** the polling cycle SHALL run with the configured interval

### Requirement: Polling collection TTL retention
The system SHALL support optional TTL retention for polling transport collections through a `pollTtlSeconds` configuration value.

#### Scenario: Keeps TTL disabled by default
- **WHEN** polling transport is used and `pollTtlSeconds` is not provided
- **THEN** the system SHALL NOT require a TTL policy to initialize channel subscriptions

#### Scenario: Enables TTL cleanup when configured
- **WHEN** polling transport is used and `pollTtlSeconds` is provided with a positive value
- **THEN** the system SHALL apply a TTL cleanup policy for polling messages so expired messages are automatically removed

#### Scenario: Ignores TTL configuration in capped mode
- **WHEN** capped transport is active and `pollTtlSeconds` is provided
- **THEN** the system SHALL ignore `pollTtlSeconds` without failing channel initialization

### Requirement: Backward-compatible options handling
Existing capped-related options (`size`, `max`, `recreate`) SHALL remain accepted by the API.

#### Scenario: Applies capped options in capped mode
- **WHEN** capped transport is active and capped-related options are provided
- **THEN** the system SHALL apply those options to capped collection behavior

#### Scenario: Ignores capped options in polling mode
- **WHEN** polling transport is active and capped-related options are provided
- **THEN** the system SHALL ignore those options without failing channel initialization
