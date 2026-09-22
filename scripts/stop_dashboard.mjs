/**
 * Stop the dashboard by killing the TOP of its process tree, not the leaf.
 *
 * Killing whatever holds port 5000 is the obvious move and the wrong one: the
 * watch supervisor above it survives, so you are left with an orphan that holds
 * ~40 MB, never serves anything, and may fight the next launch for the port.
 * Three of those had stacked up before this script existed.
 *
 * This finds every process whose command line runs src/server/main.ts, walks up
 * to the highest such ancestor, and tree-kills from there.
 */
import { execFileSync } from "node:child_process";

const SERVER_ENTRY = "src/server/main.ts";

/** Every running process as {processIdentifier, parentProcessIdentifier, commandLine}. */
function readProcessTable() {
  const _csv = execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,CommandLine | ConvertTo-Json -Compress",
    ],
    { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(_csv).map((_row) => ({
    processIdentifier: _row.ProcessId,
    parentProcessIdentifier: _row.ParentProcessId,
    commandLine: _row.CommandLine ?? "",
  }));
}

function main() {
  const _table = readProcessTable();
  const _byIdentifier = new Map(
    _table.map((_row) => [_row.processIdentifier, _row]),
  );

  const _dashboardIdentifiers = new Set(
    _table
      .filter((_row) => _row.commandLine.includes(SERVER_ENTRY))
      .map((_row) => _row.processIdentifier),
  );

  if (_dashboardIdentifiers.size === 0) {
    console.log("dashboard is not running; nothing to stop");
    return;
  }

  // Climb to the highest ancestor that is still part of this dashboard launch.
  const _roots = new Set();
  for (const _identifier of _dashboardIdentifiers) {
    let _current = _identifier;
    let _guard = 0;
    while (_guard < 25) {
      const _parent = _byIdentifier.get(
        _byIdentifier.get(_current)?.parentProcessIdentifier,
      );
      if (!_parent) break;
      const _parentIsOurs =
        _dashboardIdentifiers.has(_parent.processIdentifier) ||
        _parent.commandLine.includes("npm-cli.js") ||
        _parent.commandLine.includes("cross-env") ||
        _parent.commandLine.includes("tsx/dist/cli.mjs") ||
        _parent.commandLine.includes("tsx\\dist\\cli.mjs");
      if (!_parentIsOurs) break;
      _current = _parent.processIdentifier;
      _guard += 1;
    }
    _roots.add(_current);
  }

  for (const _root of _roots) {
    try {
      execFileSync("taskkill", ["/PID", String(_root), "/T", "/F"], {
        stdio: "pipe",
      });
      console.log(`stopped process tree rooted at ${_root}`);
    } catch {
      console.log(`process tree ${_root} was already gone`);
    }
  }

  const _remaining = readProcessTable().filter((_row) =>
    _row.commandLine.includes(SERVER_ENTRY),
  );
  console.log(
    _remaining.length === 0
      ? "all dashboard processes stopped"
      : `WARNING: ${_remaining.length} dashboard process(es) still alive: ` +
          _remaining.map((_r) => _r.processIdentifier).join(", "),
  );
}

main();
