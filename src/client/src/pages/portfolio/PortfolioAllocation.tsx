import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { PieChart as PieChartIcon } from "lucide-react";
import type { AllocationEntry } from "./types";

interface PortfolioAllocationProps {
  allocationData: AllocationEntry[];
}

export function PortfolioAllocation({ allocationData }: PortfolioAllocationProps) {
  return (
    <Card className="glass rounded-2xl gradient-border flex-1 min-h-0 flex flex-col">
      <CardHeader className="border-b border-white/5 shrink-0">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <PieChartIcon className="h-4 w-4 text-accent" /> Allocation
        </CardTitle>
      </CardHeader>
      <CardContent className="flex-1 min-h-0 p-4">
        {allocationData.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
            <PieChartIcon className="h-10 w-10 mb-2 opacity-20" />
            <p className="text-xs">No positions to allocate</p>
          </div>
        ) : (
          <>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={allocationData}
                  cx="50%"
                  cy="50%"
                  innerRadius={40}
                  outerRadius={70}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {allocationData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsla(250, 25%, 14%, 0.9)",
                    backdropFilter: "blur(10px)",
                    borderColor: "hsla(260, 80%, 70%, 0.2)",
                    borderRadius: "12px",
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="grid grid-cols-2 gap-2 mt-2">
              {allocationData.map((item, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <div
                    className="h-2 w-2 rounded-full"
                    style={{ backgroundColor: item.color }}
                  />
                  <span className="text-muted-foreground">{item.name}</span>
                  <span className="ml-auto font-mono">{item.value}%</span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
