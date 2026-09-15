# Control Terminal — Load-Bearing Module Pseudocode

> **Data-layer premise superseded (2026-09-10).** This spec was written against a local
> QuestDB serving cache reached over HTTP `:9000` / ILP `:9009` / PG wire `:8812`. That store
> was emptied and retired: all 41 objects were dropped after each was copied to parquet in the
> lake and row-count verified (39/39 exact), and nothing may read or write it again. Market
> data now lives in the Iceberg lake at `E:\lake` and is read **in-process by DuckDB**
> (`from lake.serving import connect`). Everything below that names a database host, port,
> Windows service, JVM process, WAL table, `SAMPLE BY`, materialized-view refresh or ILP
> write is stale and must be re-derived against the lake before it is built.

> **Status:** DESIGN. This is TypeScript-flavored pseudocode, compiling-shaped
> but not literal source. Boilerplate (imports of trivial helpers, exhaustive
> error branches already demonstrated once) is elided with `…`. Signatures,
> Zod shapes, Drizzle insert shapes, and SSE emit calls are written to match
> the real project so an implementer can translate near-directly.
>
> **Author:** A4. **Scope:** `registry.ts`, `agentTools.ts`, `agentDispatcher`
> integration, `control.router.ts`, proposal lifecycle, `machine/orphanClassifier.ts`,
> `ProcessTile.tsx`.

## The one invariant everything else serves

**A write capability's `execute()` is reachable from exactly one code path: `executeAsHuman(id, args, humanToken)`, and that function is the sole caller in the codebase that both (a) validates a live human-session token and (b) invokes `cap.execute()` for a `kind:'write'` capability.** Every other door into the registry — the Agent SDK tool handlers, the headless POST routes, the proposal-approval endpoint before token check — either refuses writes outright or converts them into an inert `control_proposals` row. There is no `cap.execute()` call anywhere outside the registry module, and inside the registry the write branch of `executeAsAgent` physically cannot call it. This is the choke-point; the rest of the document is plumbing around keeping it the only one.

---

## Shared foundation: the `Capability` contract and the proposal table

### `control/types.ts` (shared)

```ts
import type { ZodType } from 'zod';

export type ControlDomain = 'machine' | 'repo' | 'data' | 'agent';
export type ControlKind = 'read' | 'write';
export type ControlRisk = 'safe' | 'caution' | 'dangerous';

export interface Capability<Args = unknown, Result = unknown> {
  id: string;                       // dot-namespaced, unique, e.g. 'proc.classify'
  domain: ControlDomain;
  kind: ControlKind;
  risk: ControlRisk;
  title: string;                    // human label for the UI tile
  description: string;              // becomes the Agent SDK tool description verbatim
  args: ZodType<Args>;             // Zod schema — the single arg-validation source
  execute(a: Args): Promise<Result>;
  /** Optional dry-run preview for dangerous writes — returns the projected
   *  effect WITHOUT mutating (e.g. "these 7 PIDs would be killed"). Consumed
   *  by the confirm UI + proposal preview. Never mutates. */
  preview?(a: Args): Promise<ControlPreview>;
}

export interface ControlPreview {
  summary: string;                  // "Reap 7 orphan processes"
  affected: Array<{ kind: string; id: string | number; label: string }>;
  reversible: boolean;
}

/** Terminal + transitional states of a proposed write. */
export type ProposalStatus = 'pending' | 'approved' | 'executed' | 'rejected' | 'expired';
```

### Drizzle table `control_proposals` (append to `src/shared/schema.ts`)

Mirrors the `agentRuns` declaration style (autoincrement id like `uploads`, JSON-mode text columns like `agentRuns.output`, an index block).

```ts
export const controlProposals = sqliteTable('control_proposals', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  proposalId: text('proposal_id').notNull().unique()      // public UUID (crypto.randomUUID)
    .$defaultFn(() => crypto.randomUUID()),
  capabilityId: text('capability_id').notNull(),           // FK-by-convention to registry id
  domain: text('domain', { enum: ['machine','repo','data','agent'] }).notNull(),
  risk: text('risk', { enum: ['safe','caution','dangerous'] }).notNull(),
  status: text('status', {
    enum: ['pending','approved','executed','rejected','expired'],
  }).notNull().default('pending'),
  args: text('args', { mode: 'json' }).$type<Record<string, unknown>>().notNull(),
  preview: text('preview', { mode: 'json' }).$type<ControlPreview>(),   // snapshot at propose-time
  // Provenance — which agent run asked for this write.
  originRunId: text('origin_run_id'),                      // agent_runs.run_id, nullable
  originAgentId: text('origin_agent_id'),
  // Outcome
  result: text('result', { mode: 'json' }).$type<Record<string, unknown>>(),
  error: text('error'),
  proposedAt: text('proposed_at').notNull(),               // ISO 8601 (matches agentRuns)
  decidedAt: text('decided_at'),                           // approve/reject time
  executedAt: text('executed_at'),
  expiresAt: text('expires_at').notNull(),                 // proposedAt + TTL (15 min default)
  decidedByToken: text('decided_by_token'),                // sha256 of the human token (never raw)
}, (table) => ({
  statusIdx: index('idx_control_proposals_status').on(table.status),
  capIdx: index('idx_control_proposals_cap').on(table.capabilityId),
  originIdx: index('idx_control_proposals_origin').on(table.originRunId),
  expiresIdx: index('idx_control_proposals_expires').on(table.expiresAt),
}));

export type ControlProposal = InferSelectModel<typeof controlProposals>;
export type InsertControlProposal = InferInsertModel<typeof controlProposals>;
```

### `control.proposals` domain event (append to `src/shared/event-types.ts`)

```ts
export type ControlEvent =
  | BaseEvent<'control.proposals', {                       // registry emits on new proposal
      proposalId: string;
      capabilityId: string;
      risk: ControlRisk;
      originRunId: string | null;
      status: ProposalStatus;
    }>
  | BaseEvent<'control.proposal.decided', {                // approve/reject/execute outcome
      proposalId: string;
      status: ProposalStatus;                              // approved|executed|rejected|expired
      result?: Record<string, unknown>;
      error?: string;
    }>
  | BaseEvent<'control.telemetry', {                       // live process/host counts for tiles
      procTotal: number;
      byCategory: Record<string, number>;
      reapableCount: number;
      timestamp: number;
    }>;
// add ControlEvent to the DomainEvent union.
```

Add a `control` SSE channel to `sse-adapter.ts` `CHANNEL_PATTERNS` so `control.` events reach the client:

```ts
const CHANNEL_PATTERNS: Record<SSEChannel, string[]> = {
  pipeline: ['pipeline.', 'market.'],
  training: ['training.'],
  system:   ['cache.', 'system.', 'model.', 'ingestion.'],
  control:  ['control.'],                                  // NEW
};
// extend SSEChannel union + ALL_CHANNELS + VALID_CHANNELS in events.router.ts.
```

---

## 1. `control/registry.ts` — `defineCapability`, `CapabilityRegistry`, the write-gate

```ts
import { z, type ZodType } from 'zod';
import crypto from 'crypto';
import { db } from '../infrastructure/database/db';
import { controlProposals } from '@shared/schema';
import { getEventBus } from '../infrastructure/events/event-bus';
import { verifyHumanToken } from './humanSession';       // §see below
import { writeAudit } from './audit';                    // thin audit-log writer
import type {
  Capability, ControlDomain, ControlKind, ControlRisk, ControlPreview,
} from './types';

// ── Proposal TTL — pending writes auto-expire ───────────────────────────────
const PROPOSAL_TTL_MS = 15 * 60_000;

// ── defineCapability: identity helper that also freezes the object ──────────
// No behavior beyond type-inference + Object.freeze so a capability can't be
// mutated after registration. The generic pins Args to the Zod schema's output.
export function defineCapability<Args, Result>(
  spec: Capability<Args, Result>,
): Capability<Args, Result> {
  // Invariant checks that would otherwise fail silently at call time.
  if (!/^[a-z0-9]+(\.[a-z0-9]+)+$/.test(spec.id))
    throw new Error(`capability id must be dot-namespaced lowercase: ${spec.id}`);
  if (spec.kind === 'write' && spec.risk === 'dangerous' && !spec.preview)
    throw new Error(`dangerous write ${spec.id} MUST supply preview()`);
  return Object.freeze(spec);
}

// ── The result envelope executeAsAgent returns for a write ──────────────────
export interface ProposedResult {
  status: 'proposed';
  proposalId: string;
}
export interface RanResult<R> {
  status: 'ran';
  result: R;
}
export type AgentExecOutcome<R> = RanResult<R> | ProposedResult;

// ── The registry ────────────────────────────────────────────────────────────
export class CapabilityRegistry {
  private readonly caps = new Map<string, Capability>();

  register<A, R>(cap: Capability<A, R>): void {
    if (this.caps.has(cap.id)) throw new Error(`duplicate capability id: ${cap.id}`);
    this.caps.set(cap.id, cap as Capability);
  }

  get(id: string): Capability | undefined { return this.caps.get(id); }

  list(): Capability[] { return [...this.caps.values()]; }

  listByDomain(domain: ControlDomain): Capability[] {
    return this.list().filter((c) => c.domain === domain);
  }

  // ── WRITE-GATE, human path ────────────────────────────────────────────────
  // The ONLY function in the codebase that calls cap.execute() for a write.
  // Preconditions: a valid human-session token; for risk='dangerous', an
  // explicit second confirm flag rides in the token-bearing request.
  async executeAsHuman<R>(
    id: string,
    rawArgs: unknown,
    humanToken: string,
    opts: { confirmDangerous?: boolean; proposalId?: string; originRunId?: string | null } = {},
  ): Promise<R> {
    const cap = this.requireCap(id);

    // 1. Authenticate the human. Throws HumanAuthError → router maps to 401/403.
    const session = verifyHumanToken(humanToken);   // { subject, issuedAt, ... } or throw

    // 2. Dangerous writes need the extra confirm flag EVEN on the human path.
    //    A dangerous capability cannot run from a token alone — the human must
    //    have passed through the confirm UI, which sets confirmDangerous:true.
    if (cap.kind === 'write' && cap.risk === 'dangerous' && !opts.confirmDangerous) {
      throw new ControlConfirmRequired(cap.id,
        'dangerous write requires explicit confirmDangerous=true');
    }

    // 3. Zod-parse args at the gate — never trust the caller's shape, even a
    //    stored proposal's args (they were parsed at propose-time, but the
    //    schema may have tightened since; re-parse is cheap and authoritative).
    const args = cap.args.parse(rawArgs) as unknown;

    // 4. Run it. This is the load-bearing line.
    const startedAt = Date.now();
    let result: R;
    try {
      result = (await cap.execute(args)) as R;
    } catch (err) {
      writeAudit({
        capabilityId: cap.id, actor: 'human', subject: session.subject,
        outcome: 'error', error: (err as Error).message,
        args, proposalId: opts.proposalId ?? null, durationMs: Date.now() - startedAt,
      });
      throw err;
    }

    // 5. Audit the successful mutation (append-only ledger; never PII of token).
    writeAudit({
      capabilityId: cap.id, actor: 'human', subject: session.subject,
      outcome: 'ok', args, result, proposalId: opts.proposalId ?? null,
      durationMs: Date.now() - startedAt,
    });
    return result;
  }

  // ── WRITE-GATE, agent path ────────────────────────────────────────────────
  // Reads run. Writes NEVER run — they become a control_proposals row + event.
  // Note: this function has NO parameter through which a caller could force
  // execution of a write. There is no `humanToken` here by design.
  async executeAsAgent<R>(
    id: string,
    rawArgs: unknown,
    runId: string,
  ): Promise<AgentExecOutcome<R>> {
    const cap = this.requireCap(id);
    const args = cap.args.parse(rawArgs) as unknown;   // Zod at the gate, always

    // READ → run immediately, audit, return.
    if (cap.kind === 'read') {
      const startedAt = Date.now();
      const result = (await cap.execute(args)) as R;
      writeAudit({
        capabilityId: cap.id, actor: 'agent', subject: runId,
        outcome: 'ok', args, result, durationMs: Date.now() - startedAt,
      });
      return { status: 'ran', result };
    }

    // WRITE → propose only. cap.execute() is deliberately unreachable here.
    const preview = cap.preview ? await safePreview(cap, args) : undefined;
    const proposalId = crypto.randomUUID();
    const nowIso = new Date().toISOString();

    db.insert(controlProposals).values({
      proposalId,
      capabilityId: cap.id,
      domain: cap.domain,
      risk: cap.risk,
      status: 'pending',
      args: args as Record<string, unknown>,
      preview: preview ?? null,
      originRunId: runId,
      originAgentId: null,                 // filled by caller-side enrichment if known
      proposedAt: nowIso,
      expiresAt: new Date(Date.now() + PROPOSAL_TTL_MS).toISOString(),
    }).run();

    // Emit control.proposals so the terminal's proposal inbox lights up live.
    getEventBus().emit({
      type: 'control.proposals',
      data: { proposalId, capabilityId: cap.id, risk: cap.risk, originRunId: runId, status: 'pending' },
      metadata: { correlationId: runId, causationId: runId, timestamp: Date.now() },
    });

    writeAudit({
      capabilityId: cap.id, actor: 'agent', subject: runId,
      outcome: 'proposed', args, proposalId,
    });

    return { status: 'proposed', proposalId };
  }

  private requireCap(id: string): Capability {
    const cap = this.caps.get(id);
    if (!cap) throw new ControlNotFound(id);
    return cap;
  }
}

async function safePreview(cap: Capability, args: unknown): Promise<ControlPreview | undefined> {
  try { return await cap.preview!(args); }
  catch { return undefined; }             // preview failure never blocks proposing
}

// ── Errors (router maps these to status codes) ──────────────────────────────
export class ControlNotFound extends Error { constructor(id: string){ super(`no capability ${id}`);} }
export class ControlConfirmRequired extends Error { constructor(public id: string, m: string){ super(m);} }
export class HumanAuthError extends Error {}

// ── Singleton + registration entry point ────────────────────────────────────
let _registry: CapabilityRegistry | null = null;
export function getRegistry(): CapabilityRegistry {
  if (!_registry) {
    _registry = new CapabilityRegistry();
    registerAllCapabilities(_registry);   // machine/*, repo/*, data/*, agent/*
  }
  return _registry;
}
```

### `control/humanSession.ts` — the token the choke-point trusts

```ts
// The human-session token is minted when Tyler authenticates the terminal
// (localhost single-user; token = HMAC(serverSecret, sessionId+issuedAt), short
// TTL, rotated per browser session). Agents NEVER receive or see this token —
// it lives only in the browser + is sent on the human-only POST routes.
export interface HumanSession { subject: string; issuedAt: number; }

export function verifyHumanToken(token: string): HumanSession {
  if (!token) throw new HumanAuthError('missing human-session token');
  const decoded = verifyHmac(token, process.env.CONTROL_SESSION_SECRET!);  // throws on bad sig
  if (Date.now() - decoded.issuedAt > SESSION_TTL_MS) throw new HumanAuthError('token expired');
  return decoded;
}
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');   // stored, never raw
}
```

**Takeaway:** the agent path and the human path are two different method
signatures. `executeAsAgent` has no token parameter and its write branch has no
`execute()` call — an agent literally cannot reach a mutation, so a prompt
injection can at most spam the proposal inbox, never touch the machine.

---

## 2. `control/agentTools.ts` — registry → Agent SDK tool definitions

```ts
import { zodToJsonSchema } from 'zod-to-json-schema';   // pin ^3.24.x
import { getRegistry, type AgentExecOutcome } from './registry';
import type { Capability } from './types';

// The SDK's `query({ options: { tools } })` expects tool defs shaped roughly
// like Anthropic tool-use blocks: { name, description, input_schema, handler }.
// (The dispatcher's SDKQueryFn signature is `options?: Record<string, unknown>`,
//  so we hand these through options.tools — see §3.)
export interface SdkToolDef {
  name: string;                          // capability id with dots → underscores
  description: string;                   // === capability.description (verbatim)
  input_schema: Record<string, unknown>; // JSON Schema derived from cap.args
  handler: (input: unknown) => Promise<SdkToolResult>;
}
export interface SdkToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

// SDK tool names disallow dots in some transports — canonical bidirectional map.
export const toolName = (capId: string) => capId.replace(/\./g, '__');
export const capIdFromTool = (name: string) => name.replace(/__/g, '.');

/**
 * Build the tool array for a given agent run. `runId` is captured in the
 * closure so every handler routes through executeAsAgent with the right
 * provenance. Reads run; writes propose.
 */
export function buildControlTools(runId: string): SdkToolDef[] {
  const registry = getRegistry();
  return registry.list().map((cap) => makeTool(cap, runId));
}

function makeTool(cap: Capability, runId: string): SdkToolDef {
  // input_schema is the Zod schema rendered to JSON Schema. `target:'jsonSchema7'`
  // and `$refStrategy:'none'` keep it inline (Anthropic tool schemas don't deref).
  const input_schema = zodToJsonSchema(cap.args, {
    target: 'jsonSchema7',
    $refStrategy: 'none',
  }) as Record<string, unknown>;

  // Tool description = capability.description, prefixed with the write-contract
  // note ONLY for writes so the model never assumes a write took effect.
  const description = cap.kind === 'write'
    ? `${cap.description}\n\n[WRITE — human approval required. Calling this files a `
      + `proposal; it does NOT execute. The response will say "proposed". Do not `
      + `assume the change happened or report it as done.]`
    : cap.description;

  return {
    name: toolName(cap.id),
    description,
    input_schema,
    handler: async (input: unknown): Promise<SdkToolResult> => {
      try {
        const outcome = await getRegistry().executeAsAgent(cap.id, input, runId)
          as AgentExecOutcome<unknown>;

        if (outcome.status === 'ran') {
          // Read result → serialize for the model.
          return { content: [{ type: 'text',
            text: JSON.stringify({ status: 'ran', result: outcome.result }) }] };
        }
        // Write → proposal filed. Tell the model plainly it is NOT done.
        return { content: [{ type: 'text', text:
          `PROPOSED (id=${outcome.proposalId}). This action is queued for human `
          + `approval and has NOT run. Await human execution — do not assume it `
          + `succeeded, do not retry, do not report it as completed.` }] };
      } catch (err) {
        // Zod validation / not-found / etc. surfaced to the model as tool error.
        return { isError: true, content: [{ type: 'text',
          text: `tool error: ${(err as Error).message}` }] };
      }
    },
  };
}
```

**Takeaway:** the tool description is literally `capability.description` (plus a
mandatory write-warning suffix), so the model's affordances are exactly the
registry's, and every write tool's own text tells the model it did not run.

---

## 3. `agentDispatcher` integration — minimal diff

The Control Terminal adds a **fifth agent id**, `'control-agent'`, a general
operator that gets the control tools. The diff is surgical and keeps the file's
existing structure (queue, ring buffer, `callSdk`) intact.

```ts
// ── schema.ts: extend the agent_id enum ─────────────────────────────────────
// agentRuns.agentId enum gains 'control-agent'; AgentId union widens.
agentId: text('agent_id', {
  enum: ['feature-curator','arch-designer','hpo-strategist','eval-reviewer','control-agent'],
}).notNull(),

// ── agentDispatcher.ts: VALID_AGENT_IDS gains the new id ────────────────────
const VALID_AGENT_IDS = [
  'feature-curator','arch-designer','hpo-strategist','eval-reviewer',
  'control-agent',                                    // NEW
] as const satisfies readonly AgentId[];
```

The only functional change is inside `callSdk` — where `query()` is invoked.
Currently: `const iter = sdkFn({ prompt });`. We thread tools + a tool_use router
for the control agent, and leave the four workshop agents exactly as they are.

```ts
// agentDispatcher.ts — callSdk(), at the sdkFn({ prompt }) call site.
import { buildControlTools, capIdFromTool, type SdkToolDef } from '../../control/agentTools';

async function callSdk(runId: string, agentId: AgentId, enrichedBlob: AgentContextBlob)
  : Promise<SdkCallResult> {
  const sdkFn = getActiveSdk() ?? (await loadSdk());
  if (!sdkFn) throw new AgentDispatchError(/* …unchanged… */);

  const prompt = buildAgentPrompt(agentId, enrichedBlob);

  // NEW: only the control-agent receives the registry tools.
  const tools: SdkToolDef[] | undefined =
    agentId === 'control-agent' ? buildControlTools(runId) : undefined;

  // NEW: an index so the SDK's tool-use callbacks resolve to our handlers. The
  // Agent SDK invokes tools itself when passed `options.tools` with handlers;
  // if the installed SDK version instead surfaces tool_use blocks for the host
  // to satisfy, we route them here (both shapes handled — see the loop below).
  const toolIndex = new Map<string, SdkToolDef>();
  tools?.forEach((t) => toolIndex.set(t.name, t));

  const iter = sdkFn({
    prompt,
    options: tools ? {
      tools,                                  // hand the control tools to query()
      // allowedTools defaults to all provided; the write-gate is the real guard,
      // NOT an allowlist — even an allowed write tool only proposes.
    } : undefined,
  });

  // …existing for-await loop unchanged for token_chunk / result handling…
  for await (const msg of iter) {
    const m = msg as { type?: string; [k: string]: unknown };
    if (m.type === 'assistant') {
      // …existing text/token_chunk emit…
      // Existing branch already emits 'tool_call' for b.type==='tool_use'.
      // If THIS SDK build requires the host to execute tools (no built-in
      // handler dispatch), satisfy them via our registry-backed handlers:
      for (const block of extractToolUseBlocks(m)) {
        const tool = toolIndex.get(block.name);
        if (!tool) continue;                  // non-control tool → SDK handles
        const toolResult = await tool.handler(block.input);   // → executeAsAgent
        emitBus(runId, 'tool_result', {
          tool: capIdFromTool(block.name), call_id: block.id,
          proposed: /PROPOSED/.test(toolResult.content[0]?.text ?? ''),
        });
        // feed toolResult back into the SDK turn per its resume API
        // (e.g. iter.next({ tool_use_id: block.id, content: toolResult.content })).
      }
    }
    // …existing 'result' / 'rate_limit' branches unchanged…
  }
  // …unchanged tail…
}
```

Key faithfulness points to the existing file:
- No change to the queue, `scheduleTick`, `runJob`, ring buffer, or boot recovery.
- `emitBus(runId, 'tool_call', …)` already exists for the `tool_use` block; we add a paired `tool_result` emit carrying a `proposed` flag so the SSE stream shows the human that a write was *queued, not done*.
- `enrichContextBlob` gains a `control-agent` branch that injects a live host snapshot (proc counts by category from §6) so the model reasons over real state, never fabricated (`_unavailable` markers on any missing source, matching the existing convention).

**Takeaway:** one enum value, one tools array behind an `agentId === 'control-agent'` guard, one tool_use→`executeAsAgent` route. The dispatcher stays the owner of queueing/streaming; the registry stays the owner of the gate.

---

## 4. `control/control.router.ts` — auto-mounted, human-token-guarded writes

Follows the Express-bridge pattern: a `Router()` default-exported, mounted under
`/api` in `routes.ts` alongside `agentsRouter`. Routes are generated by
iterating the registry so a new capability needs zero router edits.

```ts
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { getRegistry, ControlNotFound, ControlConfirmRequired, HumanAuthError } from './registry';
import { db } from '../infrastructure/database/db';
import { controlProposals } from '@shared/schema';
import { eq } from 'drizzle-orm';
import { getEventBus } from '../infrastructure/events/event-bus';

const router = Router();

// ── Human-token extraction (header set by the client; agents never have it) ──
function humanToken(req: Request): string {
  return (req.header('x-control-human-token') ?? '').trim();
}

// ── Auto-mount: iterate registry, generate one route per capability ─────────
// Reads  → GET  /api/control/cap/:id   (args via querystring, Zod-parsed)
// Writes → POST /api/control/cap/:id   (args in body, HUMAN TOKEN REQUIRED)
// Because the path is `:id`, we do a single dynamic pair of handlers rather
// than literally registering N routes — but we validate :id against the
// registry so unknown ids 404 exactly like a missing route.
router.get('/control/cap/:id', async (req, res) => {
  const cap = getRegistry().get(req.params.id);
  if (!cap) return res.status(404).json({ error: `no capability ${req.params.id}` });
  if (cap.kind !== 'read')
    return res.status(405).json({ error: `${cap.id} is a write; POST it with a human token` });

  try {
    // Reads may run headless (dashboards poll them) — no token required.
    // Route reads through executeAsAgent with a synthetic runId so audit still
    // records provenance, OR a dedicated executeRead — here we use a read-only
    // system subject.
    const outcome = await getRegistry().executeAsAgent(cap.id, req.query, 'http-read');
    return res.json(outcome.status === 'ran' ? outcome.result : outcome);
  } catch (err) {
    return mapError(res, err);
  }
});

router.post('/control/cap/:id', async (req, res) => {
  const cap = getRegistry().get(req.params.id);
  if (!cap) return res.status(404).json({ error: `no capability ${req.params.id}` });

  const token = humanToken(req);
  if (!token)
    // Writes are HUMAN-ONLY at the HTTP layer. A headless/agent caller has no
    // token and is refused here BEFORE any registry logic. This is the second
    // fence (the first is executeAsAgent never running writes at all).
    return res.status(401).json({ error: 'write requires x-control-human-token' });

  const body = z.object({
    args: z.record(z.unknown()).default({}),
    confirmDangerous: z.boolean().optional(),
  }).safeParse(req.body);
  if (!body.success) return res.status(400).json(body.error.flatten());

  try {
    const result = await getRegistry().executeAsHuman(
      cap.id, body.data.args, token,
      { confirmDangerous: body.data.confirmDangerous },
    );
    return res.json({ status: 'ran', result });
  } catch (err) {
    return mapError(res, err);
  }
});

// ── Proposal inbox ──────────────────────────────────────────────────────────
router.get('/control/proposals', (req, res) => {
  const status = z.enum(['pending','approved','executed','rejected','expired'])
    .optional().parse(req.query.status);
  const rows = status
    ? db.select().from(controlProposals).where(eq(controlProposals.status, status)).all()
    : db.select().from(controlProposals).all();
  return res.json(rows);
});

// ── Approve a proposal → executes the stored write AS HUMAN ─────────────────
router.post('/control/proposals/:proposalId/approve', async (req, res) => {
  const token = humanToken(req);
  if (!token) return res.status(401).json({ error: 'approval requires x-control-human-token' });

  const confirmDangerous = Boolean(req.body?.confirmDangerous);
  try {
    const outcome = await approveProposal(req.params.proposalId, token, confirmDangerous);
    return res.json(outcome);
  } catch (err) { return mapError(res, err); }
});

// ── Reject ──────────────────────────────────────────────────────────────────
router.post('/control/proposals/:proposalId/reject', async (req, res) => {
  const token = humanToken(req);
  if (!token) return res.status(401).json({ error: 'reject requires x-control-human-token' });
  try {
    const row = await rejectProposal(req.params.proposalId, token, String(req.body?.reason ?? ''));
    return res.json(row);
  } catch (err) { return mapError(res, err); }
});

function mapError(res: Response, err: unknown) {
  if (err instanceof ControlNotFound)        return res.status(404).json({ error: err.message });
  if (err instanceof HumanAuthError)         return res.status(403).json({ error: err.message });
  if (err instanceof ControlConfirmRequired) return res.status(428).json({  // 428 Precondition Required
    error: err.message, code: 'confirm_required', capabilityId: err.id });
  if (err instanceof z.ZodError)             return res.status(400).json(err.flatten());
  return res.status(500).json({ error: (err as Error).message });
}

export default router;
```

Mount in `src/server/infrastructure/core/routes.ts` (mirroring `agentsRouter`):

```ts
import controlRouter from '../../control/control.router';
// … in registerRoutes, alongside the other /api mounts:
app.use('/api', controlRouter);
```

**Takeaway:** writes are refused at the HTTP door without a human token, and
even with one they run through `executeAsHuman` (the same gate the approve flow
uses). A headless script hitting `POST /control/cap/:id` gets a flat 401 — there
is no header an agent process can forge because it never holds the session secret.

---

## 5. Proposal lifecycle — state machine + agent-run notification

```
                 executeAsAgent(write)
                         │
                         ▼
                    ┌─────────┐   approve + valid token + (confirm if dangerous)
                    │ pending │────────────────────────────┐
                    └─────────┘                             ▼
                     │      │                          ┌──────────┐  execute() ok
              reject │      │ TTL elapsed              │ approved │───────────────► ┌──────────┐
                     ▼      ▼                          └──────────┘                 │ executed │
                ┌──────────┐ ┌─────────┐                    │ execute() throws      └──────────┘
                │ rejected │ │ expired │                     ▼
                └──────────┘ └─────────┘               (status stays 'approved',
                                                        error recorded, retryable)
```

Legal transitions (enforced in code, not just diagrammed):
`pending → approved | rejected | expired`; `approved → executed` (or stays
`approved` with an `error` on failure so the human can retry); everything else
terminal. Colors in any UI rendering of this must be shape/label-reinforced, not
red/green (deuteranopia): use Okabe-Ito orange `#E69F00` for pending/attention,
blue `#0072B2` for executed/settled, plus an icon per state.

```ts
// control/proposalLifecycle.ts
import { db } from '../infrastructure/database/db';
import { controlProposals } from '@shared/schema';
import { eq, and, lt } from 'drizzle-orm';
import { getRegistry } from './registry';
import { hashToken, verifyHumanToken } from './humanSession';
import { getEventBus } from '../infrastructure/events/event-bus';
import { getReplayBuffer } from '../infrastructure/lib/agentDispatcher';  // for notify

function loadPending(proposalId: string) {
  const row = db.select().from(controlProposals)
    .where(eq(controlProposals.proposalId, proposalId)).get();
  if (!row) throw new ControlNotFound(proposalId);
  return row;
}

export async function approveProposal(
  proposalId: string, humanToken: string, confirmDangerous: boolean,
) {
  verifyHumanToken(humanToken);                     // 403 if bad
  const row = loadPending(proposalId);

  // Guard the state machine.
  if (row.status !== 'pending') throw new Error(`proposal ${proposalId} is ${row.status}, not pending`);
  if (new Date(row.expiresAt).getTime() < Date.now()) {
    markExpired(proposalId);
    throw new Error(`proposal ${proposalId} expired`);
  }

  const nowIso = new Date().toISOString();
  // pending → approved (records who decided; token stored only as sha256).
  db.update(controlProposals).set({
    status: 'approved', decidedAt: nowIso, decidedByToken: hashToken(humanToken),
  }).where(eq(controlProposals.proposalId, proposalId)).run();

  // approved → executed via the SAME human gate. Re-parse of args happens
  // inside executeAsHuman; the stored preview is snapshot-only.
  try {
    const result = await getRegistry().executeAsHuman(
      row.capabilityId, row.args, humanToken,
      { confirmDangerous, proposalId, originRunId: row.originRunId },
    );
    db.update(controlProposals).set({
      status: 'executed', executedAt: new Date().toISOString(),
      result: result as Record<string, unknown>,
    }).where(eq(controlProposals.proposalId, proposalId)).run();

    notifyOutcome(row.originRunId, proposalId, 'executed', result, null);
    return { status: 'executed', proposalId, result };
  } catch (err) {
    // Stays 'approved' with error → the human can retry; NOT auto-reverted.
    const message = (err as Error).message;
    db.update(controlProposals).set({ error: message })
      .where(eq(controlProposals.proposalId, proposalId)).run();
    notifyOutcome(row.originRunId, proposalId, 'approved', null, message);
    throw err;
  }
}

export async function rejectProposal(proposalId: string, humanToken: string, reason: string) {
  verifyHumanToken(humanToken);
  const row = loadPending(proposalId);
  if (row.status !== 'pending') throw new Error(`cannot reject ${row.status} proposal`);
  db.update(controlProposals).set({
    status: 'rejected', decidedAt: new Date().toISOString(),
    decidedByToken: hashToken(humanToken), error: reason || null,
  }).where(eq(controlProposals.proposalId, proposalId)).run();
  notifyOutcome(row.originRunId, proposalId, 'rejected', null, reason);
  return { status: 'rejected', proposalId };
}

// ── Expiry sweep — run on a timer (setInterval, unref'd) + lazily on read ────
export function sweepExpired(): number {
  const nowIso = new Date().toISOString();
  const res = db.update(controlProposals)
    .set({ status: 'expired', decidedAt: nowIso })
    .where(and(eq(controlProposals.status, 'pending'), lt(controlProposals.expiresAt, nowIso)))
    .run();
  return (res as { changes?: number }).changes ?? 0;
}
function markExpired(proposalId: string) {
  db.update(controlProposals).set({ status: 'expired', decidedAt: new Date().toISOString() })
    .where(eq(controlProposals.proposalId, proposalId)).run();
}

// ── Notify the originating agent run of the human's decision ─────────────────
// The agent that proposed the write is (usually) done streaming by the time the
// human decides. We push the outcome BACK into that run's SSE ring buffer via
// the dispatcher's emit path so a reconnecting client — or a still-open panel —
// sees `agent.control_outcome`. Also emits the domain-level control event.
function notifyOutcome(
  originRunId: string | null, proposalId: string,
  status: 'executed'|'approved'|'rejected'|'expired',
  result: unknown, error: string | null,
) {
  // Domain event for the control channel (proposal inbox live-updates).
  getEventBus().emit({
    type: 'control.proposal.decided',
    data: { proposalId, status, result: (result ?? undefined) as Record<string, unknown>,
            error: error ?? undefined },
    metadata: { correlationId: proposalId, causationId: proposalId, timestamp: Date.now() },
  });

  // Back-notify the agent run's per-run channel `agent.<runId>.control_outcome`
  // so useAgentDispatch()-style listeners on that run observe the resolution.
  // The dispatcher owns the ring buffer; we call its exported emit helper.
  if (originRunId) {
    emitIntoAgentRun(originRunId, 'control_outcome', {
      proposal_id: proposalId, status, result, error,
    });
  }
}
```

The dispatcher exposes a tiny new export so the lifecycle can inject into an
existing run's buffer + bus (reusing the exact `emitBus` mechanics, so replay +
`Last-Event-ID` keep working):

```ts
// agentDispatcher.ts — NEW public export (thin wrapper over the private emitBus).
export function emitIntoAgentRun(runId: string, eventKind: string, data: Record<string, unknown>): void {
  emitBus(runId, eventKind, data);   // pushes to ring buffer + emits agent.<runId>.<kind>
}
```

**Takeaway:** the decision loop closes back onto the agent's own SSE stream —
the model's proposal, the human's approval, and the execution result are one
correlated thread keyed by `originRunId`, so nothing about "did my write happen?"
is ever guessed. A failed execute leaves the proposal `approved` (retryable), not
silently lost.

---

## 6. `machine/orphanClassifier.ts` — classify the 259 processes

```ts
import si from 'systeminformation';
import path from 'path';

// Categories the tile + proc.classify capability return.
export type ProcCategory =
  | 'dashboard'            // this app's own node/electron/vite/tsx tree — PROTECTED
  | 'mcp-server'           // node/uvx MCP servers (notebooklm, etc.) — PROTECTED
  | 'vscode'              // Code.exe + its helpers/extensions — PROTECTED
  | 'claude'              // claude / claude-code CLI processes — PROTECTED
  | 'iceberg-catalog'     // the AIStor Iceberg catalog (127.0.0.1:9100) — PROTECTED
  | 'orphan-tsx'          // stray `tsx`/`ts-node` watchers with no live parent
  | 'orphan-vite'         // stray vite dev servers, dashboard-shaped but detached
  | 'orphan-python-worker'// hardware_node.py / hpo trial workers whose parent died
  | 'unknown';            // unclassified — NEVER auto-reaped

export interface ClassifiedProc {
  pid: number;
  ppid: number;
  name: string;
  command: string;             // full command line (si: proc.command + params)
  ageMs: number;               // now - started
  cpu: number;                 // %
  memMB: number;
  category: ProcCategory;
  protected: boolean;          // true → never reapable
  reapable: boolean;           // orphan-* AND parent-dead AND age past grace
  reason: string;              // human-readable why-this-category (no "unknown" placeholder)
}

export interface ClassificationResult {
  total: number;
  byCategory: Record<ProcCategory, ClassifiedProc[]>;
  counts: Record<ProcCategory, number>;
  reapable: ClassifiedProc[];  // the exact set the reap button would target
  capturedAt: number;
}

// ── Protected roots: a process is protected if it (or an ancestor) matches. ──
const PROTECTED_MATCHERS: Array<{ cat: ProcCategory; test: (p: RawProc) => boolean }> = [
  { cat: 'vscode',       test: (p) => /(^|\\)Code\.exe$/i.test(p.name) || /vscode-server|\.vscode/i.test(p.command) },
  { cat: 'claude',       test: (p) => /claude(\.exe)?$/i.test(p.name) || /claude-code|@anthropic-ai[\\/]claude/i.test(p.command) },
  { cat: 'iceberg-catalog', test: (p) => /aistor|minio/i.test(p.command) },
  { cat: 'mcp-server',   test: (p) => /(notebooklm-mcp|modelcontextprotocol|mcp-server|uvx)/i.test(p.command) },
];

// The dashboard's own process subtree — captured at boot so we never reap self.
// process.pid is this server; walk children to tag the whole tree as 'dashboard'.
const SELF_PID = process.pid;

// Grace + age heuristics.
const ORPHAN_GRACE_MS = 60_000;     // a just-detached child gets 60s before reapable
const REAP_MIN_AGE_MS = 5 * 60_000; // and must be ≥5 min old overall (avoid startup races)

interface RawProc {
  pid: number; ppid: number; name: string; command: string;
  started: number; cpu: number; memMB: number;
}

export async function classifyProcesses(): Promise<ClassificationResult> {
  const data = await si.processes();     // { list: ProcessesProcessData[] }
  const now = Date.now();

  const raw: RawProc[] = data.list.map((p) => ({
    pid: p.pid,
    ppid: p.parentPid,
    name: p.name,
    command: `${p.command} ${p.params ?? ''}`.trim(),
    started: parseStarted(p.started),          // si 'started' → epoch ms
    cpu: p.cpu ?? 0,
    memMB: (p.memRss ?? 0) / 1024,             // memRss is KB
  }));

  const byPid = new Map<number, RawProc>();
  raw.forEach((p) => byPid.set(p.pid, p));
  const livePids = new Set(byPid.keys());

  // Tag the dashboard's own subtree (SELF_PID + descendants) up front.
  const selfTree = collectSubtree(SELF_PID, raw);

  const classified: ClassifiedProc[] = raw.map((p) => classifyOne(p, {
    now, byPid, livePids, selfTree,
  }));

  // Bucket + count + reapable set.
  const byCategory = emptyBuckets();
  for (const c of classified) byCategory[c.category].push(c);
  const counts = mapValues(byCategory, (arr) => arr.length);
  const reapable = classified.filter((c) => c.reapable);

  return { total: classified.length, byCategory, counts, reapable, capturedAt: now };
}

function classifyOne(p: RawProc, ctx: ClassifyCtx): ClassifiedProc {
  const ageMs = ctx.now - p.started;
  const base = { pid: p.pid, ppid: p.ppid, name: p.name, command: p.command,
                 ageMs, cpu: p.cpu, memMB: p.memMB };

  // 1. Dashboard's own tree — protected, never reapable.
  if (ctx.selfTree.has(p.pid))
    return { ...base, category: 'dashboard', protected: true, reapable: false,
             reason: 'part of the running dashboard process tree (self)' };

  // 2. Protected matchers (vscode/claude/iceberg-catalog/mcp-server).
  for (const m of PROTECTED_MATCHERS) {
    if (m.test(p))
      return { ...base, category: m.cat, protected: true, reapable: false,
               reason: `matched protected root: ${m.cat}` };
  }

  // 3. Orphan detection: dashboard-shaped process whose parent is dead OR is
  //    PID 1/0 (reparented) AND past the grace + min-age windows.
  const parentDead = !ctx.livePids.has(p.ppid) || p.ppid <= 1;
  const oldEnough = ageMs >= REAP_MIN_AGE_MS;
  const pastGrace = ageMs >= ORPHAN_GRACE_MS;

  const shape = detectOrphanShape(p);      // → 'orphan-tsx' | 'orphan-vite' | 'orphan-python-worker' | null
  if (shape) {
    const reapable = parentDead && oldEnough && pastGrace;
    return { ...base, category: shape, protected: false, reapable,
             reason: reapable
               ? `${shape}: parent ${p.ppid} not alive, age ${(ageMs/1000)|0}s`
               : `${shape}: parent alive or within grace — kept` };
  }

  // 4. Everything else — explicitly 'unknown', NEVER reapable. We record WHY
  //    it didn't match rather than leaving a bare placeholder.
  return { ...base, category: 'unknown', protected: false, reapable: false,
           reason: `no protected/orphan matcher hit (name=${p.name})` };
}

// Orphan shape by command fingerprint — tightened to THIS repo's dev processes.
function detectOrphanShape(p: RawProc): ProcCategory | null {
  const c = p.command.toLowerCase();
  if (/\btsx\b|ts-node/.test(c) && /ml_dashboard/.test(c)) return 'orphan-tsx';
  if (/\bvite\b/.test(c)       && /ml_dashboard/.test(c)) return 'orphan-vite';
  if (/python(\.exe)?/.test(c) && /(hardware_node|hpo_runner|train_.*\.py)/.test(c)) return 'orphan-python-worker';
  return null;
}

// collectSubtree: BFS over ppid links from a root pid.
function collectSubtree(rootPid: number, raw: RawProc[]): Set<number> {
  const childrenOf = new Map<number, number[]>();
  for (const p of raw) (childrenOf.get(p.ppid) ?? childrenOf.set(p.ppid, []).get(p.ppid)!).push(p.pid);
  const out = new Set<number>([rootPid]);
  const stack = [rootPid];
  while (stack.length) for (const child of childrenOf.get(stack.pop()!) ?? []) {
    if (!out.has(child)) { out.add(child); stack.push(child); }
  }
  return out;
}
```

This is wrapped by two capabilities (registered in `machine/capabilities.ts`):

```ts
export const procClassify = defineCapability({
  id: 'proc.classify', domain: 'machine', kind: 'read', risk: 'safe',
  title: 'Classify processes', description:
    'List every OS process bucketed into {dashboard, mcp-server, vscode, claude, '
    + 'iceberg-catalog, orphan-tsx, orphan-vite, orphan-python-worker, unknown}, '
    + 'flagging which are safe to reap. Read-only.',
  args: z.object({}).strict(),
  execute: async () => classifyProcesses(),
});

export const procReap = defineCapability({
  id: 'proc.reap', domain: 'machine', kind: 'write', risk: 'dangerous',
  title: 'Reap orphan processes', description:
    'Kill a specific set of orphaned processes by PID. Only PIDs the classifier '
    + 'marked reapable=true are accepted; protected categories are rejected.',
  args: z.object({ pids: z.array(z.number().int().positive()).min(1) }).strict(),
  // dangerous → preview() is mandatory (enforced by defineCapability).
  preview: async ({ pids }) => {
    const { reapable } = await classifyProcesses();
    const set = new Set(reapable.map((r) => r.pid));
    const affected = pids.filter((p) => set.has(p));
    return { summary: `Reap ${affected.length} orphan process(es)`,
             affected: affected.map((pid) => ({ kind: 'pid', id: pid,
               label: reapable.find((r) => r.pid === pid)!.command.slice(0, 80) })),
             reversible: false };
  },
  execute: async ({ pids }) => {
    const { reapable } = await classifyProcesses();      // RE-CLASSIFY at execute time
    const allowed = new Set(reapable.map((r) => r.pid)); // TOCTOU guard — fresh set
    const killed: number[] = [], refused: number[] = [];
    for (const pid of pids) {
      if (!allowed.has(pid)) { refused.push(pid); continue; }   // never kill non-reapable
      try { process.kill(pid, 'SIGTERM'); killed.push(pid); } catch { refused.push(pid); }
    }
    return { killed, refused };
  },
});
```

**Takeaway:** `unknown` and every protected category are hard-excluded from
reaping, and `proc.reap` re-classifies at execute time (not trusting the PID list
the human clicked, which may be stale) — so the blast radius is only ever
genuinely-orphaned dev processes, never VS Code, Claude, the Iceberg catalog, or the
dashboard itself.

---

## 7. `ProcessTile.tsx` (client) — live counts, reap-with-confirm

Mirrors `useAgentDispatch`'s shape: an EventSource kept in a `ref`, `startTransition`
for high-frequency updates, imperative POST for the write. `useControlStream` is
the generic SSE hook; `ProcessTile` composes it with a TanStack mutation.

```tsx
// control/lib/useControlStream.ts — generic control-channel SSE subscriber.
export function useControlStream<T = unknown>(eventType: `control.${string}`): {
  last: T | null; connected: boolean;
} {
  const [last, setLast] = useState<T | null>(null);
  const [connected, setConnected] = useState(false);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const es = new EventSource('/api/events/control');     // the new 'control' channel (§0)
    esRef.current = es;
    es.addEventListener('connected', () => setConnected(true));
    es.addEventListener(eventType, (raw: MessageEvent) => {
      try { startTransition(() => setLast(JSON.parse(raw.data).data as T)); }
      catch (err) { logWarn('useControlStream', 'bad payload', { message: (err as Error).message }); }
    });
    es.onerror = () => { if (es.readyState === EventSource.CLOSED) setConnected(false); };
    return () => { es.close(); esRef.current = null; };
  }, [eventType]);

  return { last, connected };
}
```

```tsx
// control/lib/useHumanToken.ts — reads the session token minted at terminal auth.
export function useHumanToken(): string | null {
  // Stored in-memory (module singleton) after the operator authenticates the
  // terminal; NOT in localStorage. Agents run server-side and never see this.
  return getControlSession()?.token ?? null;
}
```

```tsx
// control/ProcessTile.tsx
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useControlStream } from './lib/useControlStream';
import { useHumanToken } from './lib/useHumanToken';
import type { ClassificationResult, ClassifiedProc } from '@shared/control-types';

const CATEGORY_LABEL: Record<string, string> = {
  dashboard: 'Dashboard', 'mcp-server': 'MCP servers', vscode: 'VS Code',
  claude: 'Claude', 'iceberg-catalog': 'Iceberg catalog', 'orphan-tsx': 'Orphan tsx',
  'orphan-vite': 'Orphan vite', 'orphan-python-worker': 'Orphan py worker', unknown: 'Unknown',
};
// Deuteranopia-safe: attention/orphan = orange #E69F00, protected/settled = blue #0072B2,
// reinforced with a lock icon (protected) vs a skull icon (reapable). NEVER red/green.

export function ProcessTile() {
  const qc = useQueryClient();
  const token = useHumanToken();

  // Baseline snapshot via the read capability (GET is headless-safe).
  const { data, refetch } = useQuery<ClassificationResult>({
    queryKey: ['control', 'proc.classify'],
    queryFn: () => fetch('/api/control/cap/proc.classify').then((r) => r.json()),
    refetchInterval: 15_000,
  });

  // Live counts via SSE — the server emits control.telemetry on its host-sampler
  // tick (same cadence as telemetry.router's hardware node). Merged over baseline.
  const { last: telemetry } = useControlStream<{
    procTotal: number; byCategory: Record<string, number>; reapableCount: number;
  }>('control.telemetry');

  // Refresh the proposal-driven view when a decision lands.
  useControlStream('control.proposal.decided');   // side-effect: could invalidate query

  const [confirmOpen, setConfirmOpen] = useState(false);
  const reapable: ClassifiedProc[] = data?.reapable ?? [];

  // The write — POST with the human token. Refused (401) if token missing.
  const reap = useMutation({
    mutationFn: async (pids: number[]) => {
      const res = await fetch('/api/control/cap/proc.reap', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   'x-control-human-token': token ?? '' },   // agents have no such header
        body: JSON.stringify({ args: { pids }, confirmDangerous: true }),  // dangerous → confirm
      });
      if (res.status === 428) throw new Error('confirm required');
      if (!res.ok) throw new Error(await res.text());
      return res.json() as Promise<{ status: 'ran'; result: { killed: number[]; refused: number[] } }>;
    },
    onSuccess: () => { setConfirmOpen(false); refetch(); qc.invalidateQueries({ queryKey: ['control'] }); },
  });

  const total = telemetry?.procTotal ?? data?.total ?? 0;
  const counts = telemetry?.byCategory ?? data?.counts ?? {};

  return (
    <section aria-label="Processes">
      <header>
        <h3>Processes</h3><span>{total} total · {reapable.length} reapable</span>
      </header>

      {/* Categorized list — icon + label + count, color reinforced by shape. */}
      <ul>
        {Object.entries(counts).map(([cat, n]) => (
          <li key={cat} data-protected={String(cat.startsWith('orphan') === false)}>
            <Icon name={cat.startsWith('orphan') ? 'skull' : 'lock'} />
            {CATEGORY_LABEL[cat] ?? cat}: {n}
          </li>
        ))}
      </ul>

      <button disabled={reapable.length === 0 || !token} onClick={() => setConfirmOpen(true)}>
        Reap {reapable.length} orphan{reapable.length === 1 ? '' : 's'}
      </button>
      {!token && <p role="note">Authenticate the terminal to enable writes.</p>}

      {/* Confirm dialog — shows EXACTLY which PIDs will die before any POST. */}
      {confirmOpen && (
        <ConfirmDialog
          title="Reap these processes?"
          danger
          onCancel={() => setConfirmOpen(false)}
          onConfirm={() => reap.mutate(reapable.map((r) => r.pid))}
          busy={reap.isPending}
        >
          <p>{reapable.length} process(es) will be sent SIGTERM. This cannot be undone.</p>
          <table>
            <thead><tr><th>PID</th><th>Category</th><th>Age</th><th>Command</th></tr></thead>
            <tbody>
              {reapable.map((p) => (
                <tr key={p.pid}>
                  <td>{p.pid}</td><td>{CATEGORY_LABEL[p.category]}</td>
                  <td>{Math.round(p.ageMs / 1000)}s</td>
                  <td title={p.command}>{p.command.slice(0, 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {reap.error && <p role="alert">{(reap.error as Error).message}</p>}
        </ConfirmDialog>
      )}
    </section>
  );
}
```

**Takeaway:** the tile can never reap silently — the confirm dialog enumerates
the exact PIDs, categories, and commands the server will target, the button is
disabled without a human token, and the POST carries `confirmDangerous:true` so
the server-side `dangerous` gate is satisfied only by a deliberate human click.
Live counts stream over the `control` SSE channel exactly like `useAgentDispatch`
streams token chunks, so the tile stays current without polling churn.

---

## Cross-module wiring summary

| Concern | Owner | Never touched by |
|---|---|---|
| `cap.execute()` for a write | `registry.executeAsHuman` only | agent tools, headless routes |
| Turning an agent write into a proposal | `registry.executeAsAgent` (write branch) | anything else |
| Human-token verification | `humanSession.verifyHumanToken` | agents (no token) |
| Proposal state machine | `proposalLifecycle` | registry (just inserts `pending`) |
| Agent-run back-notification | `agentDispatcher.emitIntoAgentRun` → `emitBus` | lifecycle re-implements nothing |
| Process safety classification | `orphanClassifier.classifyProcesses` (re-run at execute) | the clicked PID list (untrusted) |
| Route generation | `control.router` iterating `registry.list()` | per-capability hand-written routes |

Everything converges on the single write-gate. Adding a capability = one
`defineCapability` + `registry.register` call; it automatically gets a read GET
or a human-guarded write POST, an SDK tool (read-runs / write-proposes), and — if
it's a write — full proposal lifecycle, audit, and back-notification, with zero
new plumbing.
