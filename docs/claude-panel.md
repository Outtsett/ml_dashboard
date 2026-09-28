# Claude Code in the dashboard

A panel on every page (top-bar **Claude** button, Ctrl+Shift+K) holding real
Claude Code sessions in this repository, driven by the Claude Agent SDK
(0.2.138) with the logged-in CLI's credentials.

## Pieces

| | |
|---|---|
| `src/server/claude/host.ts` | The **Claude host** sidecar (port 17191, proxied at `/api/claude`). A sidecar so a session that edits server files does not restart the process it runs in (`tsx --watch`). |
| `src/server/claude/session.ts` | One conversation: a single SDK `query()` fed by a streaming input queue; events into a ring of 4,000; `canUseTool` parks each approval as a `permission_request` until the browser answers. |
| `src/server/claude/tools.ts` | In-process MCP server `dashboard`: `open_dashboard_page`, `dashboard_context`, `dashboard_api_get` (GET under `/api/` only), `live_quotes`, `news_sentiment`. |
| `src/client/src/claude/` | Panel, transcript, permission cards, session picker, mode and model pickers. |
| `src/shared/claude/types.ts` | The event contract. |

Sessions list every Claude Code session for this repo (terminal ones too) and
resume any of them. Settings sources are user, project and local, so the panel
behaves as the terminal CLI does: **Ask** mode asks about the calls Claude Code
would ask about; tools your settings already allow run without a card.

## Security model (review of 2026-09-28)

- **Loopback only.** The host refuses any request whose Host is not
  127.0.0.1/localhost/[::1] on its port, any Origin that is not loopback, and
  `Sec-Fetch-Site: cross-site`. The dashboard's proxy refuses a non-loopback
  Host on every sidecar prefix before forwarding (a DNS-rebinding page reaches
  :5000 under its own name). Measured: forged Host → 403 on :17191 and on
  :5000; cross-site Origin POST → 403; the panel's own requests → 200.
- **"Always allow" is shown and session-scoped.** The card lists exactly what
  it adds (`Bash(npm test:*)`, a directory, a mode) and the host applies it with
  destination `session`, never a settings file; a suggested mode change moves
  the session's mode with it.
- **Settings are validated** (`permissionMode` one of the six modes; model an id).
- **Images in model output render as links**, never fetched on render.
- **Idle and abandoned sessions end.** The idle clock re-arms while a tab
  watches; with nobody watching, pending approvals are denied and the child
  closed after 30 minutes; closed, unwatched sessions are evicted (their
  transcripts stay on disk); at most 40 live sessions.
- **Reconnect reloads history**, so a host restart does not strand the panel
  below a stale event number.
- The child environment drops the parent Claude Code session's variables
  (`childEnvironment()`), so a dashboard started from a Claude session does not
  make the panel a nested sub-session.

## ML Studio advisors (`src/server/infrastructure/lib/agentDispatcher.ts`)

The four Ask-agent advisors run unattended (`dontAsk`) with Read, Glob, Grep and
WebSearch only; WebFetch, Bash, Write, Edit and NotebookEdit are disallowed, and
Read is denied on the credential stores (`dotfiles/**`, `**/secrets/**`,
`**/.env`, `**/*.env`, `**/.credentials.json`, `~/.claude/**`). No setting
sources, so the project's Stop hook does not run inside an advisor. A timed-out
advisor's child is aborted.
