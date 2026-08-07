import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { LayoutGrid } from "lucide-react";
import { comparisonData } from "./constants";
import { RatingDots } from "./shared-components";

const axes = [
  { key: "speed", label: "Train Speed", desc: "How fast to train" },
  { key: "dataReq", label: "Data Hunger", desc: "How much data needed" },
  { key: "seqAware", label: "Sequence Aware", desc: "Understands bar order" },
  { key: "longRange", label: "Long Range", desc: "Connects distant bars" },
  { key: "interpret", label: "Interpretable", desc: "Explain its decisions" },
  { key: "gpu", label: "GPU Need", desc: "Compute requirement" },
];

const archColorMap: Record<string, string> = {
  CNN: 'bg-violet-400',
  LSTM: 'bg-amber-400',
  Transformer: 'bg-cyan-400',
  XGBoost: 'bg-[hsl(var(--data-neg))]',
  'CNN+LSTM': 'bg-[hsl(var(--data-pos))]',
};

export function ComparisonMatrix() {
  return (
    <Card className="bg-card/50 border-border/50">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-primary" />
          Side-by-Side Comparison
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/30">
                <th className="text-left py-2 pr-4 text-muted-foreground font-medium w-32">Axis</th>
                {comparisonData.map(d => (
                  <th key={d.arch} className={`text-center py-2 px-3 font-semibold ${d.color}`}>
                    {d.arch}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {axes.map(axis => (
                <tr key={axis.key} className="border-b border-border/10">
                  <td className="py-2.5 pr-4">
                    <div className="font-medium text-foreground/80">{axis.label}</div>
                    <div className="text-[9px] text-muted-foreground">{axis.desc}</div>
                  </td>
                  {comparisonData.map(d => {
                    const val = d[axis.key as keyof typeof d] as number;
                    return (
                      <td key={d.arch} className="text-center py-2.5 px-3">
                        {val === 0 ? (
                          <span className="text-muted-foreground/40 text-[10px]">N/A</span>
                        ) : (
                          <div className="flex justify-center">
                            <RatingDots value={val} activeColor={archColorMap[d.arch] ?? 'bg-primary'} />
                          </div>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
              {/* Params row */}
              <tr>
                <td className="py-2.5 pr-4">
                  <div className="font-medium text-foreground/80">Est. Params</div>
                  <div className="text-[9px] text-muted-foreground">Model size</div>
                </td>
                {comparisonData.map(d => (
                  <td key={d.arch} className="text-center py-2.5 px-3 font-mono text-[10px] text-muted-foreground">
                    {d.params}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
