import { TerminalTabs } from "@/system/components/TerminalTabs";
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import { TerminalSquare } from "lucide-react";

export default function Terminals() {
  useBreadcrumbs([{ label: "Terminals" }]);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200">
      <div className="flex justify-between items-center px-6 py-4 border-b border-white/[0.05] shrink-0 bg-background/50 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
              <TerminalSquare className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">System Terminals</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-2 ml-1">
            Persistent PowerShell & shell sessions. Isolated from the UI process.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 flex flex-col flex-1 min-h-0 w-full overflow-hidden group">
        <div className="absolute inset-0 bg-gradient-to-br from-primary/5 via-transparent to-primary/5 opacity-0 group-hover:opacity-100 transition-opacity duration-700 pointer-events-none" />
        <div className="flex-1 relative z-10 overflow-hidden">
          <TerminalTabs visible={true} showTrainingTab={true} />
        </div>
      </div>
    </div>
  );
}
