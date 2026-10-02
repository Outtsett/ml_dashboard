import { useMemo } from "react";
import { motion, type Variants } from "framer-motion";
import { useSystemMatrix, type SystemSnapshot } from "@/system/lib/useSystemMatrix";
import { useGpuMetrics } from "@/system/lib/useGpuMetrics";
import {
  Cpu,
  MemoryStick,
  Network,
  Activity,
  Zap,
  Thermometer,
  Gauge,
  Monitor,
  Layers,
  ArrowUpRight,
  ArrowDownLeft,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/shared/utils/utils";
import {
  AreaChart,
  Area,
  ResponsiveContainer,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip
} from "recharts";

const stagger: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 20 },
  show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } },
};

// --- Formatters ---
const formatBytes = (bytes: number) => {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
};

const formatTime = (ts: number) => {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
};

// --- High-Tech Core Grid Component ---
function CoreGrid({ cores }: { cores: number[] }) {
  const hasCores = cores && cores.length > 0;
  return (
    <motion.div variants={fadeUp} className="glass rounded-2xl p-5 space-y-4 border border-white/[0.05] shadow-2xl relative overflow-hidden group">
      <div className="absolute inset-0 bg-gradient-to-br from-[hsl(var(--data-pos)/0.05)] via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-700" />
      <div className="flex items-center justify-between relative z-10">
        <div className="flex items-center gap-2">
          <Cpu className="h-4 w-4 text-[hsl(var(--data-pos))]" />
          <span className="text-sm font-bold uppercase tracking-wider text-foreground/80">Neural Core Matrix</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground">{hasCores ? cores.length : "--"} CORES ACTIVE</span>
      </div>
      
      <div className="grid grid-cols-6 sm:grid-cols-8 gap-1 relative z-10 min-h-[100px]">
        {hasCores ? cores.map((load, i) => (
          <div key={i} className="aspect-square rounded-[2px] bg-white/[0.02] border border-white/[0.05] relative overflow-hidden group/core">
            <motion.div 
              animate={{ 
                height: `${load}%`,
                backgroundColor: load > 80 ? "#0072B2" : load > 50 ? "#f59e0b" : "#E69F00"
              }}
              transition={{ type: "spring", stiffness: 100, damping: 30 }}
              className="absolute bottom-0 left-0 right-0 opacity-40"
            />
            <div className="absolute inset-0 flex items-center justify-center">
              <span className="text-[7px] font-mono font-bold opacity-0 group-hover/core:opacity-100 transition-opacity">{Math.round(load)}</span>
            </div>
          </div>
        )) : (
          <div className="col-span-full h-full flex items-center justify-center opacity-20">
            <span className="text-xs font-mono animate-pulse">Awaiting neural core sync...</span>
          </div>
        )}
      </div>
    </motion.div>
  );
}

// --- Glass Metric Card ---
interface MatrixCardProps {
  title: string;
  value: string | number;
  unit: string;
  icon: LucideIcon;
  color: string;
  trend?: number;
}

function MatrixCard({ title, value, unit, icon: Icon, color, trend }: MatrixCardProps) {
  return (
    <motion.div variants={fadeUp} className="glass rounded-2xl p-5 border border-white/[0.05] hover:border-white/[0.1] transition-all duration-300 group shadow-lg">
      <div className="flex items-start justify-between">
        <div className="p-2.5 rounded-xl bg-white/[0.03] group-hover:scale-110 transition-transform duration-200" style={{ color }}>
          <Icon className="h-5 w-5" />
        </div>
        {trend && (
          <div className={cn("flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-full", trend > 0 ? "bg-[hsl(var(--data-pos)/0.1)] text-[hsl(var(--data-pos))]" : "bg-[hsl(var(--data-neg)/0.1)] text-[hsl(var(--data-neg))]")}>
            {trend > 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownLeft className="h-3 w-3" />}
            {Math.abs(trend).toFixed(1)}%
          </div>
        )}
      </div>
      <div className="mt-4 space-y-1">
        <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-[0.2em]">{title}</p>
        <div className="flex items-baseline gap-1">
          <h3 className="text-3xl font-display font-bold tracking-tighter">{value}</h3>
          <span className="text-xs font-mono text-muted-foreground">{unit}</span>
        </div>
      </div>
    </motion.div>
  );
}

// --- Immersion Page ---

// --- Btop-style Process List ---
function ProcessList({ processes }: { processes?: SystemSnapshot["processes"] }) {
  return (
    <motion.div variants={fadeUp} className="glass rounded-2xl border border-white/[0.05] overflow-hidden">
      <div className="p-4 border-b border-white/[0.05] flex items-center justify-between bg-white/[0.01]">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <span className="text-sm font-bold uppercase tracking-wider">Top Processes</span>
        </div>
        <span className="text-[10px] font-mono text-muted-foreground uppercase">Sorted by CPU</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="text-[9px] font-mono text-muted-foreground uppercase tracking-widest border-b border-white/[0.03]">
              <th className="px-4 py-2 font-medium">PID</th>
              <th className="px-4 py-2 font-medium">Program</th>
              <th className="px-4 py-2 font-medium text-right">CPU%</th>
              <th className="px-4 py-2 font-medium text-right">Mem</th>
            </tr>
          </thead>
          <tbody className="text-[11px] font-mono">
            {processes?.map((proc, i) => (
              <tr key={proc.pid} className={cn("border-b border-white/[0.01] hover:bg-white/[0.02] transition-colors", i % 2 === 0 ? "bg-transparent" : "bg-white/[0.005]")}>
                <td className="px-4 py-1.5 text-muted-foreground">{proc.pid}</td>
                <td className="px-4 py-1.5 font-bold text-foreground/90">{proc.name}</td>
                <td className="px-4 py-1.5 text-right text-[hsl(var(--data-pos))]">{proc.cpu.toFixed(1)}</td>
                <td className="px-4 py-1.5 text-right text-blue-400">{proc.mem}MB</td>
              </tr>
            ))}
            {(!processes || processes.length === 0) && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground opacity-30 italic">Synchronizing process tree...</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </motion.div>
  );
}

export default function SystemMatrix() {
  const { current: sys, history: sysHistory, connected: sysConnected } = useSystemMatrix();
  const { current: gpu } = useGpuMetrics();

  const chartData = useMemo(() => {
    return sysHistory.map(s => ({
      time: formatTime(s.timestamp),
      cpu: s.cpu.load,
      mem: (s.mem.active / s.mem.total) * 100,
      netUp: s.network.tx_sec / 1024 / 1024,
      netDown: s.network.rx_sec / 1024 / 1024,
    }));
  }, [sysHistory]);

  const latestCpu = sys?.cpu.load || 0;
  const latestMem = sys ? (sys.mem.active / sys.mem.total) * 100 : 0;

  return (
    <>
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] z-50" />
      <motion.div 
        variants={stagger}
        initial="hidden"
        animate="show"
        className="space-y-6 pb-10 relative"
      >
        {/* Section Title */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-2 w-2 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(var(--primary),0.8)]" />
            <h2 className="text-2xl font-display font-bold tracking-tighter">SYSTEM MATRIX</h2>
            <span className="text-[10px] font-mono text-muted-foreground uppercase tracking-[0.2em] opacity-60">CPU / Memory / Network</span>
          </div>
          <div className="flex items-center gap-2 text-xs font-mono">
            <div className={cn("h-2 w-2 rounded-full", sysConnected ? "bg-[hsl(var(--data-pos))] animate-pulse" : "bg-[hsl(var(--data-neg))]")} />
            <span className="text-muted-foreground">
              SSE {sysConnected ? "live" : "offline"} · {sysHistory.length} pts
              {sys ? ` · cpu ${sys.cpu.load.toFixed(0)}%` : " · no data"}
            </span>
          </div>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Left Column: Essential Metrics */}
          <div className="space-y-6 lg:col-span-1">
            <div className="grid grid-cols-2 gap-4">
              <MatrixCard title="CPU LOAD" value={latestCpu.toFixed(1)} unit="%" icon={Gauge} color={latestCpu > 80 ? "#0072B2" : latestCpu > 50 ? "#f59e0b" : "#E69F00"} />
              <MatrixCard title="MEM ACTIVE" value={latestMem.toFixed(1)} unit="%" icon={Layers} color="#3b82f6" />
              <MatrixCard title="TEMP" value={sys?.cpu.temp || 0} unit="°C" icon={Thermometer} color="#f59e0b" />
              <MatrixCard title="FREQ" value={(sys?.cpu.speed || 0).toFixed(2)} unit="GHz" icon={Zap} color="#8b5cf6" />
            </div>
            
            <CoreGrid cores={sys?.cpu.cores || []} />
            
            <motion.div variants={fadeUp} className="glass rounded-2xl p-5 border border-white/[0.05]">
              <div className="flex items-center gap-2 mb-4">
                <Network className="h-4 w-4 text-primary" />
                <span className="text-sm font-bold uppercase tracking-wider">I/O Throughput</span>
              </div>
              <div className="space-y-4">
                {[
                  { label: "Download", value: formatBytes(sys?.network.rx_sec || 0) + "/s", color: "text-[hsl(var(--data-pos))]" },
                  { label: "Upload", value: formatBytes(sys?.network.tx_sec || 0) + "/s", color: "text-blue-400" },
                ].map(net => (
                  <div key={net.label} className="flex justify-between items-end border-b border-white/[0.03] pb-2">
                    <span className="text-[10px] text-muted-foreground font-mono">{net.label.toUpperCase()}</span>
                    <span className={cn("text-lg font-display font-bold", net.color)}>{net.value}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            <ProcessList processes={sys?.processes} />
          </div>

          {/* Center/Right: Visualizations */}
          <div className="lg:col-span-2 space-y-6">
            <motion.div variants={fadeUp} className="glass rounded-2xl p-6 border border-white/[0.05] h-[300px] relative overflow-hidden">
              <div className="absolute top-0 right-0 p-4">
                <Activity className="h-10 w-10 text-primary/10" />
              </div>
              <h3 className="text-sm font-bold uppercase tracking-wider mb-6 flex items-center gap-2">
                <Activity className="h-4 w-4 text-primary" /> Core Performance Timeline
              </h3>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData}>
                  <defs>
                    <linearGradient id="colorCpu" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#E69F00" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#E69F00" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                  <XAxis dataKey="time" hide />
                  <YAxis hide domain={[0, 100]} />
                  <Tooltip 
                    contentStyle={{ background: "#0a0a0a", border: "1px solid #ffffff10", borderRadius: "8px", fontSize: "10px" }}
                  />
                  <Area type="monotone" dataKey="cpu" stroke="#E69F00" fillOpacity={1} fill="url(#colorCpu)" isAnimationActive={false} />
                </AreaChart>
              </ResponsiveContainer>
            </motion.div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <motion.div variants={fadeUp} className="glass rounded-2xl p-6 border border-white/[0.05] relative group">
                <div className="flex justify-between items-center mb-4">
                  <div className="flex items-center gap-2">
                    <MemoryStick className="h-4 w-4 text-blue-400" />
                    <span className="text-sm font-bold uppercase tracking-wider">Memory Fabric</span>
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{(latestMem).toFixed(1)}%</span>
                </div>
                <div className="h-2 w-full bg-white/[0.03] rounded-full overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${latestMem}%` }}
                    className="h-full bg-gradient-to-r from-blue-600 to-blue-400 shadow-[0_0_12px_rgba(59,130,246,0.5)]"
                  />
                </div>
                <div className="mt-4 grid grid-cols-2 gap-2">
                  <div className="p-3 rounded-xl bg-white/[0.02]">
                    <p className="text-[8px] text-muted-foreground font-mono">TOTAL</p>
                    <p className="text-xs font-bold">{formatBytes(sys?.mem.total || 0)}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-white/[0.02]">
                    <p className="text-[8px] text-muted-foreground font-mono">ACTIVE</p>
                    <p className="text-xs font-bold text-blue-400">{formatBytes(sys?.mem.active || 0)}</p>
                  </div>
                </div>
              </motion.div>

              <motion.div variants={fadeUp} className="glass rounded-2xl p-6 border border-white/[0.05] bg-gradient-to-br from-primary/5 to-transparent relative group overflow-hidden">
                <div className="absolute -right-4 -top-4">
                  <Zap className="h-24 w-24 text-primary/5 group-hover:text-primary/10 transition-colors duration-700" />
                </div>
                <div className="relative z-10">
                  <div className="flex items-center gap-2 mb-4">
                    <Monitor className="h-4 w-4 text-primary" />
                    <span className="text-sm font-bold uppercase tracking-wider">GPU Core // {gpu?.name.split(" ").slice(-1)}</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <h3 className="text-4xl font-display font-bold tracking-tighter text-glow">{gpu?.utilizationGpu || 0}%</h3>
                    <span className="text-[10px] font-mono text-muted-foreground">RTX_UTIL</span>
                  </div>
                  <div className="mt-4 flex gap-4 text-[10px] font-mono text-muted-foreground">
                    <span>TEMP: {gpu?.temperatureC || 0}°C</span>
                    <span>VRAM: {gpu?.memoryUsedPct || 0}%</span>
                  </div>
                </div>
              </motion.div>
            </div>
          </div>
        </div>
      </motion.div>
    </>
  );
}