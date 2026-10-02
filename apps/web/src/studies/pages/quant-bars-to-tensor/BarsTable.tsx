/** A page of the continuous series' raw bars, the table the notebook opens with. */

import { SliderControl, fmt, fmtInt, ControlBar } from "@/studies/kit";
import type { BarsBody } from "@shared/studies/quant-bars-to-tensor";
import { stamp } from "./format";

export function BarsTable({ page, offset, onOffset, pageSize }: { page: BarsBody; offset: number; onOffset: (offset: number) => void; pageSize: number }) {
  return (
    <div className="space-y-2">
      <ControlBar>
        <SliderControl
          label="First row shown"
          value={Math.min(offset, Math.max(0, page.total - 1))}
          min={0}
          max={Math.max(1, page.total - pageSize)}
          step={pageSize}
          onChange={onOffset}
          format={fmtInt}
          hint="Bars in time order after the volume roll"
        />
        <p className="text-[11px] text-neutral-400">
          Rows {fmtInt(page.offset)} to {fmtInt(page.offset + page.rows.length - 1)} of {fmtInt(page.total)}.
        </p>
      </ControlBar>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-[11px] font-mono tnum">
          <thead>
            <tr className="text-neutral-500">
              {["bar", "timestamp", "symbol", "open", "high", "low", "close", "volume"].map((heading, index) => (
                <th key={heading} className={`px-2 py-1 font-normal ${index < 3 ? "text-left" : "text-right"}`}>{heading}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {page.rows.map((row) => (
              <tr key={row.barIndex} className="border-t border-neutral-900">
                <td className="px-2 py-0.5 text-neutral-500">{fmtInt(row.barIndex)}</td>
                <td className="px-2 py-0.5 text-neutral-300">{stamp(row.timestampMs)}</td>
                <td className="px-2 py-0.5 text-neutral-300">{row.contractSymbol}</td>
                <td className="px-2 py-0.5 text-right text-neutral-200">{fmt(row.open, 2)}</td>
                <td className="px-2 py-0.5 text-right text-neutral-200">{fmt(row.high, 2)}</td>
                <td className="px-2 py-0.5 text-right text-neutral-200">{fmt(row.low, 2)}</td>
                <td className="px-2 py-0.5 text-right text-neutral-200">{fmt(row.close, 2)}</td>
                <td className="px-2 py-0.5 text-right text-neutral-200">{fmtInt(row.volume)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
