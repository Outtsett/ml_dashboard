#!/usr/bin/env node
/**
 * Consolidated dependency report — the no-bot alternative to per-package PRs.
 *
 * Emits one markdown document covering npm outdated + npm audit (and the Python
 * side when uv is on PATH). CI pipes it into a single rolling issue once a week;
 * locally you just run it. Nothing is upgraded and no branch is pushed — the
 * decision of what to take stays with a person.
 *
 * Why not a bot raising PRs: this repo pins `zod@3` against a peer that wants
 * `zod@4` and needs `--legacy-peer-deps` for every install, so per-package PRs
 * arrive un-mergeable and pile up. A report says the same thing in one place
 * without generating work.
 *
 * Usage:
 *   node scripts/dependency-report.mjs              # markdown to stdout
 *   node scripts/dependency-report.mjs --out r.md   # markdown to a file
 */

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const WIN = process.platform === "win32";

const argv = process.argv.slice(2);
const outIdx = argv.indexOf("--out");
const OUT = outIdx >= 0 ? argv[outIdx + 1] : null;

/** Run a command, never throw. Exit code and output are both data here. */
function run(cmd, args, { allowFail = true } = {}) {
  const res = spawnSync(cmd, args, {
    cwd: REPO_ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
    shell: WIN,
  });
  const ok = res.status === 0;
  if (!ok && !allowFail) {
    throw new Error(`${cmd} ${args.join(" ")} exited ${res.status}`);
  }
  return { ok, status: res.status, stdout: res.stdout ?? "", stderr: res.stderr ?? "" };
}

function parseJsonLoose(text) {
  if (!text || !text.trim()) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

const out = [];
const push = (s = "") => out.push(s);

push(`# Dependency report`);
push();
push(`Generated ${new Date().toISOString().slice(0, 10)} from the committed lockfiles. `);
push(`Nothing here has been changed — this is a read of current state.`);
push();

// ── npm: security advisories ────────────────────────────────────────
// Audit first: a vulnerability is a reason to move, an outdated minor usually is not.
push(`## npm — security advisories`);
push();
const audit = parseJsonLoose(run("npm", ["audit", "--json"]).stdout);
if (!audit) {
  push(`\`npm audit\` produced no parseable output.`);
} else if (audit.error) {
  push(`\`npm audit\` failed: ${audit.error.summary ?? "unknown"}`);
} else {
  const meta = audit.metadata?.vulnerabilities ?? {};
  const total = Object.values(meta).reduce((a, b) => a + (Number(b) || 0), 0);
  push(
    `**${total} advisory-affected package(s)** — ` +
      `critical ${meta.critical ?? 0}, high ${meta.high ?? 0}, ` +
      `moderate ${meta.moderate ?? 0}, low ${meta.low ?? 0}.`,
  );
  push();

  const vulns = Object.values(audit.vulnerabilities ?? {});
  const direct = vulns.filter((v) => v.isDirect);
  if (direct.length) {
    push(`### Direct dependencies (fix these first)`);
    push();
    push(`| Package | Severity | Fix available | Advisory |`);
    push(`| --- | --- | --- | --- |`);
    for (const v of direct.slice(0, 40)) {
      const via = (v.via ?? []).find((x) => typeof x === "object");
      const fix = v.fixAvailable === true ? "yes" : v.fixAvailable ? `${v.fixAvailable.name}@${v.fixAvailable.version}` : "no";
      const breaking = v.fixAvailable?.isSemVerMajor ? " (major)" : "";
      push(`| \`${v.name}\` | ${v.severity} | ${fix}${breaking} | ${via?.title ?? "—"} |`);
    }
    push();
  } else {
    push(`No **direct** dependency is affected; everything below is transitive.`);
    push();
  }

  const bySeverity = { critical: [], high: [] };
  for (const v of vulns) if (bySeverity[v.severity]) bySeverity[v.severity].push(v.name);
  for (const sev of ["critical", "high"]) {
    if (bySeverity[sev].length) {
      push(`<details><summary><b>${sev}</b> — ${bySeverity[sev].length} package(s)</summary>`);
      push();
      push(bySeverity[sev].sort().map((n) => `\`${n}\``).join(", "));
      push();
      push(`</details>`);
      push();
    }
  }
}

// ── npm: outdated ───────────────────────────────────────────────────
push(`## npm — outdated packages`);
push();
const outdated = parseJsonLoose(run("npm", ["outdated", "--json"]).stdout);
if (!outdated) {
  push(`Everything matches the declared ranges, or \`npm outdated\` produced no output.`);
  push();
} else {
  const rows = Object.entries(outdated);
  const major = [];
  const minorPatch = [];
  for (const [name, info] of rows) {
    const cur = info.current ?? "—";
    const wanted = info.wanted ?? "—";
    const latest = info.latest ?? "—";
    const curMajor = String(cur).split(".")[0];
    const latestMajor = String(latest).split(".")[0];
    const row = `| \`${name}\` | ${cur} | ${wanted} | ${latest} |`;
    (curMajor !== latestMajor ? major : minorPatch).push(row);
  }

  push(`${rows.length} package(s) behind latest.`);
  push();
  if (minorPatch.length) {
    push(`### Minor / patch — low risk`);
    push();
    push(`| Package | Current | Wanted | Latest |`);
    push(`| --- | --- | --- | --- |`);
    push(...minorPatch.slice(0, 60));
    push();
  }
  if (major.length) {
    push(`### Major — needs a decision`);
    push();
    push(`| Package | Current | Wanted | Latest |`);
    push(`| --- | --- | --- | --- |`);
    push(...major.slice(0, 60));
    push();
  }
}

// ── Python ──────────────────────────────────────────────────────────
push(`## Python — uv.lock`);
push();
const uvVersion = run("uv", ["--version"]);
if (!uvVersion.ok) {
  push(`\`uv\` is not on PATH here, so the Python side was not inspected.`);
  push();
} else {
  const check = run("uv", ["lock", "--check"]);
  push(
    check.ok
      ? `\`uv lock --check\`: **lock is in sync** with \`pyproject.toml\`.`
      : `\`uv lock --check\`: **lock has drifted** from \`pyproject.toml\` — run \`uv lock\`.`,
  );
  push();

  const stale = run("uv", ["pip", "list", "--outdated"]);
  if (stale.ok && stale.stdout.trim()) {
    push(`### Outdated (against the synced environment)`);
    push();
    push("```");
    push(stale.stdout.trim().slice(0, 20000));
    push("```");
    push();
  } else {
    push(`No outdated report available (needs a synced environment: \`uv sync --frozen\`).`);
    push();
  }
}

push(`---`);
push();
push(
  `<sub>Produced by \`scripts/dependency-report.mjs\`. ` +
    `Reruns overwrite this issue rather than opening a new one. ` +
    `Vulnerability *gating* lives in \`.github/workflows/osv-scanner.yml\`, which fails the build; ` +
    `this report is advisory.</sub>`,
);

const markdown = out.join("\n") + "\n";
if (OUT) {
  writeFileSync(path.resolve(REPO_ROOT, OUT), markdown, "utf8");
  console.error(`dependency-report: wrote ${OUT} (${markdown.length} bytes)`);
} else {
  process.stdout.write(markdown);
}
