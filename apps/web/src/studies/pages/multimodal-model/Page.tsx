/**
 * Multimodal MNQ bracket model: every trial against the acceptance gate
 * (replaced notebooks/multimodal_model.py). One request carries the whole
 * record; the trial and the quarter window are the only controls the server
 * sees, everything else re-draws what the page already holds.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { Finding, StudyNotes, StudyState, useStudyControls, useStudyQuery } from "@/studies/kit";
import type { MultimodalBody } from "@shared/studies/multimodal-model";
import { DEFAULTS, type Controls, type SetControl } from "./controls";
import { Scoreboard } from "./Scoreboard";
import { TrialDetail } from "./TrialDetail";
import { Calibration } from "./Calibration";
import { Modalities } from "./Modalities";
import { BaseRates } from "./BaseRates";
import { AuditRecord } from "./AuditRecord";
import { Gate } from "./Gate";

const TABS = [
  { value: "scoreboard", label: "Scoreboard" },
  { value: "detail", label: "Trial detail" },
  { value: "calibration", label: "Calibration" },
  { value: "modalities", label: "Modalities" },
  { value: "baserates", label: "Base rates" },
  { value: "audit", label: "Audit record" },
  { value: "gate", label: "Gate" },
] as const;

export default function Page() {
  const [controls, setRaw, reset] = useStudyControls(DEFAULTS);
  const set: SetControl = setRaw;
  const query = useStudyQuery<MultimodalBody>("multimodal-model", { trial: controls.trial, window: controls.window });
  const body = query.data?.data ?? null;
  const tabProps = { controls: controls as Controls, set };
  return (
    <div className="min-w-0 space-y-3">
      <Finding>
        The plan of record is <span className="font-mono">docs/plans/2026-09-29-multimodal/PLAN.md</span>; every step is in <span className="font-mono">CHECKPOINTS.md</span> beside it. A trial is one walk-forward run of the runner{" "}
        <span className="font-mono">multimodal_fusion+bracket_meta_label</span>, started from the dashboard: it trains per quarter, chooses the trading policy for each quarter from the EARLIER quarters only, trades every
        session with 2:1 and 3:1 brackets on MNQ, and is scored after AMP costs on the canonical window 2021Q2 to 2025Q2. The locked holdout (2025-07-01 to 2025-12-31) and the forward period (2026) are in no table here until the gate&apos;s single look.
      </Finding>
      <StudyState isLoading={query.isLoading} error={query.error}>
        <StudyNotes notes={query.data?.notes ?? []} />
        {body && (
          <Tabs value={controls.tab} onValueChange={(value) => set("tab", value)} className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <TabsList className="flex h-auto flex-wrap justify-start">
                {TABS.map((tab) => (
                  <TabsTrigger key={tab.value} value={tab.value} className="text-xs">{tab.label}</TabsTrigger>
                ))}
              </TabsList>
              <button type="button" onClick={reset} className="ml-auto rounded border border-neutral-700 px-2 py-1 text-[11px] text-neutral-400 hover:border-neutral-500 hover:text-neutral-200" title="Put every control back to its default">
                Reset controls
              </button>
            </div>
            <TabsContent value="scoreboard" className="space-y-3">{controls.tab === "scoreboard" && <Scoreboard {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="detail" className="space-y-3">{controls.tab === "detail" && <TrialDetail {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="calibration" className="space-y-3">{controls.tab === "calibration" && <Calibration {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="modalities" className="space-y-3">{controls.tab === "modalities" && <Modalities {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="baserates" className="space-y-3">{controls.tab === "baserates" && <BaseRates {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="audit" className="space-y-3">{controls.tab === "audit" && <AuditRecord {...tabProps} body={body} />}</TabsContent>
            <TabsContent value="gate" className="space-y-3">{controls.tab === "gate" && <Gate body={body} />}</TabsContent>
          </Tabs>
        )}
      </StudyState>
    </div>
  );
}
