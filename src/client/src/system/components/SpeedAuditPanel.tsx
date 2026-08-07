import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/shared/ui/sheet";
import { Badge } from "@/shared/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Button } from "@/shared/ui/button";
import { ScrollArea } from "@/shared/ui/scroll-area";
import { Gauge, ArrowUp, ArrowDown, Zap, Clock, Activity } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";
import type { SpeedMetrics } from "@/system/lib/useSpeedAudit";

// ─── Formatting helpers ─────────────────────────────────────────────────────

function fmtDuration(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

function fmtSize(bytes: number | null): string {
  if (bytes == null) return "—";
  if (bytes >= 1_048_576) return `${(bytes / 1_048_576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

// ─── Web Vitals color coding ────────────────────────────────────────────────

type VitalRating = "good" | "needs-improvement" | "poor";

function rateLcp(ms: number | null): VitalRating {
  if (ms == null) return "good";
  if (ms < 2500) return "good";
  if (ms < 4000) return "needs-improvement";
  return "poor";
}

function rateFid(ms: number | null): VitalRating {
  if (ms == null) return "good";
  if (ms < 100) return "good";
  if (ms < 300) return "needs-improvement";
  return "poor";
}

function rateCls(value: number | null): VitalRating {
  if (value == null) return "good";
  if (value < 0.1) return "good";
  if (value < 0.25) return "needs-improvement";
  return "poor";
}

const ratingColors: Record<VitalRating, string> = {
  good: "text-[hsl(var(--data-pos))]",
  "needs-improvement": "text-amber-500",
  poor: "text-[hsl(var(--data-neg))]",
};

const ratingIcons: Record<VitalRating, string> = {
  good: "✓",
  "needs-improvement": "⚠",
  poor: "✗",
};

// ─── Inline metrics content (shared between sheet and inline tab) ───────────

export function SpeedAuditContent({ metrics }: { metrics: SpeedMetrics }) {
  const last20Api = metrics.entries
    .filter((e) => e.type === "api")
    .slice(-20)
    .map((e, i) => ({
      name: (e.url ?? "").split("/").pop() || `#${i}`,
      latency: Math.round(e.durationMs),
    }));

  const last30 = [...metrics.entries].reverse().slice(0, 30);

  const lcpRating = rateLcp(metrics.lcp);
  const fidRating = rateFid(metrics.fid);
  const clsRating = rateCls(metrics.cls);

  return (
    <div className="space-y-4">
      {/* Row 1: Page Load + Web Vitals */}
      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Page Load
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Load</span>
              <span className="font-mono">{fmtDuration(metrics.pageLoadTime)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">TTFB</span>
              <span className="font-mono">{fmtDuration(metrics.ttfb)}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5" /> Web Vitals
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">LCP</span>
              <span className={`font-mono ${ratingColors[lcpRating]}`}>
                {metrics.lcp != null ? fmtDuration(metrics.lcp) : "—"} {ratingIcons[lcpRating]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">FID</span>
              <span className={`font-mono ${ratingColors[fidRating]}`}>
                {metrics.fid != null ? fmtDuration(metrics.fid) : "—"} {ratingIcons[fidRating]}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">CLS</span>
              <span className={`font-mono ${ratingColors[clsRating]}`}>
                {metrics.cls != null ? metrics.cls.toFixed(3) : "—"} {ratingIcons[clsRating]}
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* API Latency */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Zap className="h-3.5 w-3.5" /> API Latency
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex gap-4 text-sm mb-3">
            <div>
              <span className="text-muted-foreground">Avg: </span>
              <span className="font-mono font-medium">{fmtDuration(metrics.avgApiLatency)}</span>
            </div>
            <div>
              <span className="text-muted-foreground">P95: </span>
              <span className="font-mono font-medium">{fmtDuration(metrics.p95ApiLatency)}</span>
            </div>
          </div>
          {last20Api.length > 0 && (
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={last20Api}>
                <XAxis dataKey="name" tick={false} height={0} />
                <YAxis width={40} tick={{ fontSize: 10 }} />
                <Tooltip
                  formatter={(v: number) => [`${v}ms`, "Latency"]}
                  contentStyle={{ fontSize: 12 }}
                />
                <Bar dataKey="latency" fill="hsl(var(--primary))" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Throughput */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium flex items-center gap-1.5">
            <Gauge className="h-3.5 w-3.5" /> Throughput
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-1 text-sm">
          <div className="flex items-center gap-2">
            <ArrowUp className="h-3.5 w-3.5 text-blue-500" />
            <span className="text-muted-foreground">Upload:</span>
            <span className="font-mono">
              {metrics.avgUploadSpeed > 0 ? `${metrics.avgUploadSpeed.toFixed(1)} MB/s` : "—"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <ArrowDown className="h-3.5 w-3.5 text-[hsl(var(--data-pos))]" />
            <span className="text-muted-foreground">Download:</span>
            <span className="font-mono">
              {metrics.avgDownloadSpeed > 0 ? `${metrics.avgDownloadSpeed.toFixed(1)} MB/s` : "—"}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Recent Requests */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Recent Requests</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <ScrollArea className="h-48">
            <div className="divide-y">
              {last30.length === 0 && (
                <p className="text-muted-foreground text-sm p-4">No requests tracked yet.</p>
              )}
              {last30.map((entry, i) => (
                <div key={i} className="flex items-center justify-between px-4 py-1.5 text-xs font-mono">
                  <span className="truncate max-w-[60%]">
                    {entry.type === "upload" ? (
                      <>
                        <Badge variant="secondary" className="mr-1.5 text-[10px] px-1 py-0">
                          UP
                        </Badge>
                        {entry.filename}
                      </>
                    ) : entry.type === "download" ? (
                      <>
                        <Badge variant="secondary" className="mr-1.5 text-[10px] px-1 py-0">
                          DL
                        </Badge>
                        {entry.url}
                      </>
                    ) : (
                      entry.url
                    )}
                  </span>
                  <span className="flex items-center gap-2 shrink-0">
                    <span className={entry.durationMs > 1000 ? "text-amber-500" : "text-muted-foreground"}>
                      {fmtDuration(entry.durationMs)}
                    </span>
                    {entry.sizeBytes != null && entry.sizeBytes > 0 && (
                      <span className="text-muted-foreground">
                        {entry.type === "upload" && "↑"}
                        {entry.type === "download" && "↓"}
                        {fmtSize(entry.sizeBytes)}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}

// ─── Sheet (slide-out panel) variant ────────────────────────────────────────

export default function SpeedAuditPanel({ metrics }: { metrics: SpeedMetrics }) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-8 w-8" title="Speed Audit">
          <Gauge className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-[420px] sm:max-w-[420px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Gauge className="h-5 w-5" /> Speed Audit
          </SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <SpeedAuditContent metrics={metrics} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
