import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Loader2, Trash2, Tag } from "lucide-react";
import { CATEGORY_COLORS } from "./types";
import type { LabelSet } from "./types";

interface HistoryTabProps {
  labelSets: LabelSet[] | undefined;
  isLoading: boolean;
}

export function HistoryTab({ labelSets, isLoading }: HistoryTabProps) {
  const queryClient = useQueryClient();

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/labels/${id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete label set");
      return res.json();
    },
    onSuccess: () => {
      toast.success("Label set deleted");
      queryClient.invalidateQueries({ queryKey: ["/api/labels"] });
    },
  });

  return (
    <Card className="bg-card/50 border-border">
      <CardContent className="p-0">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : labelSets && labelSets.length > 0 ? (
          <ScrollArea className="h-[400px]">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-card border-b border-white/10">
                <tr className="text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Generator</th>
                  <th className="px-4 py-2">Symbol</th>
                  <th className="px-4 py-2">Samples</th>
                  <th className="px-4 py-2">Distribution</th>
                  <th className="px-4 py-2">Status</th>
                  <th className="px-4 py-2">Created</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {labelSets.map((ls) => {
                  let dist: Record<string, number> | null = null;
                  try {
                    dist = ls.labelDistribution ? JSON.parse(ls.labelDistribution) : null;
                  } catch { /* invalid JSON */ }
                  return (
                    <tr key={ls.id} className="border-b border-white/5 hover:bg-white/5">
                      <td className="px-4 py-2 font-mono">{ls.name}</td>
                      <td className="px-4 py-2">
                        <Badge variant="outline" className={`text-[9px] ${CATEGORY_COLORS[ls.category] || ''}`}>
                          {ls.generatorType}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-cyan-400">{ls.symbol}</td>
                      <td className="px-4 py-2 font-mono">{(ls.sampleCount ?? 0).toLocaleString()}</td>
                      <td className="px-4 py-2">
                        {dist ? (
                          <div className="flex gap-1.5 text-[10px] flex-wrap">
                            {Object.entries(dist)
                              .sort(([a], [b]) => Number(a) - Number(b))
                              .map(([label, count]) => (
                                <span key={label} className={
                                  label === '1' ? 'text-emerald-400' :
                                  label === '-1' ? 'text-rose-400' :
                                  label === '0' ? 'text-slate-400' :
                                  'text-amber-400'
                                }>
                                  {label}:{count}
                                </span>
                              ))}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-[10px]">—</span>
                        )}
                      </td>
                      <td className="px-4 py-2">
                        <Badge
                          variant="outline"
                          className={ls.status === 'completed' ? 'bg-emerald-500/20 text-emerald-400' :
                                     ls.status === 'failed' ? 'bg-rose-500/20 text-rose-400' :
                                     'bg-amber-500/20 text-amber-400'}
                        >
                          {ls.status}
                        </Badge>
                      </td>
                      <td className="px-4 py-2 text-muted-foreground text-xs">
                        {new Date(ls.createdAt).toLocaleDateString()}
                      </td>
                      <td className="px-4 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => deleteMutation.mutate(ls.id)}
                          data-testid={`btn-delete-${ls.id}`}
                        >
                          <Trash2 className="h-3.5 w-3.5 text-rose-400" />
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ScrollArea>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            <Tag className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p className="text-sm">No label sets generated yet</p>
            <p className="text-xs mt-1">Generate labels using the form above</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
