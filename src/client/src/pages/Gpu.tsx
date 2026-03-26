import { useMemo } from "react";
import { motion, type Variants } from "framer-motion";
import { Badge } from "@/components/ui/badge";
import { useGpuMetrics, useGpuDeviceInfo } from "@/hooks/useGpuMetrics";
import {
  AreaChart,
  Area,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";
import { Cpu, Thermometer, Zap, MemoryStick, Monitor, Activity, Gauge } from "lucide-react";
import { cn } from "@/lib/utils";

// ── Animation variants ───────────────────────────────────────

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

// ── Helpers ──────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d.getSeconds().toString().padStart(2, "0")}`;
}

function statusHue(value: number, thresholds: [number, number] = [50, 80]): string {
  if (value < thresholds[0]) return "#22c55e"; // emerald
  if (value < thresholds[1]) return "#f59e0b"; // amber
  return "#ef4444"; // red
}

function statusClass(value: number, thresholds: [number, number] = [50, 80]): string {
  if (value < thresholds[0]) return "text-emerald-400";
  if (value < thresholds[1]) return "text-amber-400";
  return "text-red-400";
}

// ── Radial Gauge (SVG) ──────────────────────────────────────

function RadialGauge({ value, max, label, unit, color, size = 140, icon: Icon }: {
  value: number;
  max: number;
  label: string;
  unit: string;
  color: string;
  size?: number;
  icon: typeof Cpu;
}) {
  const r = (size - 16) / 2;
  const circumference = 2 * Math.PI * r;
  const pct = Math.min(value / max, 1);
  const offset = circumference * (1 - pct * 0.75); // 270-degree arc
  const center = size / 2;

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="transform rotate-[135deg]">
          {/* Track */}
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke="hsl(220, 15%, 15%)"
            strokeWidth={6}
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeLinecap="round"
          />
          {/* Value arc */}
          <circle
            cx={center} cy={center} r={r}
            fill="none"
            stroke={color}
            strokeWidth={6}
            strokeDasharray={`${circumference * 0.75} ${circumference * 0.25}`}
            strokeDashoffset={offset}
            strokeLinecap="round"
            className="transition-all duration-700 ease-out"
            style={{
              filter: `drop-shadow(0 0 6px ${color}60)`,
            }}
          />
        </svg>
        {/* Center content */}
        <div className="absolute inset-0 flex flex-col items-center justify-center transform rotate-0">
          <Icon className="h-4 w-4 mb-0.5" style={{ color, opacity: 0.6 }} />
          <span className="text-2xl font-display font-bold tracking-tight" style={{ color }}>
            {typeof value === "number" ? Math.round(value) : value}
          </span>
          <span className="text-[10px] text-muted-foreground font-mono">{unit}</span>
        </div>
      </div>
      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">{label}</span>
    </div>
  );
}

// ── VRAM Bar ─────────────────────────────────────────────────

function VramBar({ usedMB, totalMB, pct }: { usedMB: number; totalMB: number; pct: number }) {
  const usedGB = (usedMB / 1024).toFixed(1);
  const totalGB = (totalMB / 1024).toFixed(1);
  const freeGB = ((totalMB - usedMB) / 1024).toFixed(1);
  const color = statusHue(pct, [50, 75]);

  return (
    <motion.div variants={fadeUp} className="glass rounded-xl p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <MemoryStick className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">VRAM Allocation</span>
        </div>
        <span className="text-xs font-mono text-muted-foreground">{usedGB} / {totalGB} GB</span>
      </div>

      {/* Main bar */}
      <div className="relative h-6 rounded-md overflow-hidden" style={{ background: "hsl(220, 15%, 10%)" }}>
        {/* Gradient fill */}
        <div
          className="absolute inset-y-0 left-0 rounded-md transition-all duration-700 ease-out"
          style={{
            width: `${Math.min(pct, 100)}%`,
            background: `linear-gradient(90deg, ${color}40, ${color}cc)`,
            boxShadow: `0 0 20px -2px ${color}40`,
          }}
        />
        {/* Tick marks */}
        {[25, 50, 60, 75].map((tick) => (
          <div
            key={tick}
            className="absolute top-0 bottom-0 w-px"
            style={{ left: `${tick}%`, background: "hsla(220, 15%, 30%, 0.4)" }}
          />
        ))}
        {/* Center label */}
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xs font-mono font-bold drop-shadow-sm">
            {pct.toFixed(1)}%
          </span>
        </div>
      </div>

      {/* Stat row */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: "Used", value: `${usedGB} GB`, color: "text-foreground" },
          { label: "Free", value: `${freeGB} GB`, color: "text-emerald-400" },
          { label: "Target", value: "50-60%", color: "text-muted-foreground" },
        ].map((s) => (
          <div key={s.label} className="text-center">
            <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
            <p className={cn("text-sm font-mono font-bold", s.color)}>{s.value}</p>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Metric Chart (glass card) ────────────────────────────────

function MetricChart({ data, dataKey, label, color, unit, domain }: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  label: string;
  color: string;
  unit?: string;
  domain?: [number, number];
}) {
  const lastVal = data.length > 0 ? (data[data.length - 1] as Record<string, string | number>)[dataKey] : null;

  return (
    <motion.div variants={fadeUp} className="glass rounded-xl p-4 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
        {lastVal != null && (
          <span className="text-sm font-mono font-bold" style={{ color }}>
            {typeof lastVal === "number" ? lastVal.toFixed(1) : lastVal}{unit ?? ""}
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <AreaChart data={data}>
          <defs>
            <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.3} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(220, 15%, 15%, 0.6)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: "hsl(220, 10%, 40%)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: "hsl(220, 10%, 40%)" }}
            axisLine={false}
            tickLine={false}
            domain={domain ?? ["auto", "auto"]}
            width={35}
          />
          <Tooltip
            contentStyle={{
              background: "hsla(220, 15%, 8%, 0.9)",
              backdropFilter: "blur(12px)",
              border: "1px solid hsla(220, 15%, 20%, 0.3)",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
            }}
            formatter={(value: number) => [`${value.toFixed(1)}${unit ?? ""}`, label]}
          />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            fill={`url(#grad-${dataKey})`}
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

function DualMetricChart({ data, keys, labels, colors, unit, domain }: {
  data: Array<Record<string, string | number>>;
  keys: [string, string];
  labels: [string, string];
  colors: [string, string];
  unit?: string;
  domain?: [number, number];
}) {
  return (
    <motion.div variants={fadeUp} className="glass rounded-xl p-4 space-y-2">
      <div className="flex items-center gap-4">
        {labels.map((l, i) => (
          <div key={l} className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full" style={{ background: colors[i] }} />
            <span className="text-xs text-muted-foreground">{l}</span>
          </div>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={140}>
        <LineChart data={data}>
          <CartesianGrid strokeDasharray="2 4" stroke="hsla(220, 15%, 15%, 0.6)" />
          <XAxis
            dataKey="time"
            tick={{ fontSize: 9, fill: "hsl(220, 10%, 40%)" }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 9, fill: "hsl(220, 10%, 40%)" }}
            axisLine={false}
            tickLine={false}
            domain={domain ?? ["auto", "auto"]}
            width={35}
          />
          <Tooltip
            contentStyle={{
              background: "hsla(220, 15%, 8%, 0.9)",
              backdropFilter: "blur(12px)",
              border: "1px solid hsla(220, 15%, 20%, 0.3)",
              borderRadius: 6,
              fontSize: 11,
              fontFamily: "'JetBrains Mono', monospace",
            }}
          />
          <Line type="monotone" dataKey={keys[0]} stroke={colors[0]} strokeWidth={1.5} dot={false} name={labels[0]} isAnimationActive={false} />
          <Line type="monotone" dataKey={keys[1]} stroke={colors[1]} strokeWidth={1.5} dot={false} name={labels[1]} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </motion.div>
  );
}

// ── Device Info Panel ────────────────────────────────────────

function DeviceInfoPanel({ deviceInfo, current }: {
  deviceInfo: ReturnType<typeof useGpuDeviceInfo>["data"] | null;
  current: ReturnType<typeof useGpuMetrics>["current"];
}) {
  const d = deviceInfo;
  const rows = useMemo(() => [
    { label: "Architecture", value: d?.architecture ?? "--" },
    { label: "Compute Capability", value: d?.computeCapability ?? "--" },
    { label: "CUDA Version", value: d?.cudaVersion ?? "--" },
    { label: "Driver", value: d?.driverVersion ?? "--" },
    { label: "VRAM", value: d ? `${(d.memoryTotalMB / 1024).toFixed(0)} GB GDDR7` : "--" },
    { label: "PCI Bus", value: d?.pciBusId ?? "--" },
    { label: "Fan", value: current ? `${current.fanSpeedPct}%` : "--" },
    { label: "Power Limit", value: current ? `${current.powerLimitW.toFixed(0)} W` : "--" },
    { label: "Memory Clock", value: current ? `${current.clockMemoryMHz} MHz` : "--" },
  ], [d, current]);

  return (
    <motion.div variants={fadeUp} className="glass rounded-xl p-5">
      <div className="flex items-center gap-2 mb-4">
        <Monitor className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Device Specifications</span>
      </div>
      <div className="grid grid-cols-3 gap-x-6 gap-y-0">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between py-2 border-b border-border/20">
            <span className="text-xs text-muted-foreground">{row.label}</span>
            <span className="text-xs font-mono font-medium">{row.value}</span>
          </div>
        ))}
      </div>
    </motion.div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function Gpu() {
  const { current, history, connected } = useGpuMetrics();
  const { data: deviceInfo } = useGpuDeviceInfo();

  const chartData = useMemo(() =>
    history.map((s) => ({
      time: formatTime(s.timestamp),
      utilGpu: s.utilizationGpu,
      utilMem: s.utilizationMemory,
      vramPct: s.memoryUsedPct,
      temp: s.temperatureC,
      power: s.powerDrawW,
      clockGfx: s.clockGraphicsMHz,
      clockMem: s.clockMemoryMHz,
    })),
    [history],
  );

  const gpuUtil = current?.utilizationGpu ?? 0;
  const temp = current?.temperatureC ?? 0;
  const power = current?.powerDrawW ?? 0;
  const vramPct = current?.memoryUsedPct ?? 0;
  const clockGfx = current?.clockGraphicsMHz ?? 0;

  return (
    <motion.div
      className="space-y-6"
      variants={stagger}
      initial="hidden"
      animate="show"
    >
      {/* ── Header ────────────────────────────────────────── */}
      <motion.div variants={fadeUp} className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-display font-bold tracking-tight">
            {deviceInfo?.name ?? "GPU Monitor"}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {deviceInfo
              ? `${deviceInfo.architecture} | CUDA ${deviceInfo.cudaVersion} | Driver ${deviceInfo.driverVersion}`
              : "Connecting to GPU telemetry..."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="font-mono text-[10px]">
            CC {deviceInfo?.computeCapability ?? "--"}
          </Badge>
          <Badge
            variant={connected ? "default" : "destructive"}
            className="flex items-center gap-1.5"
          >
            {connected && (
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
            )}
            {connected ? "Live" : "Disconnected"}
          </Badge>
        </div>
      </motion.div>

      {/* ── Gauge Cluster ─────────────────────────────────── */}
      <motion.div
        variants={fadeUp}
        className="glass rounded-xl p-6"
        style={{
          boxShadow: connected ? `0 0 40px -12px ${statusHue(gpuUtil)}20` : undefined,
        }}
      >
        <div className="flex items-center justify-around flex-wrap gap-6">
          <RadialGauge
            value={gpuUtil}
            max={100}
            label="Utilization"
            unit="%"
            color={statusHue(gpuUtil)}
            icon={Gauge}
            size={150}
          />
          <RadialGauge
            value={vramPct}
            max={100}
            label="VRAM"
            unit="%"
            color={statusHue(vramPct, [50, 75])}
            icon={MemoryStick}
            size={150}
          />
          <RadialGauge
            value={temp}
            max={100}
            label="Temperature"
            unit="°C"
            color={statusHue(temp, [55, 75])}
            icon={Thermometer}
            size={150}
          />
          <RadialGauge
            value={power}
            max={current?.powerLimitW ?? 180}
            label="Power"
            unit="W"
            color={statusHue(power / (current?.powerLimitW ?? 180) * 100, [60, 85])}
            icon={Zap}
            size={150}
          />
          <RadialGauge
            value={clockGfx}
            max={2800}
            label="Core Clock"
            unit="MHz"
            color="#8b5cf6"
            icon={Activity}
            size={150}
          />
        </div>
      </motion.div>

      {/* ── VRAM Bar (always rendered — zero-data shows 0.0 GB / 0.0 GB) ── */}
      <VramBar
        usedMB={current?.memoryUsedMB ?? 0}
        totalMB={current?.memoryTotalMB ?? 16384}
        pct={current?.memoryUsedPct ?? 0}
      />

      {/* ── Time-Series Charts (always rendered — empty axes when no data) ── */}
      <motion.div variants={stagger} className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <MetricChart data={chartData} dataKey="utilGpu" label="GPU Utilization" color="#22c55e" unit="%" domain={[0, 100]} />
        <MetricChart data={chartData} dataKey="vramPct" label="VRAM Usage" color="#3b82f6" unit="%" domain={[0, 100]} />
        <MetricChart data={chartData} dataKey="temp" label="Temperature" color="#f59e0b" unit="°C" domain={[20, 100]} />
        <MetricChart data={chartData} dataKey="power" label="Power Draw" color="#ef4444" unit="W" />
        <DualMetricChart data={chartData} keys={["clockGfx", "clockMem"]} labels={["Graphics Clock", "Memory Clock"]} colors={["#8b5cf6", "#06b6d4"]} unit=" MHz" />
        <DualMetricChart data={chartData} keys={["utilGpu", "utilMem"]} labels={["GPU Util", "Memory Util"]} colors={["#22c55e", "#3b82f6"]} unit="%" domain={[0, 100]} />
      </motion.div>

      {/* ── Device Info (always rendered — placeholders when loading) ── */}
      <DeviceInfoPanel deviceInfo={deviceInfo ?? null} current={current} />
    </motion.div>
  );
}
