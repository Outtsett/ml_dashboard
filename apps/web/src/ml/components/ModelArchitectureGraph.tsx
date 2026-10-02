/**
 * ModelArchitectureGraph — SVG-based DAG visualization for multimodal model architectures.
 *
 * Renders a directed acyclic graph showing how input streams flow through encoder blocks 
 * into a fusion layer and out to prediction heads. 
 * Redesigned to be more visually in-depth, with animated data-flow edges and gradient nodes.
 */
import { useMemo } from "react";

interface ArchNode {
  id: string;
  label: string;
  sublabel?: string;
  type: "input" | "encoder" | "fusion" | "head";
  x: number;
  y: number;
}

interface ArchEdge {
  from: string;
  to: string;
}

interface ModelArchitecture {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

const TYPE_COLORS: Record<ArchNode["type"], { fill: string; border: string; text: string; subtext: string }> = {
  input:   { fill: "#061a26", border: "#0072B2", text: "#7FC4E8", subtext: "#4EA6D6" }, // Wong blue
  encoder: { fill: "#2A1C00", border: "#E69F00", text: "#F5C86B", subtext: "#EDB23C" }, // Wong orange
  fusion:  { fill: "#262300", border: "#F0E442", text: "#F7EE93", subtext: "#F3E96A" }, // Wong yellow
  head:    { fill: "#2A1420", border: "#CC79A7", text: "#E3AEC9", subtext: "#D894B8" }, // Wong pink
};

const MODEL_ARCHITECTURES: Record<string, ModelArchitecture> = {
  PPOAgent: {
    nodes: [
      { id: "ohlcv",   label: "OHLCV",          sublabel: "B x T x 5", type: "input",   x: 20,  y: 30 },
      { id: "volume",  label: "Volume",         sublabel: "B x T x 1", type: "input",   x: 20,  y: 110 },
      { id: "norm",    label: "Z-Score Norm",   sublabel: "B x T x 6", type: "encoder", x: 220, y: 70 },
      { id: "actor",   label: "Actor (π)",      sublabel: "B x Actions", type: "head",  x: 420, y: 30 },
      { id: "critic",  label: "Critic (V)",     sublabel: "B x 1",      type: "head",  x: 420, y: 110 },
    ],
    edges: [
      { from: "ohlcv", to: "norm" },
      { from: "volume", to: "norm" },
      { from: "norm", to: "actor" },
      { from: "norm", to: "critic" },
    ],
  },
  DQNAgent: {
    nodes: [
      { id: "ohlcv",    label: "OHLCV",            sublabel: "B x T x C", type: "input",   x: 20,  y: 70 },
      { id: "feature",  label: "Shared Feature",   sublabel: "B x 256",   type: "encoder", x: 220, y: 70 },
      { id: "q_mean",   label: "Q-Mean Head",      sublabel: "B x Actions", type: "head",  x: 420, y: 30 },
      { id: "q_var",    label: "Q-Var Head",       sublabel: "B x Actions", type: "head",  x: 420, y: 110 },
    ],
    edges: [
      { from: "ohlcv", to: "feature" },
      { from: "feature", to: "q_mean" },
      { from: "feature", to: "q_var" },
    ],
  },
  TransformerModel: {
    nodes: [
      { id: "ohlcv",     label: "OHLCV",             sublabel: "B x T x 5", type: "input",   x: 20,  y: 30 },
      { id: "indicators", label: "TA Indicators",    sublabel: "B x T x N", type: "input",   x: 20,  y: 110 },
      { id: "pos_enc",   label: "Positional Enc",    sublabel: "B x T x D", type: "encoder", x: 180, y: 30 },
      { id: "mha",       label: "Multi-Head Attn",   sublabel: "8 Heads",   type: "encoder", x: 180, y: 110 },
      { id: "ffn",       label: "Feed-Forward",      sublabel: "MLP Fusion",type: "fusion",  x: 340, y: 70 },
      { id: "direction", label: "Direction",         sublabel: "Softmax",   type: "head",    x: 500, y: 30 },
      { id: "confidence", label: "Confidence",       sublabel: "Sigmoid",   type: "head",    x: 500, y: 110 },
    ],
    edges: [
      { from: "ohlcv", to: "pos_enc" },
      { from: "indicators", to: "mha" },
      { from: "pos_enc", to: "mha" },
      { from: "mha", to: "ffn" },
      { from: "ffn", to: "direction" },
      { from: "ffn", to: "confidence" },
    ],
  },
  XGBoost: {
    nodes: [
      { id: "ohlcv",    label: "OHLCV",           sublabel: "Raw Bars", type: "input",   x: 20,  y: 30 },
      { id: "features", label: "Feature Eng",     sublabel: "Lagged",   type: "input",   x: 20,  y: 110 },
      { id: "boost",    label: "Gradient Boost",  sublabel: "100 Trees",type: "encoder", x: 220, y: 70 },
      { id: "shap",     label: "SHAP Explain",    sublabel: "Explainer",type: "fusion",  x: 420, y: 110 },
      { id: "label",    label: "Direction",       sublabel: "LogLoss",  type: "head",    x: 420, y: 30 },
    ],
    edges: [
      { from: "ohlcv", to: "boost" },
      { from: "features", to: "boost" },
      { from: "boost", to: "label" },
      { from: "boost", to: "shap" },
    ],
  },
};

const DEFAULT_ARCH: ModelArchitecture = {
  nodes: [
    { id: "input", label: "Input", type: "input", x: 30, y: 70 },
    { id: "model", label: "Model", type: "encoder", x: 250, y: 70 },
    { id: "output", label: "Output", type: "head", x: 470, y: 70 },
  ],
  edges: [
    { from: "input", to: "model" },
    { from: "model", to: "output" },
  ],
};

const NODE_W = 140;
const NODE_H = 46;

export function ModelArchitectureGraph({ model }: { model: string }) {
  const arch = MODEL_ARCHITECTURES[model] || DEFAULT_ARCH;

  const nodeMap = useMemo(() => {
    const m = new Map<string, ArchNode>();
    arch.nodes.forEach((n) => m.set(n.id, n));
    return m;
  }, [arch]);

  return (
    <div className="bg-[#0a0a0a] rounded-none p-3 relative overflow-hidden flex flex-col h-[260px] border-b border-neutral-800">
      <div className="flex items-center gap-2 mb-2 px-1 z-10">
        <span className="text-[10px] font-mono text-neutral-500 uppercase tracking-widest bg-transparent">
          Neural Architecture / <span className="text-(--color-accent) font-semibold">{model}</span>
        </span>
        <div className="flex gap-3 ml-auto bg-transparent">
          {(["input", "encoder", "fusion", "head"] as const).map((t) => (
            <span key={t} className="flex items-center gap-1.5 text-[9px] font-mono tracking-wide uppercase text-neutral-400">
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: TYPE_COLORS[t].border, boxShadow: `0 0 4px ${TYPE_COLORS[t].border}` }} />
              {t}
            </span>
          ))}
        </div>
      </div>
      
      {/* HUD Grid */}
      <div className="absolute inset-0 z-0 pointer-events-none opacity-[0.03]" style={{ backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)', backgroundSize: '16px 16px' }}></div>
      
      <div className="flex-1 w-full relative z-10">
        <svg width="100%" height="100%" viewBox="0 0 680 180" preserveAspectRatio="xMidYMid meet" className="overflow-visible">
          
          <defs>
            <filter id="node-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="3" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
            
            <filter id="edge-glow" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feComposite in="SourceGraphic" in2="blur" operator="over" />
            </filter>
          </defs>
          
          {/* Edges */}
          {arch.edges.map((e, i) => {
            const from = nodeMap.get(e.from);
            const to = nodeMap.get(e.to);
            if (!from || !to) return null;
            const x1 = from.x + NODE_W;
            const y1 = from.y + NODE_H / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_H / 2;
            const cx = (x1 + x2) / 2;
            const pathData = `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}`;
            
            return (
              <g key={i}>
                <path
                  d={pathData}
                  fill="none"
                  stroke="#1a1a1a"
                  strokeWidth={2}
                />
                <path
                  d={pathData}
                  fill="none"
                  stroke={TYPE_COLORS[from.type].border}
                  strokeWidth={1.5}
                  strokeDasharray="4 6"
                  opacity={0.6}
                  filter="url(#edge-glow)"
                  className="animate-[dash_15s_linear_infinite]"
                />
              </g>
            );
          })}
          
          {/* Nodes */}
          {arch.nodes.map((n) => {
            const colors = TYPE_COLORS[n.type];
            return (
              <g key={n.id} transform={`translate(${n.x}, ${n.y})`}>
                <rect
                  x={0}
                  y={0}
                  width={NODE_W}
                  height={NODE_H}
                  rx={2}
                  fill={colors.fill}
                  stroke={colors.border}
                  strokeWidth={1}
                  opacity={0.8}
                  filter="url(#node-glow)"
                />
                
                <text
                  x={NODE_W / 2}
                  y={NODE_H / 2 - (n.sublabel ? 4 : -1)}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={colors.text}
                  fontSize={11}
                  fontFamily="monospace"
                  fontWeight={500}
                  letterSpacing={0.5}
                >
                  {n.label}
                </text>
                
                {n.sublabel && (
                  <text
                    x={NODE_W / 2}
                    y={NODE_H / 2 + 10}
                    textAnchor="middle"
                    dominantBaseline="middle"
                    fill={colors.subtext}
                    fontSize={9}
                    fontFamily="monospace"
                    opacity={0.7}
                  >
                    {n.sublabel}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
      
      <style dangerouslySetInnerHTML={{__html: `
        @keyframes dash {
          to { stroke-dashoffset: -1000; }
        }
      `}} />
    </div>
  );
}
