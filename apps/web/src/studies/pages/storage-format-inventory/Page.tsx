/**
 * Storage-format inventory: is all my data in parquet? Every control filters
 * the measured files on the server (one SQL per panel over the landed
 * inventory); the page draws the aggregates and keeps the picture on screen
 * while a slider drags.
 */

import { useEffect, useState, type ReactNode } from "react";
import {
  ControlBar, Empty, Finding, Section, SegmentControl, SelectControl, SliderControl, Stat, StudyNotes, StudyState, SwitchControl,
  fmt, fmtInt, useStudyControls, useStudyQuery,
} from "@/studies/kit";
import {
  BREAKDOWN_DIMENSIONS, joinList, parseList,
  type BreakdownDimension, type InventoryBody, type OptionRow,
} from "@shared/studies/storage-format-inventory";
import { BreakdownChart, FamilyRanges, SizeHistogramChart, TimelineChart, ZoneShareChart } from "./charts";
import { ColumnPanels } from "./columns";
import { familyColor, familyGlyph, familyLabel, formatBytes, orderedFamilies } from "./formats";
import { MomentsFormula, ParquetShareFormula } from "./formulas";
import { FamilySummaryTable, FilesTable } from "./tables";

const SLUG = "storage-format-inventory";

const DIMENSION_LABEL: Record<BreakdownDimension, string> = {
  format_family: "format family",
  file_extension: "file extension",
  zone_name: "zone or directory",
  store_name: "store",
};

/** The value after it has stopped changing for `delayMs`, so a dragged slider asks the lake once. */
function useSettled<T>(value: T, delayMs: number): T {
  const key = JSON.stringify(value);
  const [settled, setSettled] = useState(key);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(key), delayMs);
    return () => clearTimeout(timer);
  }, [key, delayMs]);
  return JSON.parse(settled) as T;
}

function ChipGroup({
  label, options, hidden, onChange, glyphs = false,
}: { label: string; options: OptionRow[]; hidden: string; onChange: (hidden: string) => void; glyphs?: boolean }) {
  const hiddenValues = new Set(parseList(hidden));
  const shown = options.filter((option) => !hiddenValues.has(option.value)).length;
  const toggle = (value: string) => {
    const next = new Set(hiddenValues);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(joinList(options.filter((option) => next.has(option.value)).map((option) => option.value)));
  };
  return (
    <fieldset className="min-w-0 space-y-1">
      <legend className="flex items-baseline gap-2 text-[10px] uppercase tracking-wider text-neutral-500">
        {label}
        <span className="font-mono normal-case tracking-normal text-neutral-300">{shown} of {options.length}</span>
        <button type="button" className="normal-case tracking-normal text-[#56B4E9] hover:underline" onClick={() => onChange("")}>all</button>
        <button type="button" className="normal-case tracking-normal text-[#56B4E9] hover:underline" onClick={() => onChange(joinList(options.map((option) => option.value)))}>none</button>
      </legend>
      <div className="flex flex-wrap gap-1">
        {options.map((option) => {
          const on = !hiddenValues.has(option.value);
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(option.value)}
              title={`${option.value}: ${fmtInt(option.fileCount)} files, ${fmt(option.gibibytes, 3)} GiB`}
              className={`max-w-[16rem] truncate rounded border px-1.5 py-0.5 text-[10px] ${on ? "border-neutral-500 bg-neutral-800 text-neutral-100" : "border-neutral-800 text-neutral-500 line-through"}`}
            >
              <span aria-hidden="true">{on ? "☑" : "☐"} </span>
              {glyphs && <span aria-hidden="true" style={{ color: familyColor(option.value) }}>{familyGlyph(option.value)} </span>}
              {glyphs ? familyLabel(option.value) : option.value}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function findings(body: InventoryBody): { headline: string | null; shape: string | null; written: string | null } {
  const { totals } = body;
  if (totals.fileCount === 0 || totals.parquetSharePercent === null) return { headline: null, shape: null, written: null };
  const otherFamilies = body.familySummaries.filter((row) => row.format_family !== "parquet_columnar");
  const biggestOther = otherFamilies[0];
  const zoneWithMostOther = [...body.zoneShares].sort((a, b) => b.notParquetBytes - a.notParquetBytes)[0];
  const headline =
    `${fmt(totals.parquetSharePercent, 2)}% of the ${fmt(totals.totalBytes / 1024 ** 3, 2)} GiB shown sits in parquet. ` +
    `The other ${fmt(totals.nonParquetBytes / 1024 ** 3, 2)} GiB is` +
    (biggestOther ? ` mostly ${familyLabel(biggestOther.format_family)} (${fmt(biggestOther.totalGibibytes, 2)} GiB in ${fmtInt(biggestOther.fileCount)} files)` : " nothing the filters leave in") +
    (zoneWithMostOther && zoneWithMostOther.notParquetBytes > 0 ? `, and ${fmt(zoneWithMostOther.notParquetBytes / 1024 ** 3, 2)} GiB of it sits in ${zoneWithMostOther.zone_name}.` : ".");
  const largest = body.familySummaries[0];
  const shape =
    largest && largest.mebibytes.median !== null && largest.mebibytes.mean !== null && largest.mebibytes.maximum !== null
      ? `${familyLabel(largest.format_family)}, the biggest family: the median file is ${formatBytes(largest.mebibytes.median * 1024 ** 2)} but the mean is ${formatBytes(largest.mebibytes.mean * 1024 ** 2)}, skewness ${fmt(largest.mebibytes.skewness, 1)}, largest ${formatBytes(largest.mebibytes.maximum * 1024 ** 2)}. A few huge files carry the bytes; most files are small.`
      : null;
  const months = new Map<string, number>();
  for (const cell of body.timeline) months.set(cell.month, (months.get(cell.month) ?? 0) + cell.gibibytes);
  const busiest = [...months.entries()].sort((a, b) => b[1] - a[1])[0];
  const written = busiest ? `${busiest[0]} holds the most recently written bytes: ${fmt(busiest[1], 2)} GiB of the files shown were last modified that month.` : null;
  return { headline, shape, written };
}

function Grid({ children }: { children: ReactNode }) {
  return <div className="grid grid-cols-1 gap-3 xl:grid-cols-2 [&>*]:min-w-0">{children}</div>;
}

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    recipe: "",
    hiddenStores: "",
    hiddenZones: "",
    hiddenFamilies: "",
    minimumKibibytes: 0,
    logarithmicAxis: true,
    breakdown: "format_family",
    sizeBins: 44,
    columnBins: 30,
    momentFamily: "",
  });
  const requested = useSettled(
    {
      recipe: controls.recipe,
      hiddenStores: controls.hiddenStores,
      hiddenZones: controls.hiddenZones,
      hiddenFamilies: controls.hiddenFamilies,
      minimumKibibytes: controls.minimumKibibytes,
      sizeBins: controls.sizeBins,
      columnBins: controls.columnBins,
    },
    250,
  );
  const query = useStudyQuery<InventoryBody>(SLUG, requested);
  const body = query.data?.data;
  const notes = query.data?.notes ?? [];
  const dimension = (BREAKDOWN_DIMENSIONS as readonly string[]).includes(controls.breakdown) ? (controls.breakdown as BreakdownDimension) : "format_family";

  const families = body ? orderedFamilies(body.options.families.map((option) => option.value)) : [];
  const shownFamilies = body ? families.filter((family) => !parseList(controls.hiddenFamilies).includes(family)) : [];
  const momentRow = body?.familySummaries.find((row) => row.format_family === controls.momentFamily) ?? body?.familySummaries[0];
  const read = body ? findings(body) : null;

  return (
    <div className="space-y-4">
      <StudyNotes notes={notes} />
      <StudyState isLoading={query.isLoading} error={query.error}>
        {!body ? null : !body.available ? (
          <Empty>The inventory has not been landed in the lake yet. The notes above say how.</Empty>
        ) : (
          <>
            <Finding>
              Every measured file across the lake and the repositories, grouped by the format that physically holds the bytes. Move the controls and every panel, statistic and table below recomputes from them.
            </Finding>

            <div className="space-y-3 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2">
              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 [&>*]:min-w-0">
                <ChipGroup label="Store" options={body.options.stores} hidden={controls.hiddenStores} onChange={(value) => set("hiddenStores", value)} />
                <ChipGroup label="Format family" options={body.options.families} hidden={controls.hiddenFamilies} onChange={(value) => set("hiddenFamilies", value)} glyphs />
              </div>
              <details>
                <summary className="cursor-pointer text-[11px] text-neutral-300">
                  Zone or directory: {body.options.zones.length - parseList(controls.hiddenZones).length} of {body.options.zones.length} shown
                </summary>
                <div className="mt-2 max-h-48 overflow-y-auto">
                  <ChipGroup label="Zone or directory" options={body.options.zones} hidden={controls.hiddenZones} onChange={(value) => set("hiddenZones", value)} />
                </div>
              </details>
              <ControlBar onReset={reset}>
                <SliderControl label="Hide files smaller than" value={controls.minimumKibibytes} min={0} max={1024} step={16} onChange={(value) => set("minimumKibibytes", value)} format={(value) => `${value} KiB`} hint="Drops every file below this size from every panel" />
                <SelectControl
                  label="Break bytes down by"
                  value={dimension}
                  options={BREAKDOWN_DIMENSIONS.map((value) => ({ value, label: DIMENSION_LABEL[value] }))}
                  onChange={(value) => set("breakdown", value)}
                />
                <SwitchControl label="Logarithmic byte axis" checked={controls.logarithmicAxis} onChange={(value) => set("logarithmicAxis", value)} hint="A symlog axis: bars start at zero, which a true log axis cannot show" />
                <SliderControl label="Size histogram bins" value={controls.sizeBins} min={5} max={100} onChange={(value) => set("sizeBins", value)} />
                {body.recipes.length > 1 && (
                  <SelectControl label="Measurement" value={body.recipe ?? ""} options={body.recipes.map((value) => ({ value, label: value }))} onChange={(value) => set("recipe", value)} />
                )}
              </ControlBar>
            </div>

            <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Stat label="Total measured" value={`${fmt(body.totals.totalBytes / 1024 ** 3, 2)} GiB`} hint={`${fmtInt(body.totals.totalBytes)} bytes`} />
              <Stat label="Held in parquet" value={body.totals.parquetSharePercent === null ? "—" : `${fmt(body.totals.parquetSharePercent, 2)}%`} hint="100 x parquet bytes / total bytes" />
              <Stat label="Not in parquet" value={`${fmt(body.totals.nonParquetBytes / 1024 ** 3, 2)} GiB`} hint="Total bytes minus the bytes whose is_parquet flag is true" />
              <Stat label="Files" value={fmtInt(body.totals.fileCount)} hint={`of ${fmtInt(body.inventoryFileCount)} measured`} />
            </div>
            {read?.headline && <Finding>{read.headline}</Finding>}

            <Grid>
              <Section title={`A. Bytes by ${DIMENSION_LABEL[dimension]}`} question="Where the bytes are, largest 25 groups. Switch the dimension above; the axis is symlog by default because a few groups dwarf the rest.">
                <BreakdownChart rows={body.breakdowns[dimension]} dimension={dimension} logarithmic={controls.logarithmicAxis} totalBytes={body.totals.totalBytes} />
              </Section>
              <Section title="B. Parquet against everything else, per zone" question="Each zone's bytes as 100%: parquet (solid blue) against every other format (hatched orange).">
                <ZoneShareChart rows={body.zoneShares} />
              </Section>
            </Grid>

            <Grid>
              <Section title="C. File-size distribution" question="Files by log10 of their size, stacked by format family. Hover a bar for the families in it.">
                <SizeHistogramChart histogram={body.sizeHistogram} families={shownFamilies} />
              </Section>
              <Section title="D. Bytes written per month" question="Gibibytes by the month each file was last modified, stacked by format family (a month with no writes reads as zero).">
                <TimelineChart cells={body.timeline} families={shownFamilies} />
                {read?.written && <Finding>{read.written}</Finding>}
              </Section>
            </Grid>

            <Section
              title="E. File size per format family: all eight numbers, in mebibytes"
              question="Mean and standard deviation alone would describe a bell curve, and file sizes are nothing of the sort. Skewness and kurtosis show how far one archive or feature table pulls the mean away from the typical file; the minimum and maximum name the extremes doing it."
            >
              <div className="space-y-3">
                <FamilyRanges summaries={body.familySummaries} />
                {read?.shape && <Finding>{read.shape}</Finding>}
                <FamilySummaryTable rows={body.familySummaries} />
                <Grid>
                  <ParquetShareFormula totals={body.totals} />
                  <div className="space-y-2">
                    <SegmentControl
                      label="Explain the moments of"
                      value={momentRow?.format_family ?? ""}
                      options={body.familySummaries.slice(0, 4).map((row) => ({ value: row.format_family, label: familyLabel(row.format_family) }))}
                      onChange={(value) => set("momentFamily", value)}
                      hint="The four largest families"
                    />
                    <MomentsFormula row={momentRow} />
                  </div>
                </Grid>
              </div>
            </Section>

            <Section title="F. The files themselves" question={`The ${fmtInt(body.largestFiles.length)} largest files the controls leave in: sort a column, search the paths.`}>
              <FilesTable key={JSON.stringify(requested)} files={body.largestFiles} />
            </Section>

            <Section title="G. Every column of the inventory table" question="Each column of data_format_inventory graphed on its own, with its numbers. The panels follow the filters above.">
              <ColumnPanels profiles={body.columns} bins={controls.columnBins} onBinsChange={(value) => set("columnBins", value)} />
            </Section>

            {body.measurement && (
              <p className="text-[11px] leading-relaxed text-neutral-500">
                Rows shown: {fmtInt(body.totals.fileCount)} of {fmtInt(body.inventoryFileCount)} measured files. Source table <span className="font-mono">data_format_inventory</span> in <span className="font-mono">{body.measurement.sourceDatabase}</span>,
                landed in the lake as <span className="font-mono">derived_study_storage_format_inventory_files</span> (recipe {body.recipe}). Measured {body.measurement.measuredOnDate} from <span className="font-mono">{body.measurement.measuredRoots}</span>,
                files last modified {body.measurement.earliestModifiedTimestamp} to {body.measurement.latestModifiedTimestamp}. lake holds no market tables and contributes no rows.
              </p>
            )}
          </>
        )}
      </StudyState>
    </div>
  );
}

