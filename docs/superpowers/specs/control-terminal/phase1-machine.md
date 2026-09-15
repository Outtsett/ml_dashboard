# Control Terminal — Phase 1: Machine & Processes Domain (Reference Implementation)

> **Data-layer premise superseded (2026-09-10).** This spec was written against a local
> QuestDB serving cache reached over HTTP `:9000` / ILP `:9009` / PG wire `:8812`. That store
> was emptied and retired: all 41 objects were dropped after each was copied to parquet in the
> lake and row-count verified (39/39 exact), and nothing may read or write it again. Market
> data now lives in the Iceberg lake at `E:\lake` and is read **in-process by DuckDB**
> (`from lake.serving import connect`). Everything below that names a database host, port,
> Windows service, JVM process, WAL table, `SAMPLE BY`, materialized-view refresh or ILP
> write is stale and must be re-derived against the lake before it is built.

> **Status:** DESIGN spec (A5 deep-dive). No source modified. All process/port/service
> numbers below are from **real read-only diagnostics** sampled 2026-07-21/22 on this machine
> (`Get-CimInstance Win32_Process`, `netstat -ano`, `sc query`, `Get-Service`). No synthetic data.
>
> **Scope:** Machine & Processes is **Phase 1** — built end-to-end first to prove the fused
> **Capability** contract (one typed function → cockpit tile + agent tool + telemetry event)
> under the **human-in-loop-for-all-writes** rule. It directly solves the user's two stated
> pains: *controlling background services* and *cleaning temp files*.

---

## 0. The fused Capability contract (what Phase 1 must prove)

Every machine action is authored **once** as a typed capability and surfaces in three places
with zero duplication:

```
                       ┌───────────────────────────────┐
   define ONE:         │  Capability<Args, Result>      │
                       │   id, args (Zod), risk,        │
                       │   stream?, run(), audit()      │
                       └───────────────────────────────┘
                          │            │            │
             ┌────────────┘            │            └─────────────┐
             ▼                         ▼                          ▼
      Cockpit tile              Agent tool (MCP)           Telemetry event
   (button → propose →      (propose-only for writes;    (machine.* SSE channel
    human confirm → run)     read caps run directly)      → ledger + tiles live)
```

**Risk ladder (governs the write gate):**

| risk | meaning | execution path |
|---|---|---|
| `read` | no state change (list, classify, snapshot, scan) | runs immediately, no gate — agent *and* tile |
| `write` | reversible-ish state change (kill one proc, clean a safelisted temp dir, restart a service) | **human confirm required**; agent may only `propose` |
| `dangerous` | wide-blast or hard-to-undo (kill-tree, stop QuestDB, clean a path near `data/`) | human confirm **with typed target echo**; agent proposes, never auto-approves |
| `forbidden` | never allowed via this surface (delete under `data/models`, **anything under `E:\lake`**, git-tracked files) | capability refuses at validation; not exposed as an executable action |

**Non-negotiable invariants for Phase 1:**
1. Every `write`/`dangerous` capability produces an **audit row** (who/what/target/before-state/result) before and after execution.
2. An **agent can propose but never execute** a write. The confirm click is the only path that flips a proposal to a run.
3. The **QuestDB Java process / `QuestDB` nssm service is never in any kill set** — enforced by an allowlist check *and* a denylist check (belt-and-suspenders), not by heuristic alone.

> **Takeaway:** Phase 1 is the template. If the propose→confirm→run→audit loop and the
> QuestDB-protection guardrails hold for *processes* (the highest-blast-radius domain), every
> later Control-Terminal domain inherits a proven contract. Get the kill heuristic wrong here
> and you take down the editor or the live Claude session — so this domain is deliberately first.

---

## 1. Real process landscape (measured)

Sampled totals: **~260 live node/python/java processes** — 152 `node.exe`, 107 `python.exe`,
1 `java.exe`. Combined working set: **node ≈ 18.1 GB, python ≈ 6.7 GB, java ≈ 1.55 GB.**
This confirms the "heavy orphan accumulation across dev sessions" premise.

### 1.1 Ownership breakdown (measured, by command-line + parent chain)

| Owner class | count | ~WS | verdict | signature |
|---|---:|---:|---|---|
| **Claude/VS Code MCP servers** (`npx … mcp`, `@modelcontextprotocol/*`, `.venv` under `Claude Extensions`, `_npx` cache) | **~210** | ~20 GB | **PROTECTED** (mostly) — but the true bloat source | cmdline contains `mcp`, `modelcontextprotocol`, `npx-cli.js … mcp`, or path under `Claude Extensions` / `npm-cache\_npx` |
| **ml_dashboard live server** (PID **39108**, owns `:5000`) + its tsx wrapper chain (10764→56916) + hardware_node child (17060) | 4 | ~1.46 GB | **PROTECTED** | cmdline has `ml_dashboard` + `src/server/main.ts`; PID owns `:5000`; `hardware_node.py` |
| **ml_dashboard ORPHAN backend stacks** (chains ending PID **38260**, **25740**) — full cross-env→tsx→node trios that booted but do **not** own `:5000` | ~7 | ~530 MB | **TRUE ORPHAN** | `ml_dashboard` + `tsx --watch … main.ts`, but PID does **not** own `:5000` and no `hardware_node.py` child |
| **Stale vite** (PID **56096**, `vite dev --port 5000`) — could not bind (5000 held by 39108), idling | 1 | 96 MB | **TRUE ORPHAN** | `ml_dashboard` + `vite … dev --port 5000`, not the port owner |
| **Redundant `npm run dev` launchers** (PIDs 7856, 51968, 70200, +1) | 4 | ~248 MB | **TRUE ORPHAN** (3 of 4) | `npm-cli.js run dev`; only one legitimately parents the live stack |
| **Editor/tooling services** (Shopify `theme language-server` PID 23560; `csdevkit` launcher) | 2 | ~154 MB | **PROTECTED** | `@shopify/cli … language-server`, `.vscode\extensions` |
| **QuestDB** (PID **5996**, java, nssm service) | 1 | 1.55 GB | **PROTECTED — HARD LOCK** | `java.exe`, nssm service `QuestDB`, owns `:9000`+`:9009` |
| **Uncategorized python (uv-cached tool runners, ipykernel)** | ~25 | ~1.7 GB | **case-by-case** | `uv\cache`, `.venv`, ipykernel — likely MCP/tool workers; treat as protected unless dead-parent + old |

### 1.2 The measured live-server chain (must survive every reap)

```
47260 cross-env (already exited — normal for tsx watch)
  └─ 56916 tsx/dist/cli.mjs --watch --env-file=.env src/server/main.ts
       └─ 10764 node --require tsx/preflight  (watch supervisor)
            └─ 39108 node … main.ts   ← OWNS :5000  (1251 MB, THE server)
                 └─ 17060 anaconda3\python.exe scripts/hardware_node.py  (86 MB)
```

QuestDB (verified live):

```
sc query questdb      → STATE 4 RUNNING (STOPPABLE, ACCEPTS_SHUTDOWN)
Get-Service QuestDB   → Status Running
netstat :9000 → PID 5996 (java)   netstat :9009 (ILP) → PID 5996
```

> **Takeaway:** The reaper's whole job is separating **two** ml_dashboard server stacks that
> look byte-identical on the command line — the live one (39108, owns `:5000`, has the
> hardware_node child) from the 2+ zombie stacks (38260, 25740) left by prior `npm run dev`
> sessions that lost the port race. **Port ownership + presence of the `hardware_node.py`
> child is the only reliable discriminator** — command-line string alone cannot tell them apart.

---

## 2. Orphan taxonomy & classification heuristics (`proc.classify`)

Classification is **multi-signal and conservative**: a process is a reap candidate only when it
clears *every* protection gate. Default verdict is **PROTECTED** (fail-safe — unknown = keep).

### 2.1 The five verdict classes

| class | reap? | definition |
|---|---|---|
| `PROTECTED_INFRA` | never | QuestDB (nssm/java/:9000), the live dashboard chain, its `hardware_node.py` child, PID of the Control Terminal server itself, PID 0/4/system, `services.exe`, `wininit`, etc. |
| `PROTECTED_SESSION` | never (auto); manual-only with strong confirm | active MCP servers, VS Code extension host + language servers, Claude Code / Claude Desktop hosts and their spawned tool workers |
| `ORPHAN_STRANDED` | yes (write, human-gated) | ml_dashboard dev process whose **role is already filled by a live sibling** — a tsx `main.ts` stack not owning `:5000`, a `vite --port 5000` not owning `:5000`, a duplicate `npm run dev` |
| `ORPHAN_DETACHED` | yes (write, human-gated) | detached python training/HPO worker with a **dead parent**, no owned port, no stdin pipe, age > threshold |
| `UNKNOWN` | no | anything unmatched — surfaced greyed-out, never auto-selected |

### 2.2 Concrete heuristics (the substrings, chains, ports that separate them)

**A. Hard protect (allowlist — evaluated FIRST, short-circuits):**
- `svc.owner('QuestDB')` PID, or any PID whose cmdline is empty + service-session (`Session#0`) + `java.exe` → **PROTECTED_INFRA**.
- PID owning `:5000` and its ancestor chain up to the `npm run dev` root → **PROTECTED_INFRA** (this *is* the running dashboard).
- `basename(cmdline) === 'hardware_node.py'` AND parent owns `:5000` → **PROTECTED_INFRA**.
- `process.pid` of the Control-Terminal backend and its own children → **PROTECTED_INFRA**.

**B. Session protect (denylist for auto-reap):**
- cmdline contains any of: `Claude Extensions`, `Claude_pzs8sxrjxfjjc`, `\Roaming\Claude\`, `modelcontextprotocol`, `-y … mcp`, `npx-cli.js … mcp`, `\_npx\`, `\.vscode\extensions`, `vscode-server`, `csdevkit`, `language-server`, `tsserver` → **PROTECTED_SESSION** (never in an auto-reap batch; manual selection requires a second typed confirm because these back live AI/editor tool calls).

**C. Orphan positive-identification (ALL must hold):**
- `ORPHAN_STRANDED` (ml_dashboard dev duplicate):
  - `cmdline` contains repo root `E:\source\repos\ml_dashboard`, **AND**
  - matches a dev-role pattern: `tsx --watch … src/server/main.ts` **or** `vite … dev --port 5000` **or** `npm-cli.js run dev`, **AND**
  - the PID does **NOT** own `:5000` (via `port.owner(5000)`), **AND**
  - the PID has **no** `hardware_node.py` child, **AND**
  - a *different* live PID already fills that role (there is a `:5000` owner) → safe to reap.
- `ORPHAN_DETACHED` (stray python worker):
  - `name === python.exe` and cmdline references a repo `scripts/train_*.py` / `*_hpo.py` / `optuna`, **AND**
  - `parentPid` not present in the live process set (reparented/dead), **AND**
  - owns no listening port, **AND**
  - `elapsed > 10 min` (age guard — avoids catching a just-launched run mid-handshake), **AND**
  - not streaming to the dashboard ledger (no recent `emit_metric` for its `study_name`) → safe to reap.

**D. Age & working-directory tiebreakers:**
- `started` timestamp (from `systeminformation` `processes().list[].started`) gates every reap: nothing younger than **10 minutes** is auto-selected, so a booting service is never swept.
- Working dir / cmdline repo-root match scopes reaps to **ml_dashboard-owned** dev processes only — the reaper never proposes killing a process from another repo (forexmodel, adorn, quant) by default.

### 2.3 Why parent-PID alone is insufficient (the trap)

On Windows, a parent that exits **reparents** its children unpredictably (no strict init-reparent
like Linux). The live server's own launcher (cross-env 47260) is *already dead* in the sample, yet
39108 is the live server. So "dead parent ⇒ orphan" would **false-positive on the live dashboard**.
Parent liveness is therefore only a *contributing* signal for `ORPHAN_DETACHED`, always ANDed with
**port non-ownership** and **role-already-filled**, never used alone.

> **Takeaway:** The classifier is deliberately asymmetric — cheap to mark PROTECTED, expensive
> to mark ORPHAN. Reaping requires clearing every gate; protecting requires clearing just one.
> That asymmetry is what makes an incorrect keep (a leaked 60 MB zombie survives one more cycle)
> the only failure mode, never an incorrect kill (editor/Claude/QuestDB dies).

---

## 3. `systeminformation` assessment

Installed & pinned: **`systeminformation` 5.31.5** (`package.json`: `"^5.31.5"`; `node_modules` resolves 5.31.5).
**Pin exact: `5.31.5`** for reproducibility. Node 22.20.0. Already imported in
`src/server/system/telemetry.router.ts` (`import si from 'systeminformation'`).

### 3.1 What `si` covers → which capability

| `si` call | fields used | backs capability |
|---|---|---|
| `si.processes()` | `.list[]`: `pid, parentPid, name, command, params, cpu, mem, priority, started, state` | `proc.list`, `proc.classify` |
| `si.services('*')` or `si.services(name)` | `name, running, startmode, pids, cpu, mem` | `svc.list` (enumeration) |
| `si.graphics()` | `controllers[]: vendor, model, vram, driverVersion, memoryUsed, utilizationGpu, temperatureGpu` | `gpu.snapshot` **fallback only** (iGPU risk — see §3.3) |
| `si.currentLoad()` | `currentLoad, avgLoad, cpus[].load` | `cpu.snapshot` (augments hardware_node) |
| `si.mem()` | `total, used, active, available, swaptotal, swapused` | `mem.snapshot` |
| `si.fsSize()` | per-mount `fs, size, used, available, use%, mount` | `disk.snapshot` |
| `si.networkStats()` | `tx_sec, rx_sec` | already synthesized in telemetry.router from hardware_node deltas |

### 3.2 What `si` **cannot** do → needs PowerShell / `nssm` / `sc` / native

| need | why `si` fails | tool |
|---|---|---|
| **Windows service control** (start/stop/restart) | `si.services()` is read-only | `sc.exe stop/start <name>` or `nssm restart <name>` (QuestDB was installed via nssm) |
| **Kill a process** | no kill API | `process.kill(pid)` (Node) → escalate to `taskkill /PID <pid> /F` |
| **Kill a process TREE** | no tree API; orphaned children survive a bare kill | `taskkill /PID <pid> /T /F` (`/T` = whole tree) |
| **Authoritative port→PID owner** | `si.networkConnections()` is slow/flaky on Win for LISTENING sockets | `netstat -ano -p TCP` parse, or `Get-NetTCPConnection -LocalPort <p>` |
| **nssm service metadata** (is QuestDB nssm-managed?) | not exposed | `nssm dump QuestDB` / `sc qc QuestDB` |
| **Live NVIDIA GPU** | `si.graphics()` may return the iGPU / stale VRAM | **reuse existing `hardware_node.py` pynvml feed** (see §4) |

### 3.3 GPU: reuse, don't re-query

`telemetry.router.ts` already runs `scripts/hardware_node.py` (pynvml) emitting the canonical
`system.gpu` SSE payload (`utilizationGpu`, `memoryUsedMB/FreeMB/TotalMB`, `temperatureC`,
`powerDrawW/LimitW`, `fanSpeedPct`, `clock*MHz`). **`gpu.snapshot` must read the last hardware_node
snapshot (`lastSnapshot.gpu`), not call `si.graphics()`** — the file's own comments (lines 170-184)
warn `si.graphics()` picks up the iGPU. `si.graphics()` is the degraded fallback only.

> **Takeaway:** `si` covers all four *read* telemetry capabilities (cpu/mem/disk + process/service
> enumeration) with one pinned dependency already in the tree. Every *write* (kill, service control)
> and the authoritative port-owner + GPU feed fall to `taskkill`/`sc`/`nssm`/`netstat`/existing
> pynvml — so Phase 1 adds shell adapters, not new heavy deps.

---

## 4. Capability specs — Phase 1

All ids namespaced `machine.*`. Stream = a `machine.*` SSE channel the tiles subscribe to.
Args are Zod-validated. `wraps` names the underlying mechanism.

### Read capabilities (risk = `read`, agent runs directly)

| id | args | result | stream | wraps |
|---|---|---|---|---|
| `proc.list` | `{ filter?: 'mldash'\|'all'\|'python'\|'node', sort?: 'mem'\|'cpu' }` | `Process[] { pid, ppid, name, command, cpu, memMB, started, portOwned?, verdict }` | `machine.procs` (5 s) | `si.processes()` + `netstat` port map |
| `proc.classify` | `{ pid?: number }` (omit = all) | `Classified[] { pid, class: 'PROTECTED_INFRA'\|'PROTECTED_SESSION'\|'ORPHAN_STRANDED'\|'ORPHAN_DETACHED'\|'UNKNOWN', reasons: string[], reapable: boolean }` | — | pure fn over `proc.list` + `port.owner` + service registry (§2) |
| `svc.list` | `{}` | `Service[] { name, display, running, startmode, pids[], memMB, managedBy: 'nssm'\|'sc'\|'none' }` | `machine.svcs` (10 s) | `si.services('*')` + `sc query` + `nssm dump` probe |
| `port.owner` | `{ port: number }` | `{ port, pid?, name?, command? }` | — | `netstat -ano` / `Get-NetTCPConnection` |
| `gpu.snapshot` | `{}` | canonical `GpuSnapshot` (pynvml fields) | reuse `system.gpu` | **reuse** `lastSnapshot.gpu` (telemetry.router); `si.graphics()` fallback |
| `cpu.snapshot` | `{}` | `{ load, cores[], speedGHz, tempC }` | reuse `system.matrix` | **reuse** hardware_node `cpu`; `si.currentLoad()` augment |
| `mem.snapshot` | `{}` | `{ totalGB, usedGB, activeGB, availGB, swapUsedGB }` | reuse `system.matrix` | **reuse** hardware_node `mem`; `si.mem()` augment |
| `disk.snapshot` | `{}` | `Disk[] { mount, sizeGB, usedGB, usePct }` | `machine.disk` (30 s) | `si.fsSize()` (**new** — not in telemetry.router today) |
| `temp.scan` | `{ roots?: string[] }` | `TempReport[] { path, sizeMB, fileCount, class: 'safelist'\|'review'\|'excluded', reason }` | — | `fs` walk over safelist (§5) |

### Write capabilities (human-gated; agent may only `propose`)

| id | args | result | risk | wraps |
|---|---|---|---|---|
| `proc.kill` | `{ pid: number }` | `{ pid, killed: boolean, reclaimedMB, before: Process }` | `write` | `process.kill(pid)` → `taskkill /PID <pid> /F` |
| `proc.kill-tree` | `{ pid: number }` | `{ pid, killedPids[], reclaimedMB }` | `dangerous` | `taskkill /PID <pid> /T /F` |
| `svc.restart` | `{ name: string }` | `{ name, cycle: 'stop→verify→start→health', healthy: boolean }` | `write` | `nssm restart` / `sc stop`+`sc start` + health probe |
| `svc.stop` | `{ name: string }` | `{ name, stopped: boolean }` | `dangerous` | `sc stop` / `nssm stop` |
| `temp.clean` | `{ paths: string[] }` (must all be safelist-resolved) | `{ removed[], skipped[], reclaimedMB }` | `write` (`dangerous` if any path resolves near `data/`) | validated `fs.rm` |

**Guards applied inside every write capability (not just the UI):**
- `proc.kill` / `proc.kill-tree` **re-run `proc.classify` at execution time** and hard-refuse if the
  target is `PROTECTED_INFRA` or is (or has as a descendant) the `:5000` owner or the QuestDB PID.
  A stale UI selection cannot leak a protected PID through.
- `svc.stop`/`svc.restart` on `QuestDB` → **forbidden for `stop`**, `restart` allowed only with typed
  name echo + explicit "I understand this is the SHARED QuestDB" acknowledgement (it feeds every other repo).
- `temp.clean` re-validates every path against the safelist resolver (§5) server-side; a path that
  normalizes under an excluded root is dropped from the batch and reported in `skipped[]`.

> **Takeaway:** The write gate lives in the capability, not the button. Even a compromised or
> buggy client (or an over-eager agent proposal that somehow got confirmed) cannot kill QuestDB,
> the live server, or delete under `data/` — the capability itself refuses.

---

## 5. Temp / artifact janitor (`temp.scan` / `temp.clean`)

`temp.scan` inventories a fixed **safelist of roots**; `temp.clean` may remove only paths the scan
classified `safelist`. Everything else is `review` (surfaced, never auto-selected) or `excluded`
(hard-blocked).

### 5.1 Safelist (removable — `write`) — sizes measured

| root | measured | what | rule |
|---|---:|---|---|
| repo `logs/` | 6 KB / 2 files | app log rotation | keep newest N, remove rotated |
| repo `node_modules/.vite` | **74 MB / 905 files** | Vite transform cache | fully removable (regenerated on next `vite dev`) |
| repo `.vite` (root) | absent now | Vite cache | removable when present |
| repo `dist/` | 82 MB / 1600 files | build output | removable (`review` default — only if not mid-deploy) |
| repo `.playwright-mcp/*.log`, `.remember/logs/**` | many small | tool run logs | removable, age > 7 d |
| `optuna_studies/*.lock` / `*-journal` | absent now | stale SQLite study locks | remove **lock/journal only**, never the `*.db` study itself |
| `E:\tmp` | 19 MB | scratch | removable, age-gated |
| `C:\…\Temp\claude\**\scratchpad` | 7.7 MB | Claude scratch | removable, age-gated (not the *active* session dir) |

### 5.2 Excluded (never touched — `forbidden`)

`data/models` (**98 MB / 28 files — model checkpoints, irreplaceable**), any `data/**` (QuestDB
sits outside repo but `data/` is model/parquet territory), `node_modules/` (except `.vite`),
the **QuestDB data directory**, `.git/` and anything **git-tracked** (`git ls-files` membership =
instant exclude), any `optuna_studies/*.db` (the study results themselves), `.env` / secrets.

### 5.3 Path-safety algorithm (server-side, in `temp.clean`)

```
1. resolve → path.resolve(canonical, realpath — no symlink escape)
2. must be under exactly one SAFELIST root (prefix match on normalized path)
3. must NOT be under any EXCLUDE root (data/**, node_modules except .vite, .git, QuestDB dir)
4. must NOT be git-tracked  (git ls-files --error-unmatch <p> succeeds ⇒ reject)
5. optuna dirs: allow *.lock / *-journal ONLY; reject *.db
6. age gate for scratch/tmp/logs: mtime older than threshold
→ any failed check ⇒ path lands in skipped[] with reason, never deleted
```

> **Takeaway:** `data/models` (98 MB of checkpoints) and QuestDB's data dir are the two
> irreplaceable things on this box — both are hard-excluded by prefix *and* by git-tracked check,
> so no janitor batch can reach them even if the UI passes a bad path. The big cheap win is
> `node_modules/.vite` (74 MB) + `dist` (82 MB), both fully regenerable.

---

## 6. Service registry (`svc.*`)

### 6.1 Enumeration & control matrix

| service | manager | detect | start/stop/restart | protection |
|---|---|---|---|---|
| **QuestDB** (PID 5996, java, `:9000`+`:9009`) | **nssm** | `sc qc QuestDB` type `WIN32_OWN_PROCESS`; `nssm dump QuestDB` succeeds | `nssm restart QuestDB` (preferred) / `sc stop`+`sc start` | `stop` = **forbidden**; `restart` = `dangerous` + typed echo (SHARED — feeds every repo) |
| dashboard dev server (PID 39108, `:5000`) | process (not a service) | `port.owner(5000)` | restart = stop stack → verify `:5000` free → relaunch `npm run dev` | live server; restart is `write` with confirm |
| long-running dev workers (tsx watch, training runs) | process | classify §2 | stop = `proc.kill` / `proc.kill-tree` | per verdict |

### 6.2 Restart discipline (mirrors the global "stop old runs before starting new ones" rule)

```
restart(target):
  1. IDENTIFY   → resolve exact PID(s) / service name (never a name glob)
  2. STOP       → nssm stop / sc stop / taskkill /T /F
  3. VERIFY     → poll until: service STATE=STOPPED, or port free, or PID gone (timeout → abort, report)
  4. START      → nssm start / sc start / spawn launcher
  5. HEALTH     → probe: QuestDB → GET :9000/exec 'select 1'; dashboard → GET :5000/api/readiness
  6. AUDIT      → row with before/after PID + health result
```

Never overlap: step 4 is gated on step 3 confirming the old instance is dead — exactly the global
rule that two parallel runs cause port/GPU/lock contention.

> **Takeaway:** QuestDB gets a **restart-only, never-stop** policy because it is the shared
> time-series backend for every project on this machine — a bare `stop` from this dashboard would
> silently break forexmodel, quant, analytics, and the QuestDB MCP server. The registry encodes
> that as `forbidden`, not as a warning.

---

## 7. Cockpit tiles — Phase 1 layout

Four tiles, each bound to capabilities above. **Colorblind-safe (deuteranopia): no red/green.**
Okabe-Ito palette; **positive/healthy = orange `#E69F00`, negative/alert = blue `#0072B2`**,
neutral grey `#999999`; reinforce state with icon + label, never color alone. Sequential meters
use `cividis`/`viridis`.

| tile | capabilities | content | writes (gated) |
|---|---|---|---|
| **ResourceTile** | `gpu.snapshot`, `cpu.snapshot`, `mem.snapshot`, `disk.snapshot` | live GPU (util/VRAM/temp/power via reused `system.gpu`), CPU load + per-core, RAM used/avail, disk use% per mount; `viridis` meters; VRAM target-band marker at 50-60% | none (read-only) |
| **ProcessTile** | `proc.list`, `proc.classify`, `proc.kill`, `proc.kill-tree` | categorized list grouped by verdict; **orphan reaper** = multi-select of `ORPHAN_*` rows → "Reap N (reclaims ~X MB)" → confirm dialog echoing each PID+cmdline; protected rows greyed, un-selectable | `proc.kill`, `proc.kill-tree` |
| **ServiceTile** | `svc.list`, `svc.restart`, `svc.stop`, `port.owner` | services + their pids + owned ports (`:5000`, `:9000`, `:9009`); QuestDB row shows **lock badge** (restart-only); port map row-per-listener | `svc.restart` (confirm), `svc.stop` (dangerous, QuestDB blocked) |
| **TempTile** | `temp.scan`, `temp.clean` | janitor: safelist roots with size/count bars (`cividis`), `review` items dimmed, `excluded` shown with lock icon + reason; "Clean selected (reclaims ~X MB)" → confirm listing exact paths | `temp.clean` |

Every tile's three-part header (per the analytics rule): **Objective** ("keep the machine lean —
kill orphans, free temp"), **Lever** ("reap the N stranded dev stacks / clear .vite+dist"),
**Headline** (e.g. "≈780 MB reclaimable from 10 orphans; QuestDB + live server locked").

> **Takeaway:** ProcessTile is the flagship — it's where the classifier's verdict becomes a
> one-click reap. The greyed-and-unselectable treatment of PROTECTED rows is the primary UX
> guardrail: the user physically cannot select QuestDB or the live server to kill.

---

## 8. Acceptance criteria — Phase 1 "done"

| # | criterion | verification |
|---|---|---|
| 1 | `proc.classify` correctly buckets the live ~260 processes: live server (39108) + hardware_node (17060) + QuestDB (5996) = `PROTECTED`; the ≥2 stranded ml_dashboard backend stacks (38260, 25740) + stale vite (56096) + 3 duplicate `npm run dev` = `ORPHAN_STRANDED`; all MCP/VS Code = `PROTECTED_SESSION` | run against a live sample; assert verdicts by PID |
| 2 | QuestDB (PID 5996 / `QuestDB` service) is **never** in any kill/reap set and never selectable; `svc.stop('QuestDB')` refuses | attempt via capability + UI; both blocked |
| 3 | The `:5000` owner and its ancestor chain + `hardware_node.py` child are never reapable even though their launcher (cross-env) is a dead parent | classify asserts PROTECTED despite dead parent |
| 4 | Killing a confirmed orphan (e.g. 38260) succeeds and `reclaimedMB` ≈ its working set; `mem.snapshot` reflects the freed RAM within one cycle | kill one orphan; diff mem before/after |
| 5 | `proc.kill-tree` on a stranded stack removes the whole cross-env→tsx→node trio, leaving no reparented survivors | classify before/after; assert children gone |
| 6 | `temp.clean` never touches `data/models` (98 MB), QuestDB data dir, `node_modules` (except `.vite`), or any git-tracked path — even if such a path is passed explicitly | pass poisoned paths; assert all in `skipped[]` |
| 7 | `temp.clean` on `node_modules/.vite` (74 MB) + `dist` reclaims the measured bytes and the dirs regenerate on next dev/build | clean; assert reclaimed; rebuild |
| 8 | Every `write`/`dangerous` execution writes a paired before/after **audit row**; no write path bypasses audit | inspect audit ledger after each op |
| 9 | An **agent can `propose` a reap but the process is not killed** until a human confirm click; agent has no path to auto-execute a write | drive via agent tool; assert proposal-only, proc still alive until UI confirm |
| 10 | `svc.restart('QuestDB')` follows stop→verify-dead→start→`select 1` health and requires typed-name echo; QuestDB comes back healthy on `:9000` | run restart; assert health probe passes |

---

## 9. Riskiest heuristic & how it's made safe (required callout)

**Single riskiest heuristic:** *"an ml_dashboard `tsx --watch … main.ts` process whose parent is
dead is a stranded orphan → reap it."*

**Why it's dangerous:** the **live** dashboard server (PID 39108) has a **dead parent chain** too —
its cross-env launcher (47260) already exited, which is normal for `tsx --watch`. A naive
dead-parent rule would flag the live server (1251 MB, owns `:5000`, parents the hardware_node feed)
as an orphan and kill it — taking down the whole dashboard, the SSE telemetry, and the Control
Terminal itself. The two stacks are **byte-identical on the command line**.

**How it's made safe (defense in depth):**
1. **Port ownership is the discriminator, not parent liveness.** A `main.ts` stack is only
   `ORPHAN_STRANDED` if it does **NOT** own `:5000` (`port.owner(5000).pid !== candidate`) **AND**
   a different live PID does own it (role already filled). Dead parent is never used alone.
2. **hardware_node child check.** The live server is the one with a `scripts/hardware_node.py` child;
   a stranded stack has none. Second independent confirmation.
3. **Self-PID exclusion.** The Control-Terminal backend excludes its own PID and ancestor chain from
   every kill set unconditionally.
4. **Re-classify at execution.** `proc.kill` re-runs classification the instant before killing, so a
   stale UI selection cannot leak the `:5000` owner through even if it changed since the list render.
5. **Age gate.** Nothing younger than 10 min is auto-selected — a server mid-boot (before it binds
   `:5000`) is never swept.

Net: the classifier degrades to a **safe keep** (a real orphan survives one more cycle) rather than
a catastrophic kill, in every ambiguous case.
