import { useState, useEffect } from "react";
import { Button } from "@/shared/ui/button";
import { Input } from "@/shared/ui/input";
import { Loader2, Play, ExternalLink, Database, FileText } from "lucide-react";
import { useToast } from "@/shared/hooks/use-toast";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/shared/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/shared/ui/tabs";

/** The two panes the explorer can source a table from. */
type SourceMode = "file" | "questdb";

export function DTaleExplorer() {
  const [sourceMode, setSourceMode] = useState<SourceMode>("questdb");
  const [filename, setFilename] = useState("BTCUSDT-1m.parquet");
  
  const [questdbTable, setQuestdbTable] = useState<string>("ohlcv");
  const [sampleBy, setSampleBy] = useState<string>("1h");
  const [availableTables, setAvailableTables] = useState<string[]>([]);
  
  const [isLoading, setIsLoading] = useState(false);
  const [dtaleUrl, setDtaleUrl] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    // Fetch QuestDB tables on mount
    fetch('/api/databases/tables?db=questdb')
      .then(res => res.json())
      .then(data => {
        if (data.tables) setAvailableTables(data.tables);
      })
      .catch(err => console.error("Failed to load QuestDB tables:", err));
  }, []);

  const handleLaunch = async () => {
    setIsLoading(true);
    setDtaleUrl(null);
    try {
      const body = sourceMode === "file" 
        ? { source: "file", filename }
        : { source: "questdb", table: questdbTable, sampleBy };

      const res = await fetch('/api/databases/dtale/launch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to launch D-Tale');
      
      setDtaleUrl(data.url);
      const targetName = sourceMode === "file" ? filename : `${questdbTable} (${sampleBy === 'raw' ? '1M Limit' : sampleBy})`;
      toast({ title: "D-Tale Server Launched", description: `Serving ${targetName} on ${data.url}` });
    } catch (error: unknown) {
      const description = error instanceof Error ? error.message : String(error);
      toast({ title: "Error launching D-Tale", description, variant: "destructive" });
    } finally {
      setIsLoading(false);
    }
  };

  const isLaunchDisabled = isLoading || (sourceMode === "file" && !filename) || (sourceMode === "questdb" && !questdbTable);

  return (
    <div className="flex flex-col h-full gap-4 border border-white/5 bg-black/20 rounded-xl p-4">
      <div className="flex flex-col md:flex-row gap-4 items-end">
        
        <Tabs value={sourceMode} onValueChange={(v) => setSourceMode(v as SourceMode)} className="w-[300px]">
          <TabsList className="grid w-full grid-cols-2 bg-black/40 border border-white/10">
            <TabsTrigger value="questdb"><Database className="w-4 h-4 mr-2" /> QuestDB</TabsTrigger>
            <TabsTrigger value="file"><FileText className="w-4 h-4 mr-2" /> Local File</TabsTrigger>
          </TabsList>
        </Tabs>

        {sourceMode === "file" ? (
          <div className="flex-grow space-y-2">
            <label className="text-xs text-neutral-400 font-medium uppercase tracking-wider">Dataset path (relative to E:\\lake)</label>
            <Input 
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              placeholder="e.g. BTCUSDT_OHLCV.parquet"
              className="bg-black/40 border-white/10"
            />
          </div>
        ) : (
          <>
            <div className="flex-grow space-y-2">
              <label className="text-xs text-neutral-400 font-medium uppercase tracking-wider">Table</label>
              <Select value={questdbTable} onValueChange={setQuestdbTable}>
                <SelectTrigger className="bg-black/40 border-white/10">
                  <SelectValue placeholder="Select Table" />
                </SelectTrigger>
                <SelectContent>
                  {availableTables.length > 0 ? (
                    availableTables.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)
                  ) : (
                    <SelectItem value="ohlcv">ohlcv</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[200px] space-y-2">
              <label className="text-xs text-neutral-400 font-medium uppercase tracking-wider">Compression</label>
              <Select value={sampleBy} onValueChange={setSampleBy}>
                <SelectTrigger className="bg-black/40 border-white/10">
                  <SelectValue placeholder="Sample By" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="raw">None (Max 1M Rows)</SelectItem>
                  <SelectItem value="1m">1 Minute</SelectItem>
                  <SelectItem value="5m">5 Minutes</SelectItem>
                  <SelectItem value="15m">15 Minutes</SelectItem>
                  <SelectItem value="1h">1 Hour</SelectItem>
                  <SelectItem value="4h">4 Hours</SelectItem>
                  <SelectItem value="1d">1 Day</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        <Button onClick={handleLaunch} disabled={isLaunchDisabled} className="bg-[hsl(var(--accent)/0.15)] text-(--color-accent) hover:bg-[hsl(var(--accent)/0.25)] border border-[hsl(var(--accent)/0.4)]">
          {isLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
          Launch D-Tale
        </Button>
        {dtaleUrl && (
          <Button variant="outline" onClick={() => window.open(dtaleUrl, '_blank')} className="border-white/10">
            <ExternalLink className="w-4 h-4 mr-2" />
            Open
          </Button>
        )}
      </div>

      <div className="flex-grow min-h-[600px] border border-white/10 rounded-lg overflow-hidden bg-white/[0.02]">
        {dtaleUrl ? (
          <iframe 
            src={dtaleUrl} 
            className="w-full h-full border-0"
            title="D-Tale Explorer"
          />
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-neutral-500">
            <div className="w-16 h-16 rounded-full bg-white/5 flex items-center justify-center mb-4">
              <Play className="w-6 h-6 opacity-50" />
            </div>
            <p>Select a data source and launch D-Tale to explore it interactively.</p>
          </div>
        )}
      </div>
    </div>
  );
}
