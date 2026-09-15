# Hooks and Automation — Operator Manual

Every automatic behavior in this Claude Code setup, in one place: what fires, when, what it can block, how to override it, and how to kill it. Written for the moment something misfires and you need the answer in under a minute.

If a tool call or turn just got blocked, jump straight to [When it misfires](#when-it-misfires).

Every claim about an existing hook below was verified against the script source and the settings registrations on 2026-07-26. The two in-flight hooks at the bottom are documented from their design description only and are marked as such.

---

## One-screen orientation: what fires when

**User-level** — registered in `C:\Users\tyler\.claude\settings.json`, scripts in `C:\Users\tyler\.claude\hooks\`. Applies to every project.

| Event | Matcher | Script | What it does | Can it block? |
|---|---|---|---|---|
| UserPromptSubmit | (all prompts) | `auto_dispatch.py` | Keyword-matches the prompt against `dispatch_registry.json`; injects `[auto-dispatch]` (specialist agents) and `[arsenal]` (skills/connectors/plugins) context blocks | No — every error path is a silent exit 0 |
| PreToolUse | `Write\|Edit` | `secret_guard.py` | Denies writes to secret-bearing paths (`.env*`, `.pem`, `.key`, `id_rsa`, …) and content matching credential patterns (Shopify `shpat_`, GitHub `ghp_`, Stripe `sk_live_`, PEM (Privacy-Enhanced Mail) blocks, DB connection strings with passwords, …) | Yes — **deny** |
| PreToolUse | `Write\|Edit` | `home_dir_guard.py` | Denies creating a NEW loose non-dotfile directly in `C:\Users\tyler\` root (subfolders, dotfiles, and existing files pass) | Yes — **deny** |
| PreToolUse | `Bash` | `destructive_guard.py` | Two tiers: catastrophic commands (`rm -rf /`, `mkfs`, `dd of=/dev/…`, `format X:`, fork bomb) → deny; destructive-but-legitimate (`git reset --hard`, `git push --force`, `DROP TABLE`, `npm publish`, `pm2 stop`, Shopify mutations, general `rm -rf`) → ask | Yes — **deny** or **ask** by tier |
| PreToolUse | `Bash\|PowerShell` | `norm_guard.py` | Normalization gate on ML (Machine Learning) training launches only: denies unambiguous look-ahead, allows silently on normalization evidence, asks when it can't confirm | Yes — **deny** or **ask** |
| PreToolUse | `clickup_delete_task\|clickup_merge_tasks` | `clickup_guard.py` | Forces confirmation before unrecoverable ClickUp writes (delete/merge in the live shared workspace) | Yes — **ask** |
| PostToolUse | `Write` (Write ONLY — Edits are not scanned) | `bloat_detector.py` | Warns on files >50KB or >500 lines, and on siblings with ≥70% name similarity (duplicate suspect) | No — advisory `systemMessage` only |
| Stop | (every turn end) | `acronym_guard.py` | Blocks the turn if the final reply uses any all-caps token ≥2 chars in prose without an `ACRONYM (Full Spelled-Out Form)` expansion. Code blocks/spans stripped first. Fires at most once per stop-chain (`stop_hook_active` guard) | Yes — **blocks turn end** once |
| Stop | (every turn end) | `doc_drift_check.py` | Blocks the turn if `git status` in the working dir shows dirty code files but zero dirty doc files (`CLAUDE.md`, `README.md`, any `.md`) | Yes — **blocks turn end** |
| Notification | `permission_prompt` / `idle_prompt` | `notify_sound.py` | Windows beeps: double-beep for permission prompts, single tone for idle | No |

**Project-level (ml_dashboard)** — registered in `E:\source\repos\ml_dashboard\.claude\settings.json`, scripts in `.claude\hooks\`.

| Event | Matcher | Script | What it does | Can it block? |
|---|---|---|---|---|
| PreToolUse | `Bash` (Bash ONLY — a PowerShell training launch bypasses it) | `training_guard.py` | On training-launch commands: queries `nvidia-smi`; if VRAM (Video Random-Access Memory) usage >60% → ask ("GPU OVERLOADED"). Also emits an advisory if the command doesn't look like it emits dashboard metrics | Yes — **ask** on VRAM only |
| PostToolUse | `Edit\|Write` | `auto-lint.py` | Auto-fix pass: `ruff check --fix --select F401,I` on `.py`, `npx eslint --fix` on `.ts`/`.tsx` | No |

**On disk but NOT registered (dormant):** `C:\Users\tyler\.claude\hooks\doc_reminder.py` — a PostToolUse soft nudge ("you just edited X, update docs") per its docstring, but no entry in any settings.json registers it. It never runs. The hard enforcement it describes is `doc_drift_check.py`, which IS registered. If you find doc reminders firing, something re-registered it; otherwise ignore the file or delete it.

**In flight (see [Unverified hooks](#unverified-hooks-in-flight))**: `agent_model_guard.py` (model-tier enforcement on Agent dispatch) and the problem pipeline (`problem_scan.py` + `quality_gate.py` + `scripts/verify.mjs`). Neither existed on disk when this document was verified.

---

## The four layers

1. **Policy layer** — `E:\Claude\cli-data\rules\workflow\advisor-not-implementer.md`. Not a hook; a standing directive that the main conversation orchestrates and reviews while agents build, plus the model-tier matrix below. Enforced socially (and, once shipped, mechanically by `agent_model_guard.py`).
2. **User-level hooks** — the global guard rail set in `C:\Users\tyler\.claude\`. Follows you into every repo.
3. **Project-level hooks** — ml_dashboard's own two: GPU pre-flight and auto-lint.
4. **In-flight hooks** — the model guard and the problem pipeline, being built as of this writing.

---

## The model-tier matrix

Source: `E:\Claude\cli-data\rules\workflow\advisor-not-implementer.md`. The Agent tool's `model` parameter takes exactly four values. The selection principle is one line from the rule itself:

> "Volume ≠ difficulty. 400 mechanical edits is haiku. One subtle write-gate is opus."

Cost scales with reasoning depth, not with how many files get touched. A 400-file rename is a fully-specified rule applied 400 times — zero judgment per application, and `tsc` proves the result, so the cheapest model wins. A single write-gate (one function deciding whether a destructive write proceeds) is the opposite: tiny diff, but a wrong answer deletes data and no compiler catches it. Escalate on how expensive a wrong answer is and how hard it is to detect, never on line count.

| Tier | Use for | Worked example |
|---|---|---|
| **haiku** | High-volume mechanical edits with an exact, stated rule; success is compiler- or test-checkable | Rename `getFrontMonth` → `resolveFrontMonth` across 400 files. The rule is total, judgment per file is zero, `tsc --noEmit` is the referee. |
| **sonnet** | The workhorse. Ordinary implementation against a decided design; agent applies it with local judgment. Most dispatches belong here | Wire a new `/api/anatomy/forest/:id` route to an existing service: contract stated, shape known, but the agent still picks names, handles the error path, writes the test. |
| **opus** | Design, ambiguous diagnosis, adversarial review, safety invariants, anything irreversible or touching money/data loss | Write the gate that decides whether a lake partition may be expired. Ten lines, but a subtle inversion silently destroys the only copy of 863M rows. Tradeoff reasoning, no compiler safety net. |
| **fable** | Generative/expressive work judged on quality of expression, not a provably-correct answer: prose, docs, naming, copy, design direction | This document. Many good answers exist; a compiler can't rank them; voice and structure are the deliverable. |

Rules of thumb, verbatim from the rule file: sonnet is the default for building — reach past it only with a reason; escalate for irreversibility regardless of size; use fable when the output is read by humans, not a compiler; omitting `model` inherits the session model, which is usually the wrong default for a bulk task; state the model choice and reason in the plan so it can be audited.

---

## When it misfires

### Step 1 — identify the hook from its message

Every blocking hook announces itself with a distinct prefix. Match the text you're looking at:

| Message starts with / contains | Hook | Layer |
|---|---|---|
| `NORMALIZATION GATE` | `norm_guard.py` | user PreToolUse |
| `BLOCKED:` + a command description, or `DESTRUCTIVE COMMAND DETECTED` | `destructive_guard.py` | user PreToolUse |
| `BLOCKED: Writing to '…'` or `BLOCKED: Detected potential secrets` | `secret_guard.py` | user PreToolUse |
| `home_dir_guard: blocked Write/Edit of loose file` | `home_dir_guard.py` | user PreToolUse |
| `CLICKUP DESTRUCTIVE ACTION` | `clickup_guard.py` | user PreToolUse |
| `Acronym rule violation` | `acronym_guard.py` | user Stop |
| `Documentation drift detected` | `doc_drift_check.py` | user Stop |
| `GPU OVERLOADED` or `TRAINING ADVISORY` | `training_guard.py` | project PreToolUse |
| `FILE SIZE WARNING` | `bloat_detector.py` (advisory only — nothing was blocked) | user PostToolUse |
| `MODEL TIER` -type message on an Agent call | `agent_model_guard.py` — ⚠ unverified, confirm the actual prefix against source once it lands | user PreToolUse (planned) |

### Step 2 — override the specific hook

| Hook | Override |
|---|---|
| `norm_guard.py` | Prefix the command with `NORM_OK=1`, or pass `--norm-verified` or `--skip-norm-check`. All three are an explicit assertion that you verified normalization — the hook exits 0 without scanning. On the **ask** tier you can also just approve the prompt. On the **deny** tier (look-ahead found) the override still works, but the deny message means the scanner found `rolling(center=True)`, a `win_type=` rolling, or a global whole-series z-score — check the leak is intentional before overriding. |
| `destructive_guard.py` (ask tier) | Approve the permission prompt — that IS the mechanism; the hook exists to force the pause, not to forbid. |
| `destructive_guard.py` (deny tier) | No inline override, deliberately. The deny list is root-filesystem wipes, raw-device writes, fork bombs. If you genuinely need one, edit `BLOCK_PATTERNS` in the script or disable the hook (below). |
| `secret_guard.py` | Intended fix: use an environment variable, not a literal. If the write is legitimate (docs discussing token formats, sample configs), the exempt list already passes `.example`, `.sample`, `.template`, `.md`, `CLAUDE.md`, and anything under `.claude\rules\` — rename to match, or add a pattern to `EXEMPT_PATTERNS`. |
| `home_dir_guard.py` | Put the file in a subfolder (`C:\Users\tyler\<project>\…` or `E:\source\repos\<project>\…`). Dotfiles at root and edits to existing root files already pass. |
| `clickup_guard.py` | Approve the prompt after confirming the exact `task_id`. That confirmation is the entire point — deletes/merges in ClickUp are unrecoverable and the workspace is shared. |
| `acronym_guard.py` | Expand the flagged acronyms as `ACRONYM (Full Spelled-Out Form)` and finish the turn. The `stop_hook_active` guard means it fires at most once per stop-chain — it cannot loop you. Acronyms inside code fences and backtick spans are never flagged. |
| `doc_drift_check.py` | Three exits, per the script's own docstring: (1) update a doc file so one lands in the dirty set, (2) commit the code changes — committing moves them out of `git status` and the next Stop passes, (3) state explicitly that no doc update is warranted — it will re-fire on the next Stop, but with a fresh prompt to address or commit. |
| `training_guard.py` | Approve the ask, or free VRAM first (`nvidia-smi` to find the squatter). Threshold is `VRAM_THRESHOLD = 60` (percent) in the script. |
| `agent_model_guard.py` | `MODEL_OK=1` per the design description — ⚠ unverified, confirm the exact flag name against the script source before relying on it. |

### Step 3 — disable a hook entirely

Hooks are plain registrations in a settings file plus a script. Two levels of kill switch:

1. **Deregister** — remove (or move aside) the hook's entry from the `hooks` section of the owning settings file:
   - User-level: `C:\Users\tyler\.claude\settings.json`
   - Project-level: `E:\source\repos\ml_dashboard\.claude\settings.json`

   JSON has no comment syntax — cut the entry out and keep it in a scratch file if you want it back. Hook configuration is captured at session start, so restart the Claude Code session (or review via `/hooks`) for the change to take.
2. **Neuter the script** — if you want the registration to stay put, add `sys.exit(0)` as the first line of the script's `main()`. Ugly but instant, no restart semantics to reason about, and trivially reversible.

Deleting the `.py` file is the wrong move: the registration will invoke a missing script every time, which is noise at best.

---

## Cost of noise

Every hook in this system is silent on the happy path. That is a design constraint, not a coincidence: **a hook that speaks when nothing is wrong trains you to ignore it, and then you ignore it on the day it matters.** The one historical counterexample is instructive — `doc_reminder.py` nagged after every code edit, and it now sits on disk unregistered while its silent, blocking sibling `doc_drift_check.py` does the actual enforcement.

The corollary for anything you add: if it fires on more than a small fraction of the actions it watches, either the threshold is wrong or it shouldn't be a hook. `bloat_detector.py` is the loosest hook here (an advisory on big files) and even it only speaks past 50KB/500 lines. Keep it that way.

---

## Extension guide

### Add a keyword to an existing guard's table

Each guard's trigger surface is a plain Python list of `(regex, description)` tuples or compiled patterns at the top of its script. No registry, no rebuild — edit and it's live on the next tool call (PreToolUse/PostToolUse hooks are executed fresh each time):

| Want to… | Edit |
|---|---|
| Flag a new destructive command | `DESTRUCTIVE_PATTERNS` (ask tier) or `BLOCK_PATTERNS` (deny tier) in `destructive_guard.py`; safe `rm -rf` targets in `SAFE_RM_TARGETS` |
| Catch a new secret token format | `SECRET_PATTERNS` in `secret_guard.py`; path bans in `BLOCKED_FILE_PATTERNS`; exemptions in `EXEMPT_PATTERNS` |
| Teach norm_guard new leak/evidence signals | `RED_DENY` (deny), `GREEN` (allow) in `norm_guard.py`; training-launch detection in `RUN_CONTEXT` / `TRAIN_TOKEN` |
| Route a new tool surface to a specialist agent | `C:\Users\tyler\.claude\hooks\dispatch_registry.json` — add `strong`/`weak`/`anchors` keywords under `specialists` (or `arsenal` for skills/connectors). Keep `strong` high-signal (exact names) and put common words only in `weak` behind an anchor, or the entry will fire constantly |
| Recognize a new training-script name in the GPU guard | `TRAINING_PATTERNS` in `.claude\hooks\training_guard.py`; metric-emitting scripts in `known_metric_scripts` |

The exception: `acronym_guard.py` has **no table by design**. It flags every unexpanded all-caps token. Its docstring records why the earlier curated-denylist version was removed — the list inverted the default and whole domains slipped through. Don't reintroduce a list; the fix for a false positive is to not write prose in all caps. (Note: the global CLAUDE.md still describes the old denylist behavior — the script is the truth.)

### Add a new hook

1. Write the script in `C:\Users\tyler\.claude\hooks\` (global) or `<repo>\.claude\hooks\` (project). Contract: JSON event payload on stdin; to block, print `{"hookSpecificOutput": {"permissionDecision": "deny"|"ask"}, "systemMessage": "..."}` to stderr and `sys.exit(2)` (PreToolUse), or print `{"decision": "block", "reason": "..."}` to stdout and `sys.exit(0)` (Stop). Exit 0 with no output = allow silently. Crib from `norm_guard.py` (the most complete example: tiers, override token, fail-open).
2. Register it in the owning settings.json under the right event with a matcher and a `timeout` (every existing hook sets one, 3–60s — set it, a hung hook stalls every matching tool call).
3. Make the block message self-identifying — a unique prefix that leads back to the script. That's what makes Step 1 of the misfire section work.
4. Add a row to the orientation table in this document.

### The fail-open rule

**A hook bug must never block work.** The pattern, from `norm_guard.py`:

```python
try:
    # ... all detection logic ...
except Exception:
    sys.exit(0)   # fail open — never block on a hook bug
```

Everything the hook does — parsing stdin, reading files, running subprocesses — sits inside a blanket try/except that exits 0. A hook is a guard rail; a guard rail that can itself crash the car is worse than no rail. Blocking is only ever the *deliberate* output of working detection logic, never the side effect of a broken hook. Both Stop hooks additionally guard against loops (`stop_hook_active` in `acronym_guard.py`; `doc_drift_check.py` offers commit as a structural bypass). When you write a new hook, the blanket except goes in before the first pattern does.

---

## Unverified hooks (in flight)

Two additions were under construction by other agents when this document was written and **did not exist on disk** at verification time (checked `C:\Users\tyler\.claude\hooks\` and `E:\source\repos\ml_dashboard\.claude\hooks\` + `scripts\` on 2026-07-26). Everything in this section is from their design description only.

### `agent_model_guard.py` — ⚠ unverified — confirm against source

- PreToolUse hook on the **Agent** tool. Enforces the model-tier matrix above: checks the `model` parameter of a dispatch against the tier the task warrants.
- Override described as `MODEL_OK=1` — ⚠ unverified: confirm the exact token, where it goes (dispatch prompt? env?), and whether the hook denies or asks, by reading the script once it lands.
- When it ships: verify its registration (expected: user-level settings.json, PreToolUse, matcher `Agent`), add its real block-message prefix to the identification table, and delete these caveats.

### Problem pipeline: `problem_scan.py` + `quality_gate.py` + `scripts/verify.mjs` — ⚠ unverified — confirm against source

- Described as a pipeline that scans for problems and gates on quality, with `scripts/verify.mjs` as the verification runner. Which events they bind to, what they block, what they scan, and any override tokens were not specified and could not be read from source.
- Do not assume fail-open until you've seen the try/except with your own eyes — that rule is a convention, not something the hook runner enforces.
- When they ship: document each one's event, matcher, block behavior, and override here, and move them up into the orientation table.

---

## Source of truth

This document was written from these files, read in full on 2026-07-26:

| File | Role |
|---|---|
| `E:\Claude\cli-data\rules\workflow\advisor-not-implementer.md` | Model-tier matrix + advisor role |
| `C:\Users\tyler\.claude\settings.json` | User-level hook registrations (the `hooks` key) |
| `C:\Users\tyler\.claude\hooks\*.py` | 10 user-level hook scripts (11 files incl. dormant `doc_reminder.py`) |
| `E:\source\repos\ml_dashboard\.claude\settings.json` | Project-level registrations |
| `E:\source\repos\ml_dashboard\.claude\hooks\{training_guard,auto-lint}.py` | Project-level hook scripts |

If this document and a script disagree, the script wins — then fix this document.
