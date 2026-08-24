# Contributing

> **License notice.** This repository is published under a Source-Available
> View-Only License (see `LICENSE`). External contributions are not solicited
> and, by default, cannot be accepted: the license prohibits modification and
> derivative works. Pull requests opened without prior written permission from
> the copyright holder will be closed without review. The rest of this
> document describes the internal contribution workflow used by the
> repository owner and any explicitly-authorized collaborators.

## Branch model

| Branch | Purpose | Protection |
|---|---|---|
| `main` | Stable shipping branch. Deployable at any time. | Protected. |
| `feature/*` | Active feature work. | Unprotected. |
| `fix/*` | Bug fixes. | Unprotected. |
| `chore/*` | Tooling, CI, dep bumps, refactors that don't change behavior. | Unprotected. |

Direct pushes to `main` are blocked — every change lands via PR.

## Required server-side branch protection (apply once)

The following rules are configured via **Settings → Branches → Add rule** for
`main`. Apply them once on a fresh repo or after a recovery push.

**Rule pattern:** `main`

- **Require a pull request before merging:** ✓
  - **Require approvals:** ≥ 1
  - **Dismiss stale pull request approvals when new commits are pushed:** ✓
  - **Require review from Code Owners:** ✓ (uses `.github/CODEOWNERS`)
- **Require status checks to pass before merging:** ✓
  - **Require branches to be up to date before merging:** ✓
  - **Required status checks** (exact names — these match jobs in
    `.github/workflows/ci.yml` and the security workflows):
    - `CI Success` *(aggregate gate — passes only if Lint TS, Lint PY, Type Check, Unit Tests, Build all pass)*
    - `Analyze (javascript-typescript)` *(CodeQL)*
    - `Analyze (python)` *(CodeQL)*
    - `Review dependency changes`
    - `Gitleaks`
- **Require conversation resolution before merging:** ✓
- **Require signed commits:** ✓ (recommended; configure SSH/GPG signing key)
- **Require linear history:** ✓ (squash-merge or rebase-merge only)
- **Require deployments to succeed before merging:** N/A (no deployment env)
- **Lock branch:** ✗
- **Do not allow bypassing the above settings:** ✓
- **Restrict who can push to matching branches:** ✓ — repo owner only

**Force-push policy:** Force-push is **disabled** on `main` for everyone.
Force-push to `feature/*`, `fix/*`, `chore/*` is allowed for the branch
owner only.

## Commit messages

This repo enforces **Conventional Commits** via the `commit-msg` husky hook.
Subject line must match `<type>(<scope>): <description>`.

Allowed types:
`feat` `fix` `docs` `chore` `refactor` `perf` `test` `build` `ci` `style` `revert`

Examples:

```
feat(cache): add LRU eviction to anchor cache
fix(sse): disable Brotli on event-stream responses
chore(repo): add CODEOWNERS and branch-protection docs
ci: pin GitHub Actions to v4 and add CodeQL
```

## Local quality gates

Husky runs three hooks. None are skippable in normal workflow — use
`--no-verify` only when investigating a hook bug, never to push known-bad
code.

| Hook | Tool | What it does |
|---|---|---|
| `pre-commit` | `lint-staged` | Runs `eslint --fix` on staged `.ts`/`.tsx` and `ruff check --fix` on staged `.py`. |
| `commit-msg` | grep | Validates Conventional Commits format on the subject line. |
| `pre-push` | `tsc --noEmit` | Full TypeScript type check across the project. |

## CI / CD

Every push and PR runs the full pipeline. See `.github/workflows/`.

| Workflow | Trigger | What runs |
|---|---|---|
| `ci.yml` | push, pull_request, manual | Lint TS, Lint PY, Type Check, Unit Tests (Ubuntu + Windows matrix, with coverage), Build, aggregate `CI Success` check. |
| `codeql.yml` | push, pull_request, weekly cron | CodeQL static analysis for JavaScript/TypeScript and Python (`security-extended` + `security-and-quality` query packs). |
| `dependency-review.yml` | pull_request | Blocks PRs that introduce dependencies with `moderate`+ severity vulnerabilities or copyleft licenses incompatible with this repo's license. |
| `secret-scan.yml` | push, pull_request, weekly cron, manual | gitleaks scan of working tree (and full history on schedule). |
| `pr-label.yml` | pull_request | Auto-applies labels by changed-file path (`server`, `client`, `ml`, etc.). |

The `CI Success` job in `ci.yml` is the only required check needed for branch
protection — it aggregates the result of every required job, so adding /
removing pipeline steps doesn't require updating branch protection rules.

### Concurrency

Every workflow uses `concurrency: group: <workflow>-${{ github.ref }}` with
`cancel-in-progress: true`. Pushing a new commit cancels the previous run for
the same ref to keep CI minutes low.

### Permissions

All workflows declare `permissions: contents: read` at the top level and
elevate per-job only where needed (e.g. CodeQL needs `security-events: write`,
labeler needs `pull-requests: write`). This follows the GitHub-recommended
least-privilege model.

### Action pinning

Action versions are pinned to **major** tags (`@v4`, `@v5`). Dependabot is
configured (`.github/dependabot.yml`) to open PRs for both feature and security
updates weekly. Security updates land immediately regardless of the schedule.

For pinning to **commit SHA** (a stricter supply-chain posture than tags),
flip Dependabot's strategy by changing each action reference from
`actions/checkout@v4` to `actions/checkout@<full-sha> # v4.2.2` and setting
`versioning-strategy: increase` to `auto`. Dependabot will then keep the SHAs
current. The repo currently uses tag-pinning + Dependabot since SHA-pinning
without automated updates is *worse* than tag-pinning (security patches stop
flowing).

## Dependabot

`.github/dependabot.yml` covers:

- **npm** (root) — weekly Mondays 09:00 America/Chicago, grouped by
  production / development / security.
- **pip** (root) — weekly Mondays, grouped by minor/patch + security.
- **pip** (`mcp_server/`) — weekly Mondays.
- **github-actions** (`.github/workflows/`) — weekly Mondays, grouped.

Group + label conventions keep the PR firehose manageable. Security updates
bypass schedule and group.

## Releases

This repository **does not** publish releases. The license prohibits
redistribution, so semantic-versioned tags or release artifacts are not
produced. Internal version tracking lives in `package.json:version`.

If the license is ever changed to permit redistribution, the recommended
release flow is:

1. `npm version <patch|minor|major>` to bump and tag.
2. `git push origin main --follow-tags`.
3. A `release.yml` workflow (not yet present) would generate a changelog from
   Conventional Commits via `release-please` and publish.

## Reporting security issues

See `SECURITY.md`.
