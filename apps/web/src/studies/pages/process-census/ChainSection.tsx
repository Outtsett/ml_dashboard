/**
 * The chain: each dashboard-owned process is one row, indented by how many
 * launcher ancestors sit above it. A row that holds a listening socket is
 * marked, so the page shows which link of the chain does the serving.
 */

import { Empty, Finding, OKABE, Section, fmt, fmtInt } from "@/studies/kit";
import { chainSockets, dashboardChain, roleOf, ROLE_PLUMBING, type ProcessRow } from "@shared/studies/process-census";

const COMMAND_LINE_CHARACTERS = 110;

export function ChainSection({ rows }: { rows: readonly ProcessRow[] }) {
  const chain = dashboardChain(rows);
  const sockets = chainSockets(chain);
  const deepest = chain.reduce((depth, row) => Math.max(depth, row.launcher_chain_depth), 0);

  return (
    <Section
      title="The chain"
      question="Each row is one dashboard process. Depth is how many launcher ancestors sit above it; a wrapper above the app waits for its child to exit."
    >
      {chain.length === 0 ? (
        <Empty>No dashboard process in this snapshot.</Empty>
      ) : (
        <>
          <Finding>
            {fmtInt(chain.length)} dashboard processes, chain depth 0 to {deepest}. {fmtInt(sockets.holding)} of them hold a listening socket: {fmtInt(sockets.holdingRuntime)} runtime,{" "}
            {fmtInt(sockets.holdingPlumbing)} launcher plumbing.
          </Finding>
          <div className="mt-2 overflow-x-auto rounded-md border border-neutral-800">
            <table className="w-full min-w-[640px] text-[11px]">
              <thead>
                <tr className="text-left text-neutral-500">
                  {["depth", "process name", "role", "owner category", "resident memory (MB)", "listening ports", "command line"].map((heading) => (
                    <th key={heading} className="px-2 py-1 font-normal">
                      {heading}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {chain.map((row) => {
                  const plumbing = roleOf(row) === ROLE_PLUMBING;
                  return (
                    <tr key={row.process_identifier} className="border-t border-neutral-900 align-top">
                      <td className="px-2 py-1 font-mono tnum text-neutral-300">{row.launcher_chain_depth}</td>
                      <td className="px-2 py-1 font-mono text-neutral-200" style={{ paddingLeft: 8 + row.launcher_chain_depth * 14 }}>
                        {row.launcher_chain_depth > 0 ? "└ " : ""}
                        {row.process_name}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap" style={{ color: plumbing ? OKABE.sky : OKABE.orange }}>
                        {plumbing ? "▨ launcher plumbing" : "■ runtime"}
                      </td>
                      <td className="px-2 py-1 text-neutral-300">{row.owner_category}</td>
                      <td className="px-2 py-1 text-right font-mono tnum text-neutral-200">{fmt(row.resident_memory_megabytes, 1)}</td>
                      <td className="px-2 py-1 font-mono text-neutral-300">{row.listening_port_count > 0 ? `◉ ${row.listening_ports}` : ""}</td>
                      <td className="max-w-[320px] truncate px-2 py-1 font-mono text-neutral-400" title={row.command_line}>
                        {row.command_line.slice(0, COMMAND_LINE_CHARACTERS)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Section>
  );
}
