import { Badge } from "@/shared/ui/badge";
import { CheckCircle2, XCircle } from "lucide-react";

export interface ServerConfig {
  questdb: { host: string; httpPort: number; pgPort: number };
  training: {
    pythonExe: string;
    modelsDir: string;
    maxConcurrentJobs: number;
    maxBarsDefault: number;
    maxTrainingDurationSec: number;
  };
  nodeEnv: string;
  port: number;
}

export interface ConnectionTestResult {
  connected: boolean;
  type: string;
  host?: string;
  port?: number;
  error?: string;
  note?: string;
}

export type Preferences = Record<string, Record<string, unknown>>;

export const AVAILABLE_TIMEFRAMES = [
  { value: "1", label: "1m" },
  { value: "5", label: "5m" },
  { value: "15", label: "15m" },
  { value: "30", label: "30m" },
  { value: "60", label: "1H" },
  { value: "240", label: "4H" },
  { value: "1440", label: "1D" },
  { value: "10080", label: "1W" },
];

export function ConnectionBadge({ result }: { result: ConnectionTestResult | null }) {
  if (!result) return <Badge variant="outline">Not tested</Badge>;

  return result.connected ? (
    <Badge variant="default" className="bg-emerald-600 hover:bg-emerald-700 gap-1">
      <CheckCircle2 className="h-3 w-3" />
      Connected
    </Badge>
  ) : (
    <Badge variant="destructive" className="gap-1">
      <XCircle className="h-3 w-3" />
      {result.error || "Failed"}
    </Badge>
  );
}
