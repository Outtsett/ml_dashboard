import { useQuery } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tag, BarChart3 } from "lucide-react";
import type { LabelGenerationProps, LabelSet } from "./types";
import { GenerateTab } from "./GenerateTab";
import { HistoryTab } from "./HistoryTab";

export function LabelGeneration({ selectedSymbol, symbols, onSymbolChange }: LabelGenerationProps) {
  const { data: labelSets, isLoading: loadingLabelSets } = useQuery<LabelSet[]>({
    queryKey: ["/api/labels", selectedSymbol],
    queryFn: async () => {
      const res = await fetch(`/api/labels?symbol=${selectedSymbol}`);
      if (!res.ok) throw new Error("Failed to fetch label sets");
      return res.json();
    },
  });

  return (
    <div className="space-y-4">
      <Tabs defaultValue="generate" className="w-full">
        <TabsList className="bg-black/40 border border-white/10">
          <TabsTrigger value="generate" className="data-[state=active]:bg-primary/20" data-testid="tab-generate">
            <Tag className="h-3.5 w-3.5 mr-1.5" />
            Generate
          </TabsTrigger>
          <TabsTrigger value="history" className="data-[state=active]:bg-primary/20" data-testid="tab-history">
            <BarChart3 className="h-3.5 w-3.5 mr-1.5" />
            History ({labelSets?.length || 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="generate" className="space-y-4 mt-4">
          <GenerateTab
            selectedSymbol={selectedSymbol}
            symbols={symbols}
            onSymbolChange={onSymbolChange}
          />
        </TabsContent>

        <TabsContent value="history" className="mt-4">
          <HistoryTab
            labelSets={labelSets}
            isLoading={loadingLabelSets}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
