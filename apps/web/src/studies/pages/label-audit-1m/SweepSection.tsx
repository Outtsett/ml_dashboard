/**
 * Sections 5 and 6 of the audit: the triple-barrier and swing class mixes over
 * the notebook's parameter grids (landed by build.py; the numba walks are not
 * something a web request reruns), and the swing label's forward reach.
 */

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { AXIS, Finding, FormulaCard, GRID, OKABE, Section, TOOLTIP, fmt, fmtInt, fmtPercent } from "@/studies/kit";
import type { BarrierRow, SwingRow } from "@shared/studies/label-audit-1m";
import { DataTable, Legend } from "./parts";

const shareLabel = (value: number) => (value >= 0.04 ? fmt(value, 2) : "");

function StackTooltip({ payload, rows }: { payload?: ReadonlyArray<{ payload?: unknown }>; rows: ReadonlyArray<{ label: string; parts: Array<[string, number]> ; count: number }> }) {
  const row = payload?.[0]?.payload as { label: string } | undefined;
  const found = rows.find((candidate) => candidate.label === row?.label);
  if (!found) return null;
  return (
    <div style={TOOLTIP.contentStyle} className="space-y-0.5 px-2 py-1 text-[11px]">
      <div className="font-semibold">{found.label}</div>
      {found.parts.map(([name, value]) => <div key={name}>{name} {fmt(value, 4)}</div>)}
      <div>{fmtInt(found.count)} labelled bars</div>
    </div>
  );
}

export function BarrierSection({ rows }: { rows: BarrierRow[] }) {
  const data = rows.map((row) => ({
    label: `TP ${row.take_profit_multiple_of_average_true_range} / SL ${row.stop_loss_multiple_of_average_true_range} ATR · clock ${row.vertical_barrier_bars}${row.is_shipped_default_before_fix ? " (shipped)" : ""}`,
    takeProfit: row.take_profit_first_share,
    stopLoss: row.stop_loss_first_share,
    timeout: row.vertical_timeout_share,
    count: row.labelled_bar_count,
  }));
  const tips = data.map((row) => ({ label: row.label, count: row.count, parts: [["▲ take profit first", row.takeProfit], ["▼ stop loss first", row.stopLoss], ["◆ vertical (timeout)", row.timeout]] as Array<[string, number]> }));
  const shipped = rows.find((row) => row.is_shipped_default_before_fix);
  const revived = rows.find((row) => row.vertical_barrier_bars === 5);

  return (
    <Section title="5 · Triple barrier: the class mix is a parameter choice, not a property of the market" question="ATR-14 scaled take-profit and stop-loss barriers resolved by first touch; the third class is the vertical (time) barrier.">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Legend items={[
            { glyph: "▲", label: "take profit first (+1)", color: OKABE.orange },
            { glyph: "▼", label: "stop loss first (−1)", color: OKABE.blue },
            { glyph: "◆", label: "vertical timeout (0)", color: OKABE.purple },
          ]} />
          <ResponsiveContainer width="100%" height={Math.max(200, 44 * data.length)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} />
              <YAxis type="category" dataKey="label" width={190} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} content={({ payload }) => <StackTooltip payload={payload} rows={tips} />} />
              <Bar dataKey="takeProfit" stackId="mix" fill={OKABE.orange} isAnimationActive={false}>
                <LabelList dataKey="takeProfit" position="center" formatter={shareLabel} fill="#111" fontSize={9} />
              </Bar>
              <Bar dataKey="stopLoss" stackId="mix" fill={OKABE.blue} isAnimationActive={false}>
                <LabelList dataKey="stopLoss" position="center" formatter={shareLabel} fill="#f5f5f5" fontSize={9} />
              </Bar>
              <Bar dataKey="timeout" stackId="mix" fill={OKABE.purple} isAnimationActive={false}>
                <LabelList dataKey="timeout" position="center" formatter={shareLabel} fill="#111" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="min-w-0 space-y-2">
          <Finding>
            {shipped && revived ? (
              <>
                At the shipped 1.5 ATR / clock 60 the timeout class holds {fmtPercent(shipped.vertical_timeout_share, 2)} of bars: 60 one-minute bars is long enough that an ATR band is essentially always touched, so the three-way head is a two-way head with a dead output unit. A 5-bar clock revives it to {fmtPercent(revived.vertical_timeout_share, 1)}. Fix applied: vertical_bars defaults to 5.
              </>
            ) : "Not landed yet."}
          </Finding>
          <DataTable
            rows={rows}
            rowKey={(row) => `${row.take_profit_multiple_of_average_true_range}-${row.vertical_barrier_bars}`}
            highlight={(row) => row.is_shipped_default_before_fix}
            columns={[
              { header: "take profit (ATR)", cell: (row) => fmt(row.take_profit_multiple_of_average_true_range, 1), align: "right" },
              { header: "stop loss (ATR)", cell: (row) => fmt(row.stop_loss_multiple_of_average_true_range, 1), align: "right" },
              { header: "clock (bars)", cell: (row) => fmtInt(row.vertical_barrier_bars), align: "right" },
              { header: "labelled bars", cell: (row) => fmtInt(row.labelled_bar_count), align: "right" },
              { header: "▲ TP first", cell: (row) => fmt(row.take_profit_first_share, 4), align: "right" },
              { header: "▼ SL first", cell: (row) => fmt(row.stop_loss_first_share, 4), align: "right" },
              { header: "◆ timeout", cell: (row) => fmt(row.vertical_timeout_share, 4), align: "right" },
            ]}
          />
        </div>
      </div>
    </Section>
  );
}

export function SwingSection({ rows, pick, onPick }: { rows: SwingRow[]; pick: number; onPick: (index: number) => void }) {
  const data = rows.map((row) => ({
    label: `period ${row.fractal_period_bars} · clock ${row.vertical_barrier_bars}`,
    high: row.next_pivot_high_share,
    low: row.next_pivot_low_share,
    timeout: row.timeout_share,
    count: row.labelled_bar_count,
    purgedByClock: row.vertical_barrier_bars,
    missed: row.forward_reach_bars - row.vertical_barrier_bars,
  }));
  const tips = data.map((row) => ({ label: row.label, count: row.count, parts: [["▲ next pivot high", row.high], ["▼ next pivot low", row.low], ["◆ timeout", row.timeout]] as Array<[string, number]> }));
  const chosen = rows[Math.min(Math.max(0, pick), Math.max(0, rows.length - 1))];
  const shipped = rows.find((row) => row.fractal_period_bars === 15 && row.vertical_barrier_bars === 120);
  const flipped = rows.find((row) => row.fractal_period_bars === 60 && row.vertical_barrier_bars === 15);
  const longest = rows.reduce((best, row) => Math.max(best, row.forward_reach_bars), 0);

  return (
    <Section title="6 · Swing labels: the timeout class and the purge" question="Label = direction of the next centred fractal pivot within the clock; 0 when none appears. A pivot is confirmed `period` bars after it forms, so the label reads that far past the clock.">
      <div className="grid min-w-0 gap-3 xl:grid-cols-2">
        <div className="min-w-0 space-y-1">
          <Legend items={[
            { glyph: "▲", label: "next pivot is a high (+1)", color: OKABE.orange },
            { glyph: "▼", label: "next pivot is a low (−1)", color: OKABE.blue },
            { glyph: "◆", label: "timeout (0)", color: OKABE.purple },
          ]} />
          <ResponsiveContainer width="100%" height={Math.max(220, 40 * data.length)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }} onClick={(state) => { const index = (state as { activeTooltipIndex?: number } | null)?.activeTooltipIndex; if (typeof index === "number") onPick(index); }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" domain={[0, 1]} tickFormatter={(value: number) => fmtPercent(value, 0)} {...AXIS} />
              <YAxis type="category" dataKey="label" width={130} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} content={({ payload }) => <StackTooltip payload={payload} rows={tips} />} />
              <Bar dataKey="high" stackId="mix" fill={OKABE.orange} isAnimationActive={false}>
                <LabelList dataKey="high" position="center" formatter={shareLabel} fill="#111" fontSize={9} />
              </Bar>
              <Bar dataKey="low" stackId="mix" fill={OKABE.blue} isAnimationActive={false}>
                <LabelList dataKey="low" position="center" formatter={shareLabel} fill="#f5f5f5" fontSize={9} />
              </Bar>
              <Bar dataKey="timeout" stackId="mix" fill={OKABE.purple} isAnimationActive={false}>
                <LabelList dataKey="timeout" position="center" formatter={shareLabel} fill="#111" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <Finding>
            {shipped && flipped ? (
              <>Period 15 / clock 120 leaves timeout {fmt(shipped.timeout_share, 4)}: a pivot always exists within the lookahead at 1m. Period 60 / clock 15 flips it to {fmt(flipped.timeout_share, 4)}. Put the clock below the fractal period, or drop the class to two outcomes; the label dataset now ships period 15 / clock 20.</>
            ) : "Not landed yet."}
          </Finding>
        </div>
        <div className="min-w-0 space-y-1">
          <h4 className="text-xs font-semibold text-neutral-200">Forward reach against the purge consumers code (click a configuration on the left)</h4>
          <Legend items={[
            { glyph: "■", label: "purged: the clock (vertical_bars)", color: OKABE.sky },
            { glyph: "■", label: "not purged: the fractal confirmation (period)", color: OKABE.vermillion },
          ]} />
          <ResponsiveContainer width="100%" height={Math.max(220, 40 * data.length)}>
            <BarChart data={data} layout="vertical" margin={{ top: 4, right: 12, left: 8, bottom: 4 }}>
              <CartesianGrid {...GRID} horizontal={false} />
              <XAxis type="number" scale="log" domain={[10, "auto"]} allowDataOverflow {...AXIS} tickFormatter={(value: number) => fmtInt(value)} />
              <YAxis type="category" dataKey="label" width={130} {...AXIS} interval={0} />
              <Tooltip {...TOOLTIP} formatter={(value, name) => [`${fmtInt(Number(value))} bars`, name === "purgedByClock" ? "purged (clock)" : "unpurged (period)"]} />
              <Bar dataKey="purgedByClock" stackId="reach" fill={OKABE.sky} isAnimationActive={false} />
              <Bar dataKey="missed" stackId="reach" fill={OKABE.vermillion} isAnimationActive={false}>
                <LabelList dataKey="missed" position="right" formatter={(value: number) => `+${fmtInt(value)}`} fill="#a3a3a3" fontSize={9} />
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <FormulaCard
            tex={"R = v + \\max(p_{\\text{high}},\\ p_{\\text{low}})"}
            caption={chosen ? `Period ${chosen.fractal_period_bars}, clock ${chosen.vertical_barrier_bars}: a purge of ${chosen.vertical_barrier_bars} bars leaves ${chosen.fractal_period_bars} bars of look-ahead in the training set.` : undefined}
            symbols={[
              { tex: "v", name: "vertical barrier: bars the label waits for a pivot", value: fmtInt(chosen?.vertical_barrier_bars) },
              { tex: "p_{\\text{high}}, p_{\\text{low}}", name: "fractal period: bars after a pivot before it is confirmed", value: fmtInt(chosen?.fractal_period_bars) },
              { tex: "R", name: "forward reach: how far ahead the label reads, the purge a walk-forward needs", value: `${fmtInt(chosen?.forward_reach_bars)} bars` },
            ]}
          />
          <Finding>
            Forward reach runs up to {fmtInt(longest)} bars in this sweep while consumers purge by the clock alone. Add max(high_period, low_period) to the purge every swing consumer passes to generate_folds (applied: swing_labels now returns forward_reach).
          </Finding>
        </div>
      </div>
      <div className="mt-2">
        <DataTable
          rows={rows}
          rowKey={(row) => `${row.fractal_period_bars}-${row.vertical_barrier_bars}`}
          highlight={(row) => row === chosen}
          columns={[
            { header: "fractal period (bars)", cell: (row) => fmtInt(row.fractal_period_bars), align: "right" },
            { header: "clock (bars)", cell: (row) => fmtInt(row.vertical_barrier_bars), align: "right" },
            { header: "forward reach (bars)", cell: (row) => fmtInt(row.forward_reach_bars), align: "right" },
            { header: "labelled bars", cell: (row) => fmtInt(row.labelled_bar_count), align: "right" },
            { header: "▲ next pivot high", cell: (row) => fmt(row.next_pivot_high_share, 4), align: "right" },
            { header: "▼ next pivot low", cell: (row) => fmt(row.next_pivot_low_share, 4), align: "right" },
            { header: "◆ timeout", cell: (row) => fmt(row.timeout_share, 4), align: "right" },
          ]}
        />
      </div>
    </Section>
  );
}
