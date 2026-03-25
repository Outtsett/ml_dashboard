# SDK API Audit: QuestDBExportStudy.java

**Audited against**: `sdk-api-dump.txt` (javap -p -s decompilation of MotiveWave SDK)
**Date**: 2025-07-18

---

## 1. StudyHeader Annotation

```java
@StudyHeader(
    namespace = "com.mldashboard",
    id = "QUESTDB_EXPORT",
    name = "QuestDB CSV Export",
    label = "QuestDB Export",
    desc = "Exports OHLCV data to CSV for ML Dashboard ingestion",
    menu = "ML Dashboard",
    overlay = true,
    supportsBarUpdates = true,
    requiresBarUpdates = true
)
```

| Field | SDK Has It? | Status |
|---|---|---|
| `namespace` | ✅ `String namespace()` | ✅ PASS |
| `id` | ✅ `String id()` | ✅ PASS |
| `name` | ✅ `String name()` | ✅ PASS |
| `label` | ✅ `String label()` | ✅ PASS |
| `desc` | ✅ `String desc()` | ✅ PASS |
| `menu` | ✅ `String menu()` | ✅ PASS |
| `overlay` | ✅ `boolean overlay()` | ✅ PASS |
| `supportsBarUpdates` | ✅ `boolean supportsBarUpdates()` | ✅ PASS |
| `requiresBarUpdates` | ✅ `boolean requiresBarUpdates()` | ✅ PASS |

**Verdict: ✅ PASS** — All annotation fields exist in the SDK.

---

## 2. `initialize(Defaults)`

```java
@Override
public void initialize(Defaults defaults) { ... }
```

SDK signature:
```
public void initialize(com.motivewave.platform.sdk.common.Defaults);
```

**Verdict: ✅ PASS** — Exact match.

---

## 3. `createSD()`

```java
var sd = createSD();
```

SDK signature on Study:
```
public final SettingsDescriptor createSD();
```

**Verdict: ✅ PASS** — Returns `SettingsDescriptor`, called correctly.

---

## 4. `SettingsDescriptor.addTab(String)`

```java
var tab = sd.addTab("Settings");
```

SDK signature:
```
public SettingTab addTab(String);
```

**Verdict: ✅ PASS** — Returns `SettingTab`, correct.

---

## 5. `SettingTab.addGroup(String, SettingDescriptor...)`

```java
tab.addGroup("Export Configuration",
    new StringDescriptor(...),
    new BooleanDescriptor(...),
    new BooleanDescriptor(...),
    new IntegerDescriptor(...)
);
```

SDK signature:
```
public SettingGroup addGroup(String, SettingDescriptor...);
```

All descriptors extend `SettingDescriptor`, so varargs match.

**Verdict: ✅ PASS**

---

## 6. `StringDescriptor` Constructor

```java
new StringDescriptor(EXPORT_DIR, "Export Directory", getDefaultExportDir())
```

Source passes: `(String, String, String)`.

SDK signature:
```
public StringDescriptor(String, String, String);
    descriptor: (Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V
```

**Verdict: ✅ PASS** — Exact match.

---

## 7. `BooleanDescriptor` Constructor

```java
new BooleanDescriptor(APPEND_MODE, "Append Mode (vs Full Export)", true)
```

Source passes: `(String, String, boolean)`.

SDK signature:
```
public BooleanDescriptor(String, String, Boolean);
    descriptor: (Ljava/lang/String;Ljava/lang/String;Ljava/lang/Boolean;)V
```

The third parameter is `java.lang.Boolean` (boxed), not primitive `boolean`. However, Java autoboxing will convert `true` → `Boolean.TRUE` automatically.

**Verdict: ✅ PASS** — Autoboxing handles `boolean` → `Boolean` seamlessly.

---

## 8. `IntegerDescriptor` Constructor

```java
new IntegerDescriptor(FLUSH_INTERVAL, "Flush Every N Bars", 1, 1, 100, 1)
```

Source passes: `(String, String, int, int, int, int)`.

SDK signature:
```
public IntegerDescriptor(String, String, int, int, int, int);
    descriptor: (Ljava/lang/String;Ljava/lang/String;IIII)V
```

**Verdict: ✅ PASS** — Exact match.

---

## 9. `onBarClose(DataContext)`

```java
@Override
public void onBarClose(DataContext ctx) { ... }
```

SDK signature:
```
public void onBarClose(com.motivewave.platform.sdk.common.DataContext);
```

**Verdict: ✅ PASS** — Exact match.

---

## 10. DataSeries Methods

| Call in Source | SDK Signature | Return Type | Source Usage | Status |
|---|---|---|---|---|
| `series.size()` | `int size()` | `int` | Used as int | ✅ PASS |
| `series.getOpen(int)` | `float getOpen(int)` | `float` | Assigned to `float` | ✅ PASS |
| `series.getHigh(int)` | `float getHigh(int)` | `float` | Assigned to `float` | ✅ PASS |
| `series.getLow(int)` | `float getLow(int)` | `float` | Assigned to `float` | ✅ PASS |
| `series.getClose(int)` | `float getClose(int)` | `float` | Assigned to `float` | ✅ PASS |
| `series.getVolume(int)` | `long getVolume(int)` | `long` | Assigned to `long` | ✅ PASS |
| `series.getStartTime(int)` | `long getStartTime(int)` | `long` | Assigned to `long` | ✅ PASS |
| `series.getStartIndex()` | `int getStartIndex()` | `int` | Used in for loop | ✅ PASS |

**Verdict: ✅ PASS** — All return types match source variable types exactly.

---

## 11. `DataSeries.getBarSize()`

```java
BarSize barSize = series.getBarSize();
```

SDK signature:
```
public abstract BarSize getBarSize();
```

**Verdict: ✅ PASS** — Exists, returns `BarSize`.

---

## 12. `Instrument.getSymbol()`

```java
String symbol = sanitizeSymbol(instrument.getSymbol());
```

SDK signature:
```
public abstract String getSymbol();
```

**Verdict: ✅ PASS** — Exists, returns `String`.

---

## 13. BarSize — String Representation

Source uses:
```java
private String formatBarSize(BarSize barSize) {
    long millis = barSize.getSizeMillis();
    ...
}
```

SDK confirms `BarSize` has:
- `public long getSizeMillis()` ✅
- `public String getName()` — available but not used
- `public String getShortName()` — available but not used
- `public String toString()` — available but not used

The `formatBarSize()` method only calls `getSizeMillis()` on the BarSize object. This method exists in the SDK.

**Verdict: ✅ PASS** — `getSizeMillis()` exists and returns `long`.

⚠️ **WARNING**: BarSize already provides `getName()`, `getShortName()`, and `toString()` which likely produce human-readable strings (e.g., "1 Minute"). The custom `formatBarSize()` reimplements this logic. Consider using `barSize.getShortName()` or `barSize.getName()` instead for more accurate/consistent naming. However, the current code is **functionally correct** — it will compile and run.

---

## 14. `Settings.is(String, boolean)`

```java
boolean appendMode = getSettings().is(APPEND_MODE, true);
boolean includeHeader = getSettings().is(INCLUDE_HEADER, true);
```

SDK signature (on `SettingsBase`, inherited by `Settings`):
```
public boolean is(String, boolean);
    descriptor: (Ljava/lang/String;Z)Z
```

**Verdict: ✅ PASS** — Exact match. Returns `boolean`, second arg is default value.

---

## 15. `Settings.getInt(String, int)`

```java
int flushInterval = getSettings().getInt(FLUSH_INTERVAL, 1);
```

SDK signature (on `SettingsBase`, inherited by `Settings`):
```
public int getInt(String, int);
    descriptor: (Ljava/lang/String;I)I
```

**Verdict: ✅ PASS** — Exact match.

---

## 16. `Settings.getString(String)`

```java
String dir = getSettings().getString(EXPORT_DIR);
```

SDK signature (on `SettingsBase`, inherited by `Settings`):
```
public String getString(String);
    descriptor: (Ljava/lang/String;)Ljava/lang/String;
```

**Verdict: ✅ PASS** — Exact match.

---

## 17. Logging Methods: `info()`, `debug()`, `error()`

```java
info("QuestDB Export: writing to " + exportPath);
debug("QuestDB Export: " + barsWritten + " bars written to " + fileName);
error("QuestDB Export error: " + e.getMessage());
```

SDK signatures on Study:
```
public final void debug(String);
public final void info(String);
public final void error(String);
```

**Verdict: ✅ PASS** — All three exist with `(String) → void`.

---

## 18. `clearState()`

```java
@Override
public void clearState() {
    lastWrittenIndex = -1;
    barsWritten = 0;
}
```

SDK signature on Study:
```
public void clearState();
    descriptor: ()V
```

**Verdict: ✅ PASS** — Exists, correct override.

---

## 19. `getSettings()`

```java
getSettings().is(...)
getSettings().getInt(...)
getSettings().getString(...)
```

SDK signature on Study:
```
public final Settings getSettings();
    descriptor: ()Lcom/motivewave/platform/sdk/common/Settings;
```

**Verdict: ✅ PASS** — Returns `Settings`, which extends `SettingsBase` where `is()`, `getInt()`, `getString()` are defined.

---

## Additional Checks

### `formatBarSize(BarSize)` — Internal Logic

The method uses `barSize.getSizeMillis()` which returns `long`. All arithmetic is on `long` values. The comparison logic and string construction are pure Java — no SDK dependencies.

**Verdict: ✅ PASS** — but see ⚠️ WARNING in item 13 above.

### `sanitizeSymbol(String)` — String Manipulation

Pure Java regex operation. No SDK dependency.

**Verdict: ✅ PASS**

### File I/O (writeBarAppend, writeFullExport, writeBar, ensureExportPath)

All use `java.nio.file.*` and `java.io.*` standard library. No SDK dependencies.

**Verdict: ✅ PASS**

### `DataContext.getDataSeries()` and `DataContext.getInstrument()`

```java
DataSeries series = ctx.getDataSeries();
Instrument instrument = ctx.getInstrument();
```

SDK signatures on DataContext:
```
public abstract DataSeries getDataSeries();
public abstract Instrument getInstrument();
```

**Verdict: ✅ PASS**

---

## Summary

| # | Item | Status |
|---|---|---|
| 1 | StudyHeader annotation fields | ✅ PASS |
| 2 | `initialize(Defaults)` | ✅ PASS |
| 3 | `createSD()` | ✅ PASS |
| 4 | `SettingsDescriptor.addTab(String)` | ✅ PASS |
| 5 | `SettingTab.addGroup(String, SettingDescriptor...)` | ✅ PASS |
| 6 | `StringDescriptor(String, String, String)` | ✅ PASS |
| 7 | `BooleanDescriptor(String, String, boolean→Boolean)` | ✅ PASS |
| 8 | `IntegerDescriptor(String, String, int, int, int, int)` | ✅ PASS |
| 9 | `onBarClose(DataContext)` | ✅ PASS |
| 10 | DataSeries OHLCV + time methods | ✅ PASS |
| 11 | `DataSeries.getBarSize()` | ✅ PASS |
| 12 | `Instrument.getSymbol()` | ✅ PASS |
| 13 | BarSize string conversion via `getSizeMillis()` | ✅ PASS |
| 14 | `Settings.is(String, boolean)` | ✅ PASS |
| 15 | `Settings.getInt(String, int)` | ✅ PASS |
| 16 | `Settings.getString(String)` | ✅ PASS |
| 17 | `info()`, `debug()`, `error()` | ✅ PASS |
| 18 | `clearState()` | ✅ PASS |
| 19 | `getSettings()` | ✅ PASS |
| — | `DataContext.getDataSeries/getInstrument` | ✅ PASS |
| — | `formatBarSize()` internal logic | ✅ PASS |
| — | `sanitizeSymbol()` | ✅ PASS |
| — | File I/O patterns | ✅ PASS |

### ❌ FAIL Count: 0
### ⚠️ WARNING Count: 1

**⚠️ WARNING**: `formatBarSize()` reimplements BarSize→String conversion manually using `getSizeMillis()`. The SDK already provides `BarSize.getName()`, `BarSize.getShortName()`, and `BarSize.toString()`. Using one of these would be simpler and more consistent with MotiveWave's internal naming. The current code works correctly but may produce slightly different names than MotiveWave uses natively (e.g., "1 min" vs "1 Minute").

### Overall: ✅ ALL CLEAR — No compile errors or runtime errors expected.
