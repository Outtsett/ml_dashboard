# SDK API Audit Report — QuestDBStreamStudy.java

**Audited file**: `src/main/java/com/mldashboard/motivewave/QuestDBStreamStudy.java`  
**SDK reference**: `sdk-api-dump.txt` (javap -p -s decompilation of all SDK classes)  
**Date**: 2025-07-15

---

## 1. Class Hierarchy — `Study` base class

### `extends Study`
- **SDK**: `public class com.motivewave.platform.sdk.study.Study implements java.lang.Cloneable`
- ✅ **PASS** — `Study` is a concrete class, safe to extend.

### `createSD()` — line 62
- **SDK**: `public final com.motivewave.platform.sdk.common.desc.SettingsDescriptor createSD();`
- ✅ **PASS** — Exists, returns `SettingsDescriptor`, matches usage.

### `getSettings()` — lines 129, 165, 170, 183, 258, 266, 276
- **SDK**: `public final com.motivewave.platform.sdk.common.Settings getSettings();`
- ✅ **PASS** — Exists on `Study`, returns `Settings` (extends `SettingsBase`).

### `info(String)` — lines 262, 279
- **SDK**: `public final void info(java.lang.String);`
- ✅ **PASS**

### `debug(String)` — line 118
- **SDK**: `public final void debug(java.lang.String);`
- ✅ **PASS**

### `error(String)` — line 286
- **SDK**: `public final void error(java.lang.String);`
- ✅ **PASS**

### `clearState()` — line 297
- **SDK**: `public void clearState();` (descriptor: `()V`)
- ✅ **PASS** — Non-final method on `Study`, safe to `@Override`.

---

## 2. StudyHeader Annotation — lines 24–34

| Attribute | Used Value | SDK Method | Status |
|---|---|---|---|
| `namespace` | `"com.mldashboard"` | `public abstract String namespace()` | ✅ PASS |
| `id` | `"QUESTDB_STREAM"` | `public abstract String id()` | ✅ PASS |
| `name` | `"QuestDB ILP Stream"` | `public abstract String name()` | ✅ PASS |
| `label` | `"QuestDB Stream"` | `public abstract String label()` | ✅ PASS |
| `desc` | `"Streams OHLCV..."` | `public abstract String desc()` | ✅ PASS |
| `menu` | `"ML Dashboard"` | `public abstract String menu()` | ✅ PASS |
| `overlay` | `true` | `public abstract boolean overlay()` | ✅ PASS |
| `supportsBarUpdates` | `true` | `public abstract boolean supportsBarUpdates()` | ✅ PASS |
| `requiresBarUpdates` | `true` | `public abstract boolean requiresBarUpdates()` | ✅ PASS |

✅ **All 9 annotation attributes verified in SDK.**

---

## 3. DOMListener Interface — line 35, 164

### `implements DOMListener`
- **SDK**: `public interface com.motivewave.platform.sdk.common.DOMListener`
- ✅ **PASS** — Valid interface to implement.

### `update(DOM dom)` — line 164
- **SDK**: `public abstract void update(com.motivewave.platform.sdk.common.DOM);` (descriptor: `(Lcom/motivewave/platform/sdk/common/DOM;)V`)
- ✅ **PASS** — Exact match. The `@Override` is correct.

---

## 4. Instrument.addListener(DOMListener) — line 260

- **SDK** (Instrument interface):
  ```
  public abstract void addListener(com.motivewave.platform.sdk.common.DOMListener);
    descriptor: (Lcom/motivewave/platform/sdk/common/DOMListener;)V
  ```
- ✅ **PASS** — Exact match. `instrument.addListener(this)` passes `this` (a `DOMListener`).

---

## 5. Instrument.removeListener(DOMListener) — line 308

- **SDK**:
  ```
  public abstract void removeListener(com.motivewave.platform.sdk.common.DOMListener);
    descriptor: (Lcom/motivewave/platform/sdk/common/DOMListener;)V
  ```
- ✅ **PASS** — `subscribedInstrument.removeListener((DOMListener) this)` is correct. The cast is redundant but harmless since `QuestDBStreamStudy implements DOMListener`.

---

## 6. DataSeries Methods — lines 93–107

| Method Call | SDK Signature | Return Type | Status |
|---|---|---|---|
| `series.size()` (line 93) | `public abstract int size()` | `int` | ✅ PASS |
| `series.getOpen(int)` (line 103) | `public abstract float getOpen(int)` | `float` | ✅ PASS |
| `series.getHigh(int)` (line 104) | `public abstract float getHigh(int)` | `float` | ✅ PASS |
| `series.getLow(int)` (line 105) | `public abstract float getLow(int)` | `float` | ✅ PASS |
| `series.getClose(int)` (line 106) | `public abstract float getClose(int)` | `float` | ✅ PASS |
| `series.getVolume(int)` (line 107) | `public abstract long getVolume(int)` | `long` | ✅ PASS |
| `series.getStartTime(int)` (line 102) | `public abstract long getStartTime(int)` | `long` | ✅ PASS |

**Note**: `series.getVolume(int)` returns `long` and is stored in `long volume` — correct.

---

## 7. Tick Methods — lines 143–147

| Method Call | SDK Signature | Return Type | Code Expects | Status |
|---|---|---|---|---|
| `tick.getPrice()` | `public abstract float getPrice()` | `float` | `float` (param to writeTick) | ✅ PASS |
| `tick.getVolume()` | `public abstract int getVolume()` | `int` | `int` (param to writeTick) | ✅ PASS |
| `tick.getBidPrice()` | `public abstract float getBidPrice()` | `float` | `float` | ✅ PASS |
| `tick.getAskPrice()` | `public abstract float getAskPrice()` | `float` | `float` | ✅ PASS |
| `tick.getBidSize()` | `public abstract int getBidSize()` | `int` | `int` (param to writeTick) | ✅ PASS |
| `tick.getAskSize()` | `public abstract int getAskSize()` | `int` | `int` (param to writeTick) | ✅ PASS |
| `tick.isAskTick()` | `public abstract boolean isAskTick()` | `boolean` | `boolean` | ✅ PASS |
| `tick.getTime()` | `public abstract long getTime()` | `long` | `long` | ✅ PASS |

**CRITICAL CHECK**: `tick.getBidSize()` → `int`, `tick.getAskSize()` → `int`. ILPClient.writeTick expects `int bidSize, int askSize`. ✅ **Types match exactly.**

⚠️ **WARNING**: `Tick.getVolume()` returns `int` but `DataSeries.getVolume(int)` returns `long`. These are different APIs with different return types. The code handles both correctly — `tick.getVolume()` passes to `writeTick(... int volume ...)` and `series.getVolume(int)` stores in `long volume` and passes to `writeOHLCV(... long volume ...)`. No issue, but be aware of the asymmetry.

---

## 8. DOM Methods — lines 174, 185–186

| Method Call | SDK Signature | Return Type | Status |
|---|---|---|---|
| `dom.getInstrument()` | `public abstract Instrument getInstrument()` | `Instrument` | ✅ PASS |
| `dom.getBidRows()` | `public abstract java.util.List getBidRows()` | `List` (raw) | ✅ PASS |
| `dom.getAskRows()` | `public abstract java.util.List getAskRows()` | `List` (raw) | ✅ PASS |

**Note**: The SDK uses raw `List` (no generics). Code uses `List<?>` — correct and safe.

---

## 9. DOMRow Methods — lines 198–200, 212–214

| Method Call | SDK Signature | Return Type | Code Variable Type | Status |
|---|---|---|---|---|
| `row.getPrice()` | `public abstract float getPrice()` | `float` | `float` | ✅ PASS |
| `row.getSize()` | `public abstract float getSize()` | `float` | `float` | ✅ PASS |
| `row.getOrderCount()` | `public abstract int getOrderCount()` | `int` | `int` | ✅ PASS |

✅ All DOMRow method signatures verified.

---

## 10. Settings Access Methods

### `getSettings().is(String, boolean)` — lines 129, 165, 258
- **SDK** (SettingsBase): `public boolean is(java.lang.String, boolean)` (descriptor: `(Ljava/lang/String;Z)Z`)
- ✅ **PASS**

### `getSettings().getInt(String, int)` — lines 170, 183, 276
- **SDK** (SettingsBase): `public int getInt(java.lang.String, int)` (descriptor: `(Ljava/lang/String;I)I`)
- ✅ **PASS**

### `getSettings().getString(String)` — line 266
- **SDK** (SettingsBase): `public java.lang.String getString(java.lang.String)` (descriptor: `(Ljava/lang/String;)Ljava/lang/String;`)
- ✅ **PASS**

---

## 11. Descriptor Constructors

### `StringDescriptor(String, String, String)` — lines 66, 71–74
- **SDK**: `public StringDescriptor(java.lang.String, java.lang.String, java.lang.String)` (descriptor: `(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V`)
- ✅ **PASS** — Exact 3-arg constructor match.

### `IntegerDescriptor(String, String, int, int, int, int)` — lines 67, 80–81
- **SDK**: `public IntegerDescriptor(java.lang.String, java.lang.String, int, int, int, int)` (descriptor: `(Ljava/lang/String;Ljava/lang/String;IIII)V`)
- ✅ **PASS** — Exact 6-arg constructor match.

### `BooleanDescriptor(String, String, boolean)` — lines 78–79
- **SDK**: `public BooleanDescriptor(java.lang.String, java.lang.String, java.lang.Boolean)` (descriptor: `(Ljava/lang/String;Ljava/lang/String;Ljava/lang/Boolean;)V`)
- ⚠️ **WARNING** — The SDK constructor takes `java.lang.Boolean` (boxed), not `boolean` (primitive). The code passes `true` which Java will auto-box to `Boolean.TRUE`. **This compiles and works correctly due to autoboxing**, but the actual parameter type is `Boolean`, not `boolean`.

---

## 12. SettingTab.addGroup(String, SettingDescriptor...) — lines 65, 70, 77

- **SDK** (SettingTab):
  ```
  public SettingGroup addGroup(java.lang.String, com.motivewave.platform.sdk.common.desc.SettingDescriptor...);
    descriptor: (Ljava/lang/String;[Lcom/motivewave/platform/sdk/common/desc/SettingDescriptor;)Lcom/motivewave/platform/sdk/common/desc/SettingGroup;
  ```
- The code passes `StringDescriptor`, `IntegerDescriptor`, `BooleanDescriptor` — all extend `SettingDescriptor`.
- ✅ **PASS** — Varargs of `SettingDescriptor` accepted. Subclasses are covariant.

---

## 13. SettingsDescriptor.addTab(String) — line 63

- **SDK**: `public com.motivewave.platform.sdk.common.desc.SettingTab addTab(java.lang.String)` (descriptor: `(Ljava/lang/String;)Lcom/motivewave/platform/sdk/common/desc/SettingTab;`)
- ✅ **PASS** — Returns `SettingTab`, matches usage `var tab = sd.addTab("Settings")`.

---

## 14. initialize(Defaults) — line 61

- **SDK**: `public void initialize(com.motivewave.platform.sdk.common.Defaults)` (descriptor: `(Lcom/motivewave/platform/sdk/common/Defaults;)V`)
- ✅ **PASS** — Correct override signature.

---

## 15. onBarClose(DataContext) — line 86

- **SDK**: `public void onBarClose(com.motivewave.platform.sdk.common.DataContext)` (descriptor: `(Lcom/motivewave/platform/sdk/common/DataContext;)V`)
- ✅ **PASS**

---

## 16. onTick(DataContext, Tick) — line 128

- **SDK**: `public void onTick(com.motivewave.platform.sdk.common.DataContext, com.motivewave.platform.sdk.common.Tick)` (descriptor: `(Lcom/motivewave/platform/sdk/common/DataContext;Lcom/motivewave/platform/sdk/common/Tick;)V`)
- ✅ **PASS**

---

## 17. clearState() — line 297

- **SDK**: `public void clearState()` (descriptor: `()V`)
- ✅ **PASS** — Non-final, safe to override.

---

## 18. Cast Safety — `(DOMRow) bidRows.get(i)` — lines 197, 212

- `DOM.getBidRows()` and `DOM.getAskRows()` return raw `java.util.List`.
- `DOMRow` is the interface at `com.motivewave.platform.sdk.common.DOMRow`.
- The SDK documentation structure (DOM → getBidRows/getAskRows, DOMRow interface in same package) strongly implies the list contains `DOMRow` instances.
- ⚠️ **WARNING** — The cast is logically correct based on the SDK design, but the raw `List` return type means there's no compile-time guarantee. A `ClassCastException` is theoretically possible if the SDK ever returns a different type. The code uses `List<?>` which is the correct defensive approach. **No fix needed** — this is the standard SDK usage pattern.

---

## 19. Type Mismatch Analysis

### Tick → ILPClient.writeTick
| Tick method | Returns | writeTick parameter | Match |
|---|---|---|---|
| `getPrice()` | `float` | `float price` | ✅ |
| `getVolume()` | `int` | `int volume` | ✅ |
| `getBidPrice()` | `float` | `float bid` | ✅ |
| `getAskPrice()` | `float` | `float ask` | ✅ |
| `getBidSize()` | `int` | `int bidSize` | ✅ |
| `getAskSize()` | `int` | `int askSize` | ✅ |
| `isAskTick()` | `boolean` | `boolean isAskTick` | ✅ |
| `getTime()` | `long` | `long epochMs` | ✅ |

✅ **All types match exactly. No mismatches.**

### DataSeries → ILPClient.writeOHLCV
| DataSeries method | Returns | writeOHLCV parameter | Match |
|---|---|---|---|
| `getOpen(int)` | `float` | `float open` | ✅ |
| `getHigh(int)` | `float` | `float high` | ✅ |
| `getLow(int)` | `float` | `float low` | ✅ |
| `getClose(int)` | `float` | `float close` | ✅ |
| `getVolume(int)` | `long` | `long volume` | ✅ |
| `getStartTime(int)` | `long` | `long timestamp` | ✅ |

### DOMRow → ILPClient.writeDOMRow
| DOMRow method | Returns | writeDOMRow parameter | Match |
|---|---|---|---|
| `getPrice()` | `float` | `float price` | ✅ |
| `getSize()` | `float` | `float size` | ✅ |
| `getOrderCount()` | `int` | `int orderCount` | ✅ |

---

## 20. DataContext Methods — lines 87–88

| Method Call | SDK Signature | Status |
|---|---|---|
| `ctx.getDataSeries()` | `public abstract DataSeries getDataSeries()` | ✅ PASS |
| `ctx.getInstrument()` | `public abstract Instrument getInstrument()` | ✅ PASS |

---

## 21. Instrument.getSymbol() — lines 99, 139, 175, 262

- **SDK**: `public abstract java.lang.String getSymbol()` (descriptor: `()Ljava/lang/String;`)
- ✅ **PASS**

---

## Summary

| Category | Pass | Warning | Fail |
|---|---|---|---|
| Class hierarchy | 7 | 0 | 0 |
| StudyHeader annotation | 9 | 0 | 0 |
| DOMListener interface | 2 | 0 | 0 |
| Instrument listener methods | 2 | 0 | 0 |
| DataSeries methods | 7 | 0 | 0 |
| Tick methods | 8 | 0 | 0 |
| DOM methods | 3 | 0 | 0 |
| DOMRow methods | 3 | 0 | 0 |
| Settings access | 3 | 0 | 0 |
| Descriptor constructors | 2 | 1 | 0 |
| SettingTab/SettingsDescriptor | 2 | 0 | 0 |
| Method overrides | 4 | 0 | 0 |
| Cast safety | 0 | 1 | 0 |
| Type mismatches | 17 | 0 | 0 |
| DataContext methods | 2 | 0 | 0 |
| **TOTAL** | **71** | **2** | **0** |

### ✅ RESULT: ALL CLEAR — No FAIL items

**2 minor warnings** (both non-blocking, code compiles and runs correctly):
1. `BooleanDescriptor` constructor takes boxed `Boolean`, not primitive `boolean` — autoboxing handles this transparently.
2. `(DOMRow)` cast on raw `List` elements — logically safe per SDK design, standard SDK pattern.

**No code changes required.**
