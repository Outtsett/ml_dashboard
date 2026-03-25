# ILPClient + MotiveWave SDK Type Safety Audit

**Date:** 2025-07-18
**Files audited:**
- `util/ILPClient.java`
- `QuestDBStreamStudy.java`
- `sdk-api-dump.txt` (javap output of MotiveWave SDK)

---

## 1. Tick Data Type Mismatches

**SDK `Tick` interface (lines 1637–1679 of dump):**

| Method           | SDK Return Type | `writeTick` Param Type | Match? |
|------------------|-----------------|------------------------|--------|
| `getPrice()`     | `float`         | `float price`          | ✅      |
| `getVolume()`    | `int`           | `int volume`           | ✅      |
| `getBidPrice()`  | `float`         | `float bid`            | ✅      |
| `getAskPrice()`  | `float`         | `float ask`            | ✅      |
| `getBidSize()`   | `int`           | `int bidSize`          | ✅      |
| `getAskSize()`   | `int`           | `int askSize`          | ✅      |
| `isAskTick()`    | `boolean`       | `boolean isAskTick`    | ✅      |
| `getTime()`      | `long`          | `long epochMs`         | ✅      |

> **Note:** The SDK also provides `getVolumeAsFloat()`, `getBidSizeAsFloat()`,
> `getAskSizeAsFloat()` for fractional-lot instruments (forex). Current code uses
> the `int` versions, which is correct for equities/futures but will **truncate**
> fractional sizes in forex. Not a compilation error, but something to revisit if
> targeting forex micro-lots.

### ✅ PASS — All Tick types match `writeTick()` parameter types exactly.

---

## 2. DOMRow Data Type Mismatches

**SDK `DOMRow` interface (lines 2025–2040 of dump):**

| Method            | SDK Return Type | Variable Type in `update(DOM)` | Match? |
|-------------------|-----------------|--------------------------------|--------|
| `getPrice()`      | `float`         | `float price`                  | ✅      |
| `getSize()`       | `float`         | `float size`                   | ✅      |
| `getOrderCount()` | `int`           | `int orderCount`               | ✅      |

`writeDOMRow(... float price, float size, int orderCount ...)` also matches.

### ✅ PASS — All DOMRow types match.

---

## 3. ILP Protocol Correctness

### 3a. Tag value escaping

`escapeTagValue()` escapes `,` ` ` `=` — correct per ILP spec.

| Call site              | Escaped? | Verdict |
|------------------------|----------|---------|
| Table name             | ✅ via `escapeTagValue(table)` | ✅ |
| `symbol=` tag value    | ✅ via `escapeTagValue(symbol)` | ✅ |
| `side=` in `writeTick` | Hardcoded `"ask"`/`"bid"` — safe | ✅ |
| `side=` in `writeDOMRow` | ⚠️ `side` param is **not** escaped | See below |

### ⚠️ WARNING — `writeDOMRow` `side` parameter not escaped

The callers currently pass only `"bid"` or `"ask"` (no special chars), so this
is safe **today**. But the method signature accepts any `String`, making it
fragile to future misuse.

**Suggested fix:**
```java
// writeDOMRow line 137
lineBuffer.append(",side=").append(escapeTagValue(side));
```

### 3b. Field integer `i` suffix

| Field            | Type    | Has `i` suffix? | Correct? |
|------------------|---------|-----------------|----------|
| `volume` (OHLCV) | `long`  | ✅ `append('i')` | ✅ |
| `volume` (tick)   | `int`   | ✅ `append('i')` | ✅ |
| `bid_size`        | `int`   | ✅ `append('i')` | ✅ |
| `ask_size`        | `int`   | ✅ `append('i')` | ✅ |
| `level`           | `int`   | ✅ `append('i')` | ✅ |
| `order_count`     | `int`   | ✅ `append('i')` | ✅ |
| `bid_levels`      | `int`   | ✅ `append('i')` | ✅ |
| `ask_levels`      | `int`   | ✅ `append('i')` | ✅ |

### 3c. Field float values (no suffix)

All float fields (`open`, `high`, `low`, `close`, `price`, `bid`, `ask`,
`spread`, `size`, `best_bid`, `best_ask`, `total_bid_size`, `total_ask_size`,
`imbalance`) are appended **without** `i` — correct.

### 3d. Timestamp nanoseconds

All four write methods convert with `epochMs * 1_000_000L` (ms → ns). ✅

### 3e. Lines end with `\n`

All four write methods append `'\n'` as the final character. ✅

### 3f. Spread computation

```java
lineBuffer.append(",spread=").append(ask - bid);  // float - float = float
```

Arithmetic is correct. Result is a `float`, appended without `i` suffix (ILP
float field). ✅

### ✅ PASS — ILP protocol formatting is correct.

---

## 4. Timestamp Handling

| Source                     | SDK Return  | Unit        | Conversion             | Correct? |
|----------------------------|-------------|-------------|------------------------|----------|
| `tick.getTime()`           | `long`      | epoch ms    | `× 1_000_000L` → ns   | ✅        |
| `series.getStartTime(int)` | `long`      | epoch ms    | `× 1_000_000L` → ns   | ✅        |
| `System.currentTimeMillis()` (DOM) | `long` | epoch ms | `× 1_000_000L` → ns  | ✅        |

MotiveWave SDK uses epoch milliseconds for all timestamp methods (`long`
descriptor `()J`). The `× 1_000_000L` multiplier correctly converts to
nanoseconds as required by ILP.

### ✅ PASS — Timestamp conversions are correct.

---

## 5. Volume Type

| Source                    | SDK Return | `writeOHLCV` Param | Match? |
|---------------------------|------------|--------------------|--------|
| `series.getVolume(int)`   | `long`     | `long volume`      | ✅      |

| Source                    | SDK Return | `writeTick` Param  | Match? |
|---------------------------|------------|--------------------|--------|
| `tick.getVolume()`        | `int`      | `int volume`       | ✅      |

### ✅ PASS — Volume types match in both call sites.

---

## 6. DOM Generic Type Safety

**SDK signatures:**
```
public abstract java.util.List getAskRows();   // raw type
public abstract java.util.List getBidRows();    // raw type
```

**Usage in `QuestDBStreamStudy`:**
```java
List<?> bidRows = dom.getBidRows();
DOMRow row = (DOMRow) bidRows.get(i);
```

Using `List<?>` is correct for capturing a raw-type return. The cast to
`DOMRow` is safe because:
1. The `DOMRow` interface exists in the same package (`com.motivewave.platform.sdk.common`)
2. DOM rows are documented as `DOMRow` instances
3. The `DOMRow` methods (`getPrice()`, `getSize()`, `getOrderCount()`) are
   successfully called immediately after the cast

The compiler will emit an unchecked-cast warning, but this is expected when
working with pre-generics SDK interfaces.

### ⚠️ WARNING — Unchecked cast from raw `List` to `DOMRow`. Safe at runtime; add `@SuppressWarnings("unchecked")` to silence compiler warning.

---

## 7. Thread Safety

### ❌ FAIL — Concurrent access to `ILPClient` from multiple threads

**Problem:**

| Callback        | Thread              | Accesses          |
|-----------------|---------------------|--------------------|
| `onBarClose()`  | Study calc thread   | `client.writeOHLCV()`, `client.flush()` |
| `onTick()`      | Study calc thread   | `client.writeTick()`, `client.flush()` |
| `update(DOM)`   | Market data thread  | `client.writeDOMRow()`, `client.writeDOMSummary()`, `client.flush()` |

`ILPClient` is **not** thread-safe:
- **`lineBuffer`** (`StringBuilder`) — concurrent `append()` calls will
  interleave characters, producing malformed ILP lines
- **`out`** (`BufferedOutputStream`) — concurrent `write()` calls can
  interleave byte arrays mid-line
- **`pendingLines` / `totalLinesSent`** — non-atomic `++` (data race)
- **`ensureConnected()`** — TOCTOU race: two threads can both see
  `!isConnected()` and create duplicate sockets

**Consequence:** Malformed ILP lines → QuestDB parse errors → silently dropped
data or broken connections.

### Fix (Option A — Synchronized wrapper, minimal change):

Add a lock object to `QuestDBStreamStudy`:

```java
// Add field
private final Object clientLock = new Object();

// Wrap every client access block in synchronized(clientLock)
// Example for onTick:
try {
    synchronized (clientLock) {
        ensureClient();
        client.writeTick(table, symbol, ...);
        totalTicksSent++;
        if (totalTicksSent % 50 == 0) client.flush();
    }
} catch (IOException e) {
    handleConnectionError(e);
}
```

Apply the same `synchronized (clientLock) { ... }` pattern to:
- `onBarClose()` — around the `ensureClient()` through `client.flush()` block
- `update(DOM)` — around the entire `ensureClient()` through `client.flush()` block
- `handleConnectionError()` — around `client.close(); client = null;`
- `clearState()` — around `client.close(); client = null;`

### Fix (Option B — Per-thread clients):

Use separate `ILPClient` instances for bar/tick data vs DOM data. Avoids
contention entirely but doubles connection count.

### Fix (Option C — Lock-free queue):

Queue ILP lines from all threads into a `ConcurrentLinkedQueue<String>`, drain
on a dedicated writer thread. Best throughput but more complex.

**Recommendation:** Option A. Synchronized blocks add < 1μs overhead and the
DOM throttle (100ms default) means contention is rare.

---

## 8. Additional Findings

### ⚠️ WARNING — `isConnected()` may report stale state

```java
public boolean isConnected() {
    return socket != null && socket.isConnected() && !socket.isClosed();
}
```

`Socket.isConnected()` returns `true` as long as `connect()` was called — it
does **not** detect a half-closed TCP connection (server-side RST/FIN). The
code does handle this via IOException on write + reconnect in
`handleConnectionError()`, so this is not a critical issue.

### ⚠️ WARNING — Forex fractional volumes truncated

`Tick.getVolume()` returns `int`, but the SDK also offers
`Tick.getVolumeAsFloat()` for instruments with fractional lot sizes (e.g.,
forex micro-lots at 0.01). Similarly `getBidSizeAsFloat()` /
`getAskSizeAsFloat()`. Current code uses the `int` versions, which will
truncate sub-unit volumes to 0.

**If targeting forex:** consider switching to the `AsFloat` variants and
changing `writeTick` volume/size params to `float`.

---

## Summary

| # | Check                          | Result      |
|---|--------------------------------|-------------|
| 1 | Tick types vs `writeTick()`    | ✅ PASS      |
| 2 | DOMRow types vs `writeDOMRow()`| ✅ PASS      |
| 3 | ILP protocol formatting        | ✅ PASS      |
| 4 | Timestamp ms→ns conversion     | ✅ PASS      |
| 5 | Volume type matching           | ✅ PASS      |
| 6 | DOM raw List → DOMRow cast     | ⚠️ WARNING  |
| 7 | Thread safety                  | ❌ FAIL      |
| 8a| `isConnected()` reliability    | ⚠️ WARNING  |
| 8b| `writeDOMRow` side not escaped | ⚠️ WARNING  |
| 8c| Forex fractional volume        | ⚠️ WARNING  |

**Critical action required:** Fix #7 (thread safety) before production use.
