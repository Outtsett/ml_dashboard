# Add SSE Delta Encoding

Adds delta encoding to an SSE event type to reduce bandwidth.

## Instructions

Target SSE event: $ARGUMENTS

### Step 1: Identify the Parser

Search `src/server/training/runners/parsers/` for the parser that emits the target event type. Look for `emitSessionEvent(session, 'EVENT_TYPE', ...)`.

### Step 2: Add Delta State Tracking

In the parser class, add instance variables:

```typescript
import { computeDelta, DELTA_MARKER, FULL_SNAPSHOT_INTERVAL } from '@shared/delta';

// In class:
private previousState: Record<string, unknown> | null = null;
private stateCount = 0;
```

### Step 3: Apply Delta Pattern

Replace the direct `emitSessionEvent` call with this pattern:

```typescript
this.stateCount++;
const forceFullSnapshot = this.stateCount % FULL_SNAPSHOT_INTERVAL === 1 || !this.previousState;

if (forceFullSnapshot) {
  emitSessionEvent(session, 'event_type', payload);
  this.previousState = payload;
} else {
  const delta = computeDelta(this.previousState!, payload);
  const deltaSize = JSON.stringify(delta).length;
  const fullSize = JSON.stringify(payload).length;

  if (deltaSize < fullSize * 0.5) {
    emitSessionEvent(session, 'event_type', {
      [DELTA_MARKER]: true,
      iteration: payload.iteration,
      ...delta,
    });
  } else {
    emitSessionEvent(session, 'event_type', payload);
  }
  this.previousState = payload;
}
```

### Step 4: Update Client Handler

In the client SSE handler (e.g., `src/client/src/lib/training/sse_handlers.ts`), add delta detection:

```typescript
import { applyDelta, DELTA_MARKER } from '@shared/delta';

// Module-level state:
let lastFullState: Record<string, unknown> | null = null;

// In handler:
let resolved: Record<string, unknown>;
if ((d as any)[DELTA_MARKER] && lastFullState) {
  resolved = applyDelta(lastFullState, d as Record<string, unknown>);
} else {
  resolved = d as Record<string, unknown>;
}
lastFullState = resolved;
```

### Key Files
- `src/shared/delta.ts` — computeDelta, applyDelta, DELTA_MARKER, FULL_SNAPSHOT_INTERVAL
- `src/server/training/runners/parsers/hdpHmmParser.ts` — Reference implementation (model_state)
- `src/client/src/lib/training/sse_handlers.ts` — Client-side delta application
