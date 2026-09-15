# Institutional UI Specification: Mission Control HUD

## 1. Design Philosophy: "The Biological Machine"
The UI is designed as an adaptive research surface that reflects the underlying hardware and model architecture. It prioritizes high-fidelity signal density over retail "glitz."

### **Visual Standards**
- **Palette**: Muted Institutional.
  - **Success**: `#10b981` (Emerald-500)
  - **Primary**: `#3b82f6` (Blue-500)
  - **Warning**: `#f59e0b` (Amber-500)
  - **Danger**: `#ef4444` (Red-500)
  - **Background**: Deep Zinc/Slate with `0.01` alpha overlays for "glass" effects.
- **Typography**: Mono-weighted for metrics, Black-weighted for headings.
- **Glow Effects**: Subdued text-shadows (`rgba(255,255,255,0.15)`) to provide a backlit HUD feel without neon glare.

---

## 2. Informational Architecture (IA)

### **The Semantic Registry (v2.0.0)**
The UI is **100% Data-Driven**. It does not have hardcoded screens for specific models.
- **Registry Source**: `src/config/models.json` & `metric-descriptions.json`.
- **Adaptive Rendering**: Component logic (e.g., `MetricScorecard.tsx`) iterates over the model's `outputs` and `definitions` to generate the interface at runtime.
- **Prescriptive Path**: Every metric is mapped to a hyperparameter control flag (e.g., `Attention Focus` -> `--n-heads`).

### **Manifest-Awareness**
The UI consumes the **Manifest Service** (`/api/system/manifest`) to adjust its capabilities based on:
- **Logical Threads**: Visualizing the 24-thread saturation.
- **VRAM/RAM**: Throttling visual effects if resources are constrained.
- **Lake Health**: Instantly switching to "Fallback Mode" if the serving layer cannot reach the lake.

---

## 3. Core Component Library

### **Radial High-Fidelity Gauges**
- **Structure**: Half-ring arc sitting majestically **above** the numeric value.
- **Behaviors**: Animated transitions, target-line markers, and status-aware coloring (Fail/Pass).
- **Location**: Top of all diagnostic surfaces.

### **Institutional Grid**
- **Design**: Borderless, 8:4 asymmetric layout.
- **Density**: High-information density with micro-labels and monospace data strings.

### **The "Pulse" HUD**
- **Latency**: Sub-10ms propagation.
- **Technology**: SSE (Server-Sent Events) + Direct REST Pulse.
- **Visual**: "Alive" indicators that pulse Emerald when ingested data is promoted into the lake.

---

## 4. Primary Research Surfaces

### **A. Training Surface (Flagship)**
- **Model Selector**: Unified control for CNN+Transformer, HDP-HMM, and Variants.
- **Convergence Tab**: Real-time Brier Score tracking and Directional Edge mapping.
- **Performance Tab**: Adaptive view switching (Regime Profiles for HMM vs. Calibration Curves for Transformer).
- **SHAP Tab**: Global Influence Matrix and Temporal Importance Evolution.

### **B. Market Intelligence (Charts)**
- **Terminology**: Full purge of "Swing" artifacts.
- **Layers**:
  - **Structural Pivots**: High-accuracy local highs/lows.
  - **Microstructure**: Every high-speed pivot in the price action.
  - **Institutional Zones**: Support and Resistance clusters.
- **Fast-Path**: All charts load data via the `nm=true` HTTP Fast-Path for 1.5x speed.

### **C. System Observatory**
- **Hardware Page**: Real-time 24-thread load distribution visualizer.
- **Infrastructure Page**: lake table lineage, storage auditing, and cache hit-rates.

---

## 5. Development Standards
- **Component Rules**: Every component must use `memo()` for performance.
- **Hook Rules**: All data fetching must use the `apiService` abstraction + TanStack Query.
- **Validation**: Any change to `models.json` must be validated against the **Zod Registry Schema**.
