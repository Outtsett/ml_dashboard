/**
 * TA-indicator strategy vs 600 MNQ ticks a day: the notebook's fifteen sections as nine tabs. Each tab reads
 * only its own parts of GET /api/studies/ta-strategy-600-ticks, so opening the page reads nothing heavy.
 */

import type { ReactNode } from "react";
import { Stat, StudyNotes, fmt, useStudyControls, OKABE } from "@/studies/kit";
import type { OverviewBody } from "@shared/studies/ta-strategy-600-ticks";
import { useTa } from "./common";
import { DEFAULTS, FALLBACK_OVERVIEW, type TabProps } from "./controls";
import { GoalTab } from "./GoalTab";
import { BatteryTab } from "./BatteryTab";
import { RulesTab } from "./RulesTab";
import { ConditionalTab } from "./ConditionalTab";
import { FrequencyTab } from "./FrequencyTab";
import { SeasonTab } from "./SeasonTab";
import { CascadeTab } from "./CascadeTab";
import { ZonesTab } from "./ZonesTab";
import { BuildTab } from "./BuildTab";

const TABS: Array<{ id: string; label: string; sections: string; render: (props: TabProps) => ReactNode }> = [
  { id: "goal", label: "Goal", sections: "1", render: (props) => <GoalTab {...props} /> },
  { id: "battery", label: "Model battery", sections: "2-8", render: (props) => <BatteryTab {...props} /> },
  { id: "rules", label: "TA-Lib rules", sections: "9", render: (props) => <RulesTab {...props} /> },
  { id: "conditional", label: "Levels & templates", sections: "10", render: (props) => <ConditionalTab {...props} /> },
  { id: "frequency", label: "Frequency", sections: "11", render: (props) => <FrequencyTab {...props} /> },
  { id: "season", label: "Time of day", sections: "12", render: (props) => <SeasonTab {...props} /> },
  { id: "cascade", label: "Cascade", sections: "13", render: (props) => <CascadeTab {...props} /> },
  { id: "zones", label: "Zones at the touch", sections: "14", render: (props) => <ZonesTab {...props} /> },
  { id: "build", label: "How a zone is built", sections: "15", render: (props) => <BuildTab {...props} /> },
];

export default function Page() {
  const [controls, set, reset] = useStudyControls(DEFAULTS);
  const overviewQuery = useTa<OverviewBody>("overview");
  const overview = overviewQuery.data?.data ?? FALLBACK_OVERVIEW;
  const active = TABS.find((tab) => tab.id === controls.tab) ?? TABS[0];

  return (
    <div className="min-w-0 space-y-3">
      <StudyNotes notes={overviewQuery.data?.notes ?? []} />
      <div className="grid gap-2 grid-cols-2 xl:grid-cols-4">
        <Stat label="Goal, one contract" value={`${fmt(overview.goalTicks, 0)} ticks/day`} hint="150 index points = 300 USD a day on one MNQ contract" />
        <Stat label="One tick" value={`${fmt(overview.tickSizePoints, 2)} pt = $${fmt(overview.tickValueUsd, 2)}`} />
        <Stat label="Round trip cost" value={`${fmt(overview.costTicks, 2)} ticks`} hint="two sides, MNQ (packages/config/cost_model.json)" tone={OKABE.blue} />
        <Stat label="Cost per side" value={`$${fmt(overview.costPerSideUsd, 2)}`} hint="fees plus one tick of slippage per side (packages/config/cost_model.json)" />
      </div>
      <p className="text-[10px] text-neutral-500">Cost model: {overview.costSource}</p>
      <nav className="flex flex-wrap gap-1 border-b border-neutral-800 pb-2" aria-label="Study sections">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => set("tab", tab.id)}
            aria-pressed={tab.id === active?.id}
            className={`rounded px-2 py-1 text-[11px] ${tab.id === active?.id ? "bg-neutral-700 text-neutral-50" : "text-neutral-400 hover:bg-neutral-800"}`}
          >
            <span className="font-mono text-neutral-500">§{tab.sections}</span> {tab.label}
          </button>
        ))}
        <button type="button" onClick={reset} className="ml-auto rounded border border-neutral-800 px-2 py-1 text-[11px] text-neutral-500 hover:text-neutral-200"
          title="Every control back to the notebook's defaults">
          Reset all controls
        </button>
      </nav>
      {active?.render({ controls, set, overview })}
    </div>
  );
}
