# MotiveWave Plugin — QuestDB ILP Stream

Java plugin for the MotiveWave trading platform that streams real-time market data to QuestDB via the Influx Line Protocol (ILP) over TCP.

## What It Does

Runs as a MotiveWave "Study" that captures three data streams from the live trading platform and writes them directly to QuestDB:

| Stream | Data | Flush Strategy |
|---|---|---|
| **OHLCV** | Open, high, low, close, volume + orderflow fields (vwap, trades, vol_at_bid, vol_at_ask, trades_at_bid, trades_at_ask) | Per bar close |
| **Ticks** | Price, volume, bid/ask BBO, spread, exchange order IDs, side | Every 50 ticks or 2s timeout |
| **DOM L2** | 10-50 price levels per side, order count per level | 100ms throttle (configurable) |
| **DOM Summary** | Best bid/ask, spread, total depth, imbalance | With each DOM update |

## Architecture

```
MotiveWave SDK
    |
    v
QuestDBStreamStudy.java    <-- @StudyHeader annotation, lifecycle hooks
    |
    v
util/ILPClient.java        <-- Lightweight TCP client, line protocol construction, auto-reconnect
    |
    v
QuestDB ILP TCP :9009      <-- Direct ingestion, no HTTP overhead
```

## Key Files

| File | Purpose |
|---|---|
| `src/main/java/.../QuestDBStreamStudy.java` | Main study class: bar listener, tick listener, DOM listener, ILP batching |
| `src/main/java/.../util/ILPClient.java` | TCP socket client for ILP protocol: line construction, reconnect logic, `TCP_NODELAY` |
| `pom.xml` | Maven build config (depends on `mwave_sdk.jar` from MotiveWave installation) |
| `.mvn/jvm.config` | JVM flags (`--enable-native-access`) |
| `dist/MLDashboardPlugin.jar` | Built JAR, deployed to `~/MotiveWave Extensions/` |

## Building

```bash
cd src/motivewave-plugin
mvn package
# Output: dist/MLDashboardPlugin.jar
# Copy to: ~/MotiveWave Extensions/
```

**Prerequisites**: JDK 17+, Maven, MotiveWave SDK at `E:/MotiveWave/lib/mwave_sdk.jar`

## Asset Class Detection

The plugin auto-derives `asset_class` (futures, forex, equity, crypto) and `root` symbol from the MotiveWave SDK `Instrument.getType()` API. This matches the server-side `deriveAssetFields()` logic, ensuring consistent partitioning in the unified QuestDB `ohlcv` table.

## Audit Documentation

- `AUDIT_ILP.md` — ILP protocol correctness audit
- `AUDIT_STREAM.md` — Data streaming reliability audit
- `AUDIT_EXPORT.md` — Export format audit
