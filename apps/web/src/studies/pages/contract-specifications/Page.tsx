/**
 * Stock-index futures: tick, exchange, contract size, months, rolls and hours.
 * Replaced notebooks/contract_specifications.py. The specification table is the
 * dashboard's own config (shared/instruments.ts); rolls and hours come from
 * GET /api/studies/contract-specifications over the lake.
 */

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/shared/ui/tabs";
import { StudyNotes, StudyState, useStudyControls, useStudyQuery } from "@/studies/kit";
import { SPECIFICATION_SOURCE, specificationRows, type ContractSpecificationsBody } from "@shared/studies/contract-specifications";
import { DEFAULTS, type Controls, type SetControl } from "./controls";
import { SpecificationsTab } from "./SpecificationsTab";
import { FormulaTab } from "./FormulaTab";
import { RollsTab } from "./RollsTab";
import { HoursTab } from "./HoursTab";
import { UsageTab } from "./UsageTab";

const TABS = [
  { value: "specifications", label: "Specifications" },
  { value: "formula", label: "Tick value and profit" },
  { value: "months", label: "Months and rolls" },
  { value: "hours", label: "Hours" },
  { value: "usage", label: "Where it is used" },
] as const;

const ROWS = specificationRows();

export default function Page() {
  const [controls, set] = useStudyControls(DEFAULTS);
  const query = useStudyQuery<ContractSpecificationsBody>("contract-specifications", {
    rollRoot: controls.rollRoot,
    rollYear: controls.rollYear,
    hoursRoot: controls.hoursRoot,
    hoursSeries: controls.hoursSeries,
  });
  const body = query.data?.data;
  const typedControls: Controls = controls;
  const typedSet = set as SetControl;

  return (
    <div className="space-y-3">
      <p className="max-w-prose text-[12px] leading-relaxed text-neutral-300">
        Think of each contract as a fixed-size bet on an index number. The exchange sets three things: how big one step of the price is (the tick), how much money one step moves for one contract (the tick value), and which months the contract expires in. Everything a simulator turns into dollars follows from those three.
        Numbers: AMP Futures, retrieved {SPECIFICATION_SOURCE.retrievedOn}, {SPECIFICATION_SOURCE.contractCount} contracts.
      </p>
      <StudyNotes notes={query.data?.notes ?? []} />
      <Tabs value={controls.tab} onValueChange={(value) => set("tab", value)} className="min-w-0">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value} className="text-xs">{tab.label}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="specifications" className="mt-3">
          <SpecificationsTab rows={ROWS} controls={typedControls} set={typedSet} />
        </TabsContent>
        <TabsContent value="formula" className="mt-3">
          <FormulaTab rows={ROWS} controls={typedControls} set={typedSet} />
        </TabsContent>
        <TabsContent value="months" className="mt-3">
          <StudyState isLoading={query.isLoading} error={query.error}>
            <RollsTab rolls={body?.rolls} coverage={body?.coverage ?? []} controls={typedControls} set={typedSet} />
          </StudyState>
        </TabsContent>
        <TabsContent value="hours" className="mt-3">
          <StudyState isLoading={query.isLoading} error={query.error}>
            <HoursTab hours={body?.hours} controls={typedControls} set={typedSet} />
          </StudyState>
        </TabsContent>
        <TabsContent value="usage" className="mt-3">
          <StudyState isLoading={query.isLoading} error={query.error}>
            <UsageTab rows={ROWS} coverage={body?.coverage ?? []} />
          </StudyState>
        </TabsContent>
      </Tabs>
    </div>
  );
}
