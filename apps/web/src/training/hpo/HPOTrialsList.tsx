import { Card } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableHead,
  TableRow,
  TableCell,
} from "@/shared/ui/table";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Trophy, ChevronDown } from "lucide-react";
import { cn } from "@/shared/utils/utils";
import type { TrialResult } from "@shared/hpoTypes";

type SortField = "trialId" | "score" | "durationSec";
type SortDir = "asc" | "desc";

interface HPOTrialsListProps {
  trials: TrialResult[];
  sortedTrials: TrialResult[];
  bestTrialId: number | undefined;
  sortField: SortField;
  sortDir: SortDir;
  toggleSort: (field: SortField) => void;
  formatScore: (v: number | null | undefined) => string;
  formatDuration: (sec: number) => string;
  topParamKeys: string[];
  statusStyles: Record<string, string>;
}

export function HPOTrialsList({
  trials,
  sortedTrials,
  bestTrialId,
  sortField,
  sortDir,
  toggleSort,
  formatScore,
  formatDuration,
  topParamKeys,
  statusStyles,
}: HPOTrialsListProps) {
  return (
    <Card className="bg-black/20 border-white/5 overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3 pb-1">
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
          Trial Results
        </h4>
        <span className="text-[9px] text-muted-foreground/40 font-mono">
          {trials.length} trial{trials.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="px-4 pb-3">
        {trials.length === 0 ? (
          <div className="w-full flex items-center justify-center text-muted-foreground min-h-[100px]">
            <p className="text-xs">No trials yet.</p>
          </div>
        ) : (
          <ScrollArea className="max-h-[300px]">
            <Table>
              <TableHeader>
                <TableRow className="border-white/5 hover:bg-transparent">
                  <TableHead
                    className="text-[10px] cursor-pointer select-none w-16"
                    onClick={() => toggleSort("trialId")}
                  >
                    <span className="flex items-center gap-1">
                      Trial
                      {sortField === "trialId" && (
                        <ChevronDown
                          className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                        />
                      )}
                    </span>
                  </TableHead>
                  <TableHead
                    className="text-[10px] cursor-pointer select-none w-28"
                    onClick={() => toggleSort("score")}
                  >
                    <span className="flex items-center gap-1">
                      Score
                      {sortField === "score" && (
                        <ChevronDown
                          className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                        />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="text-[10px] w-20">Status</TableHead>
                  <TableHead
                    className="text-[10px] cursor-pointer select-none w-20"
                    onClick={() => toggleSort("durationSec")}
                  >
                    <span className="flex items-center gap-1">
                      Duration
                      {sortField === "durationSec" && (
                        <ChevronDown
                          className={cn("h-3 w-3 transition-transform", sortDir === "asc" && "rotate-180")}
                        />
                      )}
                    </span>
                  </TableHead>
                  <TableHead className="text-[10px]">Key Params</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedTrials.map((trial) => {
                  const isBest = bestTrialId === trial.trialId;
                  const trialStatus = trial.error
                    ? "failed"
                    : trial.pruned
                      ? "pruned"
                      : "completed";

                  return (
                    <TableRow
                      key={trial.trialId}
                      className={cn(
                        "border-white/5",
                        isBest && "bg-amber-500/5 border-l-2 border-l-amber-500/40",
                      )}
                    >
                      <TableCell className="text-xs font-mono">
                        <span className="flex items-center gap-1.5">
                          {isBest && <Trophy className="h-3 w-3 text-amber-400" />}
                          #{trial.trialId}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <span className={cn(isBest && "text-[hsl(var(--data-pos))] font-semibold")}>
                          {formatScore(trial.score)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-[9px]", statusStyles[trialStatus])}
                        >
                          {trialStatus}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {formatDuration(trial.durationSec)}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 flex-wrap">
                          {topParamKeys.map((key) => {
                            const val = trial.params[key];
                            if (val == null) return null;
                            const display =
                              typeof val === "number"
                                ? Number.isInteger(val)
                                  ? String(val)
                                  : val.toPrecision(3)
                                : String(val);
                            return (
                              <Badge
                                key={key}
                                variant="outline"
                                className="text-[8px] bg-zinc-500/10 text-zinc-400 border-zinc-500/20 font-mono"
                              >
                                {key}={display}
                              </Badge>
                            );
                          })}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </ScrollArea>
        )}
      </div>
    </Card>
  );
}
