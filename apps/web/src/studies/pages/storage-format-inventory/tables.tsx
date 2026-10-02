/**
 * The two tables of the inventory: the eight numbers of file size per format
 * family, and the 400 largest files with search, sorting and paging (what
 * `mo.ui.table` gave the notebook).
 */

import { useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { fmt, fmtInt } from "@/studies/kit";
import type { FamilySummaryRow, LargestFile } from "@shared/studies/storage-format-inventory";
import { familyColor, familyGlyph, familyLabel } from "./formats";

type Direction = "asc" | "desc";

function SortHeader({ label, active, direction, onClick, align = "right", hint }: { label: string; active: boolean; direction: Direction; onClick: () => void; align?: "left" | "right"; hint?: string }) {
  return (
    <th className={`py-1 font-normal ${align === "right" ? "text-right" : "text-left"}`} aria-sort={active ? (direction === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={onClick} title={hint} className={`inline-flex items-center gap-0.5 hover:text-neutral-100 ${active ? "text-neutral-100" : "text-neutral-500"}`}>
        {label}
        {active && (direction === "asc" ? <ArrowUp className="h-2.5 w-2.5" /> : <ArrowDown className="h-2.5 w-2.5" />)}
      </button>
    </th>
  );
}

type SummaryKey = "format_family" | "fileCount" | "totalGibibytes" | "mean" | "median" | "standardDeviation" | "skewness" | "kurtosis" | "percentile25" | "percentile75" | "minimum" | "maximum";

function summaryValue(row: FamilySummaryRow, key: SummaryKey): number | string | null {
  if (key === "format_family") return row.format_family;
  if (key === "fileCount") return row.fileCount;
  if (key === "totalGibibytes") return row.totalGibibytes;
  return row.mebibytes[key];
}

const SUMMARY_COLUMNS: Array<{ key: SummaryKey; label: string; digits: number; hint: string }> = [
  { key: "fileCount", label: "files", digits: 0, hint: "number of files" },
  { key: "totalGibibytes", label: "total GiB", digits: 3, hint: "sum of file sizes, gibibytes" },
  { key: "mean", label: "mean", digits: 4, hint: "mean file size, mebibytes" },
  { key: "median", label: "median", digits: 4, hint: "median file size, mebibytes" },
  { key: "standardDeviation", label: "standard deviation", digits: 4, hint: "sample standard deviation of file size, mebibytes" },
  { key: "skewness", label: "skewness", digits: 3, hint: "sample-adjusted skewness G1 (unitless)" },
  { key: "kurtosis", label: "excess kurtosis", digits: 3, hint: "sample-adjusted excess kurtosis G2 (unitless)" },
  { key: "percentile25", label: "25th percentile", digits: 4, hint: "25th percentile of file size, mebibytes" },
  { key: "percentile75", label: "75th percentile", digits: 4, hint: "75th percentile of file size, mebibytes" },
  { key: "minimum", label: "minimum", digits: 6, hint: "smallest file, mebibytes" },
  { key: "maximum", label: "maximum", digits: 4, hint: "largest file, mebibytes" },
];

export function FamilySummaryTable({ rows }: { rows: FamilySummaryRow[] }) {
  const [sortKey, setSortKey] = useState<SummaryKey>("totalGibibytes");
  const [direction, setDirection] = useState<Direction>("desc");
  const sorted = [...rows].sort((a, b) => {
    const left = summaryValue(a, sortKey);
    const right = summaryValue(b, sortKey);
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "string" ? left.localeCompare(String(right)) : (left as number) - (right as number);
    return direction === "asc" ? order : -order;
  });
  const click = (key: SummaryKey) => {
    if (key === sortKey) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDirection(key === "format_family" ? "asc" : "desc");
    }
  };
  if (rows.length === 0) return <p className="py-4 text-center text-xs text-neutral-500">No files match the controls.</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px] font-mono tnum">
        <thead>
          <tr className="border-b border-neutral-800">
            <SortHeader label="format family" align="left" active={sortKey === "format_family"} direction={direction} onClick={() => click("format_family")} />
            {SUMMARY_COLUMNS.map((column) => (
              <SortHeader key={column.key} label={column.label} hint={column.hint} active={sortKey === column.key} direction={direction} onClick={() => click(column.key)} />
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.format_family} className="border-b border-neutral-900">
              <td className="whitespace-nowrap py-1 pr-2 font-sans text-neutral-200">
                <span aria-hidden="true" style={{ color: familyColor(row.format_family) }}>{familyGlyph(row.format_family)}</span> {familyLabel(row.format_family)}
              </td>
              {SUMMARY_COLUMNS.map((column) => {
                const value = summaryValue(row, column.key) as number | null;
                return (
                  <td key={column.key} className="py-1 pl-2 text-right text-neutral-200">
                    {column.key === "fileCount" ? fmtInt(value) : fmt(value, column.digits)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[10px] text-neutral-500">Sizes in mebibytes; skewness and excess kurtosis are unitless. A dash marks a statistic a family has too few files for (under 3 for skewness, under 4 for kurtosis).</p>
    </div>
  );
}

type FileKey = "store_name" | "zone_name" | "format_family" | "file_extension" | "mebibytes" | "modified_timestamp" | "file_path";

const FILE_COLUMNS: Array<{ key: FileKey; label: string; align: "left" | "right" }> = [
  { key: "store_name", label: "store", align: "left" },
  { key: "zone_name", label: "zone", align: "left" },
  { key: "format_family", label: "format family", align: "left" },
  { key: "file_extension", label: "extension", align: "left" },
  { key: "mebibytes", label: "mebibytes", align: "right" },
  { key: "modified_timestamp", label: "modified", align: "left" },
  { key: "file_path", label: "file path", align: "left" },
];

const PAGE_SIZE = 20;

export function FilesTable({ files }: { files: LargestFile[] }) {
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<FileKey>("mebibytes");
  const [direction, setDirection] = useState<Direction>("desc");
  const [page, setPage] = useState(0);

  const needle = search.trim().toLowerCase();
  const matching = needle
    ? files.filter((file) => [file.store_name, file.zone_name, file.format_family, file.file_extension ?? "", file.file_path, file.modified_timestamp ?? ""].some((field) => field.toLowerCase().includes(needle)))
    : files;
  const sorted = [...matching].sort((a, b) => {
    const left = a[sortKey];
    const right = b[sortKey];
    if (left === right) return 0;
    if (left === null) return 1;
    if (right === null) return -1;
    const order = typeof left === "number" ? left - (right as number) : String(left).localeCompare(String(right));
    return direction === "asc" ? order : -order;
  });
  const pageCount = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const current = Math.min(page, pageCount - 1);
  const visible = sorted.slice(current * PAGE_SIZE, (current + 1) * PAGE_SIZE);
  const click = (key: FileKey) => {
    if (key === sortKey) setDirection(direction === "asc" ? "desc" : "asc");
    else {
      setSortKey(key);
      setDirection(key === "mebibytes" ? "desc" : "asc");
    }
    setPage(0);
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-[11px] text-neutral-400">
          Search
          <input
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setPage(0);
            }}
            placeholder="path, zone, extension…"
            className="h-7 w-56 rounded border border-neutral-700 bg-neutral-950 px-2 text-xs text-neutral-200"
          />
        </label>
        <span className="text-[11px] text-neutral-500">
          {fmtInt(matching.length)} of the {fmtInt(files.length)} largest files
        </span>
        <div className="ml-auto flex items-center gap-1 text-[11px] text-neutral-400">
          <button type="button" disabled={current === 0} onClick={() => setPage(current - 1)} className="rounded border border-neutral-700 p-1 disabled:opacity-40" aria-label="Previous page">
            <ChevronLeft className="h-3 w-3" />
          </button>
          <span className="font-mono tnum">page {current + 1} / {pageCount}</span>
          <button type="button" disabled={current >= pageCount - 1} onClick={() => setPage(current + 1)} className="rounded border border-neutral-700 p-1 disabled:opacity-40" aria-label="Next page">
            <ChevronRight className="h-3 w-3" />
          </button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="py-4 text-center text-xs text-neutral-500">No file matches.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="border-b border-neutral-800">
                {FILE_COLUMNS.map((column) => (
                  <SortHeader key={column.key} label={column.label} align={column.align} active={sortKey === column.key} direction={direction} onClick={() => click(column.key)} />
                ))}
              </tr>
            </thead>
            <tbody>
              {visible.map((file) => (
                <tr key={file.file_path} className="border-b border-neutral-900 align-top">
                  <td className="whitespace-nowrap py-1 pr-2 text-neutral-300">{file.store_name}</td>
                  <td className="max-w-[12rem] truncate py-1 pr-2 text-neutral-300" title={file.zone_name}>{file.zone_name}</td>
                  <td className="whitespace-nowrap py-1 pr-2 text-neutral-300">
                    <span aria-hidden="true" style={{ color: familyColor(file.format_family) }}>{familyGlyph(file.format_family)}</span> {familyLabel(file.format_family)}
                  </td>
                  <td className="whitespace-nowrap py-1 pr-2 font-mono text-neutral-300">{file.file_extension ?? "—"}</td>
                  <td className="whitespace-nowrap py-1 pr-2 text-right font-mono tnum text-neutral-100">{fmt(file.mebibytes, 3)}</td>
                  <td className="whitespace-nowrap py-1 pr-2 font-mono text-neutral-400">{file.modified_timestamp ?? "—"}</td>
                  <td className="max-w-[26rem] truncate py-1 font-mono text-neutral-400" title={file.file_path}>{file.file_path}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
