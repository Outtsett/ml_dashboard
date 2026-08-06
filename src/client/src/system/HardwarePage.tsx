import { Activity } from 'lucide-react';
import { useBreadcrumbs } from "@/shared/hooks/useBreadcrumbs";
import SystemMatrix from '@/system/SystemMatrixPage';
import Gpu from '@/system/GpuPage';

export default function Hardware() {
  useBreadcrumbs([{ label: 'Hardware' }]);

  return (
    <div className="h-full flex flex-col overflow-hidden animate-in fade-in duration-200">
      <div className="flex justify-between items-center px-6 py-4 border-b border-white/[0.05] shrink-0 bg-background/50 backdrop-blur-md">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg border border-primary/20">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <h1 className="text-4xl font-display font-bold text-foreground tracking-tight">Hardware Control</h1>
          </div>
          <p className="text-sm text-muted-foreground mt-2 ml-1">
            Real-time telemetry for neural cores and graphics fabric.
          </p>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-auto bg-card/5 p-6 space-y-8">
        <SystemMatrix />
        <Gpu />
      </div>
    </div>
  );
}
