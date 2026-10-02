/**
 * Lake audit. Reads the landed audit reports (`derived_study_lake_audit_*`);
 * the audit itself (a scan of 785M rows, and its apply which rewrites Iceberg
 * partitions) is a Python job in the datalake repo and is never run from here.
 */

import {
  ColumnGrid, ControlBar, Empty, SelectControl, Section, Stat, StudyNotes, StudyState, fmt, fmtInt, fmtTime, useStudyControls, useStudyQuery,
  OKABE,
} from "@/studies/kit";
import { EMPTY_BODY, fractionalYear, sharePercent, type CheckOrder, type LakeAuditBody } from "@shared/studies/lake-audit";
import {
  CoverageSection, ChecksSection, DuplicatesSection, FormulaSection, Headline, PartitionsSection, RemediationSection,
  RunHistory, ViolationsSection, stamp,
} from "./Sections";

export default function Page() {
  const [controls, set, reset] = useStudyControls({
    table: "",
    run: "",
    order: "violations",
    onlyFiring: false,
    logScale: true,
    focusCheck: "",
    partitionCount: 20,
    onlyChanged: true,
    terms: -1,
  });
  const query = useStudyQuery<LakeAuditBody>("lake-audit", { table: controls.table, run: controls.run });
  const body = query.data?.data ?? EMPTY_BODY;
  const { selected } = body;

  const firing = body.checks.filter((check) => check.violation_row_count > 0);
  const focus = controls.focusCheck || [...firing].sort((a, b) => b.violation_row_count - a.violation_row_count)[0]?.check_name || "";

  return (
    <div className="space-y-3">
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {!selected ? (
          <Section title="No audit report">
            <Empty>
              No audit report has been landed. Run <code className="font-mono">python scripts/audit_lake.py --table bars</code> in the datalake repo (it writes to s3://meta/audits/), then{" "}
              <code className="font-mono">packages/ml-engine/src/studies/lake_audit/build.py</code> to land it here.
            </Empty>
          </Section>
        ) : (
          <>
            <ControlBar onReset={reset}>
              <SelectControl
                label="Table"
                value={body.table ?? ""}
                options={body.tables.map((name) => ({ value: name, label: name }))}
                onChange={(value) => {
                  set("table", value);
                  set("run", "");
                }}
                hint="Tables that have an audit report"
              />
              <SelectControl
                label="Run"
                value={selected.recipe}
                options={[...body.runs].reverse().map((run) => ({ value: run.recipe, label: `${fmtTime(run.generated_at)}  ${run.error_row_count === 0 ? "clean" : `${fmtInt(run.error_row_count)} errors`}` }))}
                onChange={(value) => set("run", value)}
                hint="Every audit run of this table; the newest by default"
              />
            </ControlBar>

            <Headline run={selected} />

            <div className="grid grid-cols-2 gap-2 xl:grid-cols-5">
              <Stat label="Rows" value={fmtInt(selected.row_count)} hint="rows in the table at the audited snapshot" />
              <Stat label="Partitions" value={fmtInt(selected.partition_count)} />
              <Stat label="Rows failing an error check" value={fmtInt(selected.error_row_count)} tone={selected.error_row_count > 0 ? OKABE.orange : OKABE.sky} hint="sum over error-severity checks" />
              <Stat label="Rows flagged for review" value={fmtInt(selected.warning_row_count)} tone={selected.warning_row_count > 0 ? OKABE.orange : OKABE.sky} hint="sum over warning-severity checks" />
              <Stat label="Rows a clean would drop" value={fmtInt(selected.droppable_row_count)} tone={selected.droppable_row_count > 0 ? OKABE.orange : OKABE.sky} />
              <Stat label="Duplicate uniqueness keys" value={fmtInt(selected.duplicate_key_row_count)} tone={selected.duplicate_key_row_count > 0 ? OKABE.orange : OKABE.sky} hint={`key: ${selected.unique_key}`} />
              <Stat label="Snapshot" value={selected.snapshot_id} hint="Iceberg snapshot id the audit read" />
              <Stat label="Generated" value={stamp(selected.generated_at)} />
              <Stat label="Scan" value={`${fmt(selected.row_pass_seconds, 1)} s + ${fmt(selected.duplicate_pass_seconds, 1)} s`} hint="row pass + duplicate pass" />
              <Stat label="Source report" value={selected.source_report.replace("s3://", "")} hint="the JSON the audit job wrote" />
            </div>

            <ViolationsSection checks={body.checks} logScale={controls.logScale} onLogScale={(value) => set("logScale", value)} />

            <ChecksSection
              body={body}
              order={controls.order as CheckOrder}
              onOrder={(value) => set("order", value)}
              onlyFiring={controls.onlyFiring}
              onOnlyFiring={(value) => set("onlyFiring", value)}
            />

            <PartitionsSection body={body} focus={focus} onFocus={(name) => set("focusCheck", name)} count={controls.partitionCount} onCount={(value) => set("partitionCount", value)} />

            <RunHistory body={body} onSelect={(recipe) => set("run", recipe)} onlyChanged={controls.onlyChanged} onOnlyChanged={(value) => set("onlyChanged", value)} />

            <CoverageSection body={body} />
            <DuplicatesSection body={body} />
            <RemediationSection body={body} count={controls.partitionCount} onCount={(value) => set("partitionCount", value)} />
            <FormulaSection body={body} terms={controls.terms} onTerms={(value) => set("terms", value)} focus={focus} />

            <Section title="Every column" question="Each numeric column of each frame on this page as its own histogram with its eight numbers. A column that is all zeros or has fewer than three distinct values is not drawn.">
              <div className="space-y-4">
                <ColumnGrid
                  title="Checks"
                  rows={body.checks.map((check) => ({
                    violation_row_count: check.violation_row_count,
                    share_of_table_percent: sharePercent(check),
                    affected_partition_count: check.affected_partition_count,
                  }))}
                />
                <ColumnGrid
                  title="Coverage slices"
                  rows={body.coverage.map((row) => ({
                    row_count: row.row_count,
                    symbol_count: row.symbol_count,
                    first_row_year: fractionalYear(row.first_timestamp),
                    last_row_year: fractionalYear(row.last_timestamp),
                    hours_since_last_row: row.hours_since_last_row,
                  }))}
                />
                <ColumnGrid
                  title="Partitions a check landed in"
                  rows={body.checkPartitions.map((p) => ({ violation_row_count: p.violation_row_count, partition_start_year: fractionalYear(p.partition_start_timestamp) }))}
                />
                <ColumnGrid
                  title="Runs"
                  rows={body.runs.map((run) => ({
                    row_count: run.row_count,
                    partition_count: run.partition_count,
                    error_row_count: run.error_row_count,
                    warning_row_count: run.warning_row_count,
                    droppable_row_count: run.droppable_row_count,
                    duplicate_key_row_count: run.duplicate_key_row_count,
                    row_pass_seconds: run.row_pass_seconds,
                    duplicate_pass_seconds: run.duplicate_pass_seconds,
                  }))}
                />
                {body.remediationPartitions.length > 0 && (
                  <ColumnGrid
                    title="Remediation partitions"
                    rows={body.remediationPartitions.map((p) => ({
                      row_count_before: p.row_count_before,
                      row_count_after: p.row_count_after,
                      rows_removed: p.rows_removed,
                      partition_start_year: fractionalYear(p.partition_start_timestamp),
                    }))}
                  />
                )}
              </div>
            </Section>
          </>
        )}
      </StudyState>
    </div>
  );
}
