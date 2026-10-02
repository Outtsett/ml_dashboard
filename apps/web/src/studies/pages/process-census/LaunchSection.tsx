/**
 * What each launch strategy would cost: N_total = C x (L + R) + 2M + P, with
 * every symbol defined and carrying its current value, the expanded terms, a
 * bar per launch mode at the chosen C, M and P, and the C, L, M and P this
 * snapshot actually shows.
 */

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  AXIS, ControlBar, Finding, FormulaCard, GRID, OKABE, Section, SelectControl, SliderControl, Stat, TOOLTIP, fmt, fmtInt,
} from "@/studies/kit";
import {
  LAUNCH_MODES, RUNTIME_PER_CHAIN, launchCost, measuredCensus, type LaunchCost, type ProcessRow,
} from "@shared/studies/process-census";
import { HatchPattern, Swatch } from "./hatch";

export interface LaunchControls {
  launchMode: string;
  chains: number;
  mcpServers: number;
  children: number;
}

const SHORT_LABELS: Record<string, string> = {
  npm_run_dev: "npm run dev",
  dev_lean: "npm run dev:lean",
  direct_watch: "node --watch (direct)",
  direct_no_watch: "node (direct, no watch)",
};

const FORMULA = String.raw`N_{\text{total}} \;=\; C \times \bigl(L + R\bigr) \;+\; 2M \;+\; P`;
const MAXIMUM_CHAINS = 6;
const MAXIMUM_MCP_SERVERS = 20;
const MAXIMUM_CHILDREN = 10;

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function LaunchSection({
  controls, onChange, rows,
}: {
  controls: LaunchControls;
  onChange: (patch: Partial<LaunchControls>) => void;
  rows: readonly ProcessRow[];
}) {
  const mode = LAUNCH_MODES.find((candidate) => candidate.key === controls.launchMode) ?? LAUNCH_MODES[0]!;
  const input = { chains: controls.chains, mcpServers: controls.mcpServers, children: controls.children };
  const cost = launchCost({ ...input, launchersPerChain: mode.launchersPerChain });
  const measured = measuredCensus(rows);

  const comparison = LAUNCH_MODES.map((candidate) => {
    const modeCost: LaunchCost = launchCost({ ...input, launchersPerChain: candidate.launchersPerChain });
    return {
      key: candidate.key,
      label: `${candidate.key === mode.key ? "▶ " : ""}${SHORT_LABELS[candidate.key] ?? candidate.key} (L=${candidate.launchersPerChain})`,
      dashboardLaunchers: modeCost.dashboardLaunchers,
      dashboardRuntime: modeCost.dashboardRuntime,
      mcpLaunchers: controls.mcpServers,
      mcpServers: controls.mcpServers,
      children: modeCost.children,
      total: modeCost.total,
      selected: candidate.key === mode.key,
    };
  });

  const useMeasured = () => {
    const launchers = measured.launchersPerChain;
    const exact = launchers === null ? undefined : LAUNCH_MODES.find((candidate) => candidate.launchersPerChain === Math.round(launchers));
    onChange({
      ...(measured.chains > 0 ? { chains: clamp(measured.chains, 1, MAXIMUM_CHAINS) } : {}),
      mcpServers: clamp(measured.mcpServers, 0, MAXIMUM_MCP_SERVERS),
      children: clamp(measured.children, 0, MAXIMUM_CHILDREN),
      ...(exact ? { launchMode: exact.key } : {}),
    });
  };

  return (
    <Section title="What each launch strategy would cost" question="A chain is the launcher processes above an app plus the app; every MCP server adds its npx launcher beside it.">
      <div className="space-y-3">
        <ControlBar>
          <SelectControl
            label="Launch mode, which sets L"
            value={mode.key}
            options={LAUNCH_MODES.map((candidate) => ({ value: candidate.key, label: candidate.label }))}
            onChange={(value) => onChange({ launchMode: value })}
            hint="The notebook's radio: how many idle launchers sit above the app"
          />
          <SliderControl label="C: dev-server chains running" value={controls.chains} min={1} max={MAXIMUM_CHAINS} onChange={(value) => onChange({ chains: value })} />
          <SliderControl label="M: MCP servers connected" value={controls.mcpServers} min={0} max={MAXIMUM_MCP_SERVERS} onChange={(value) => onChange({ mcpServers: value })} />
          <SliderControl label="P: python and esbuild children" value={controls.children} min={0} max={MAXIMUM_CHILDREN} onChange={(value) => onChange({ children: value })} />
          <button
            type="button"
            onClick={useMeasured}
            disabled={rows.length === 0}
            className="rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:border-neutral-500 hover:text-neutral-100 disabled:opacity-40"
            title="Set C, L, M and P to what the snapshot above shows"
          >
            Use this snapshot&apos;s C, L, M, P
          </button>
        </ControlBar>

        <div className="grid gap-3 xl:grid-cols-2">
          <FormulaCard
            tex={FORMULA}
            caption="The factor 2 on M is not a fudge: every npx -y <server> costs an npx-cli.js launcher that stays resident, plus the server it launches."
            symbols={[
              { tex: "N_{\\text{total}}", name: "total node processes: what Task Manager shows (computed here)", value: `${fmtInt(cost.total)} processes` },
              { tex: "C", name: "chain count: dev servers running at once (slider)", value: `${controls.chains} chain${controls.chains === 1 ? "" : "s"}` },
              { tex: "L", name: "launcher processes per chain: the idle wrappers above the app (set by launch mode)", value: `${mode.launchersPerChain} per chain` },
              { tex: "R", name: "runtime processes per chain: the ones that actually serve (fixed)", value: `${RUNTIME_PER_CHAIN} per chain` },
              { tex: "M", name: "model context protocol server count: Claude Code connectors (slider)", value: `${controls.mcpServers} servers` },
              { tex: "P", name: "python and esbuild children: hardware node, esbuild service (slider)", value: `${controls.children} children` },
            ]}
          />

          <div className="min-w-0 space-y-2">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="text-left text-neutral-500">
                  <th className="py-0.5 font-normal">term</th>
                  <th className="py-0.5 font-normal">expands to</th>
                  <th className="py-0.5 text-right font-normal">value</th>
                </tr>
              </thead>
              <tbody className="font-mono tnum text-neutral-200">
                <tr className="border-t border-neutral-900">
                  <td className="py-0.5">C × (L + R)</td>
                  <td>{controls.chains} × ({mode.launchersPerChain} + {RUNTIME_PER_CHAIN})</td>
                  <td className="text-right">{cost.dashboardTotal}</td>
                </tr>
                <tr className="border-t border-neutral-900">
                  <td className="py-0.5">2M</td>
                  <td>2 × {controls.mcpServers}</td>
                  <td className="text-right">{cost.mcpTotal}</td>
                </tr>
                <tr className="border-t border-neutral-900">
                  <td className="py-0.5">P</td>
                  <td>—</td>
                  <td className="text-right">{cost.children}</td>
                </tr>
                <tr className="border-t border-neutral-700 font-semibold">
                  <td className="py-0.5">total</td>
                  <td />
                  <td className="text-right">{cost.total}</td>
                </tr>
              </tbody>
            </table>
            <Finding>
              {cost.total} node processes. Of the {cost.dashboardTotal} dashboard processes, <strong>{cost.dashboardRuntime}</strong> {cost.dashboardRuntime === 1 ? "does" : "do"} work and{" "}
              <strong>{cost.dashboardLaunchers}</strong> sit idle as wrappers. Against the npm run dev baseline with one chain: <strong>{cost.deltaFromBaseline >= 0 ? "+" : ""}{cost.deltaFromBaseline}</strong> processes.
            </Finding>
          </div>
        </div>

        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[11px] font-medium text-neutral-200">Every launch mode at C = {controls.chains}, M = {controls.mcpServers}, P = {controls.children}</span>
            <Swatch color={OKABE.sky} hatched label="dashboard launchers" />
            <Swatch color={OKABE.orange} hatched={false} label="dashboard runtime" />
            <Swatch color={OKABE.purple} hatched label="MCP launchers" />
            <Swatch color={OKABE.purple} hatched={false} label="MCP servers" />
            <Swatch color={OKABE.yellow} hatched={false} label="python and esbuild" />
          </div>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={comparison} layout="vertical" margin={{ top: 4, right: 40, left: 4, bottom: 4 }}>
              <HatchPattern id="launch-dashboard-hatch" color={OKABE.sky} />
              <HatchPattern id="launch-mcp-hatch" color={OKABE.purple} />
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" allowDecimals={false} {...AXIS} />
              <YAxis type="category" dataKey="label" width={170} {...AXIS} interval={0} />
              <Tooltip
                {...TOOLTIP}
                content={({ payload }) => {
                  const row = payload?.[0]?.payload as (typeof comparison)[number] | undefined;
                  if (!row) return null;
                  return (
                    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
                      <div className="font-semibold">{row.label}</div>
                      <div>▨ dashboard launchers {row.dashboardLaunchers}</div>
                      <div>■ dashboard runtime {row.dashboardRuntime}</div>
                      <div>▨ MCP launchers {row.mcpLaunchers}</div>
                      <div>■ MCP servers {row.mcpServers}</div>
                      <div>■ python and esbuild {row.children}</div>
                      <div className="font-semibold">total {row.total}</div>
                    </div>
                  );
                }}
              />
              <Bar dataKey="dashboardLaunchers" stackId="n" fill="url(#launch-dashboard-hatch)" stroke={OKABE.sky} isAnimationActive={false} />
              <Bar dataKey="dashboardRuntime" stackId="n" fill={OKABE.orange} isAnimationActive={false} />
              <Bar dataKey="mcpLaunchers" stackId="n" fill="url(#launch-mcp-hatch)" stroke={OKABE.purple} isAnimationActive={false} />
              <Bar dataKey="mcpServers" stackId="n" fill={OKABE.purple} isAnimationActive={false} />
              <Bar dataKey="children" stackId="n" fill={OKABE.yellow} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="space-y-1">
          <div className="text-[11px] font-medium text-neutral-200">What this snapshot shows</div>
          <div className="grid gap-2 grid-cols-2 xl:grid-cols-5">
            <Stat label="C: dashboard runtime" value={fmtInt(measured.chains)} hint="dashboard_server_runtime and dashboard_production_runtime processes" />
            <Stat
              label="L: launchers per chain"
              value={measured.launchersPerChain === null ? "—" : fmt(measured.launchersPerChain, 1)}
              hint={`${measured.dashboardLauncherCount} dashboard launcher processes in all`}
            />
            <Stat label="M: MCP servers" value={fmtInt(measured.mcpServers)} hint="MCP server processes that are not launchers" />
            <Stat label="MCP launchers" value={fmtInt(measured.mcpLaunchers)} hint="npx-cli.js processes; the model assumes one per server" />
            <Stat label="P: python and esbuild" value={fmtInt(measured.children)} hint="hardware telemetry node and esbuild service" />
          </div>
        </div>
      </div>
    </Section>
  );
}
