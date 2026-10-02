/**
 * The raw stream: every event the run wrote, 15 per page, exactly as the
 * record has it (the detail column holds what the event carried beyond the
 * columns shown; the first 120 characters here, all of it on hover).
 */

import { ControlBar, Section, fmt, fmtInt } from "@/studies/kit";
import type { StreamEventRow } from "@shared/studies/training-environment";
import { clampInt, type SetControl, type TrainingControls } from "./shared";

const PAGE_SIZE = 15;

export function StreamTable({ events, controls, set }: { events: readonly StreamEventRow[]; controls: TrainingControls; set: SetControl }) {
  const pages = Math.max(1, Math.ceil(events.length / PAGE_SIZE));
  const page = clampInt(controls.streamPage, 1, pages);
  const rows = events.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const button = "rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-300 hover:bg-neutral-800 disabled:opacity-40";
  return (
    <Section title="The raw stream" question="Every event the run wrote, in order.">
      <div className="space-y-2">
        <ControlBar>
          <button type="button" className={button} disabled={page <= 1} onClick={() => set("streamPage", page - 1)}>◀ previous</button>
          <span className="self-center font-mono text-[11px] text-neutral-300">page {page} of {pages} · {fmtInt(events.length)} events</span>
          <button type="button" className={button} disabled={page >= pages} onClick={() => set("streamPage", page + 1)}>next ▶</button>
        </ControlBar>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-[11px] font-mono tnum">
            <thead>
              <tr className="text-neutral-500">
                {["event_index", "event_type", "epoch", "batch", "loss", "snapshot_file", "elapsed_seconds", "detail"].map((name) => (
                  <th key={name} className="py-0.5 pr-3 text-left font-normal">{name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.event_index} className="border-t border-neutral-900 align-top text-neutral-200">
                  <td className="py-0.5 pr-2">{row.event_index}</td>
                  <td className="pr-2">{row.event_type}</td>
                  <td className="pr-2">{row.epoch ?? "—"}</td>
                  <td className="pr-2">{row.batch === null ? "—" : `${row.batch}/${row.batch_count}`}</td>
                  <td className="pr-2">{row.loss === null ? "—" : fmt(row.loss, 5)}</td>
                  <td className="pr-2">{row.snapshot_file ?? "—"}</td>
                  <td className="pr-2">{fmt(row.elapsed_seconds, 3)}</td>
                  <td className="max-w-[26rem] truncate text-neutral-400" title={row.detail}>{row.detail.length > 120 ? `${row.detail.slice(0, 120)}…` : row.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Section>
  );
}
