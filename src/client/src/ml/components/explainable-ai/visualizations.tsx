import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  Cell, ReferenceLine, AreaChart, Area, LineChart, Line
} from "recharts";
import { Badge } from "@/shared/ui/badge";
import { Progress } from "@/shared/ui/progress";
import { ChevronRight, TrendingUp, TrendingDown, Target } from "lucide-react";
import type { FeatureContribution, CounterfactualExample, XAIExplanation } from "./types";

// ─── Feature Waterfall Chart ────────────────────────────────────────────────

export function FeatureWaterfall({ contributions }: { contributions: FeatureContribution[] }) {
  const top10 = contributions.slice(0, 10);
  const chartData = top10.map(c => ({
    feature: c.feature.length > 12 ? c.feature.slice(0, 10) + '...' : c.feature,
    fullFeature: c.feature,
    contribution: c.contribution,
    value: c.value,
    fill: c.direction === 'positive' ? '#E69F00' : '#0072B2',
  }));

  return (
    <div className="h-[300px]">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} layout="vertical" margin={{ top: 10, right: 30, left: 80, bottom: 10 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" horizontal={false} />
          <XAxis
            type="number"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            tickLine={{ stroke: 'rgba(255,255,255,0.2)' }}
          />
          <YAxis
            dataKey="feature" type="category"
            tick={{ fill: 'rgba(255,255,255,0.8)', fontSize: 11 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            tickLine={false} width={75}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                const data = payload[0]!.payload;
                return (
                  <div className="bg-black/90 border border-white/20 rounded-lg p-3 shadow-xl">
                    <p className="text-white font-medium text-sm">{data.fullFeature}</p>
                    <p className="text-muted-foreground text-xs mt-1">
                      Value: <span className="font-mono text-white">{data.value?.toFixed(4)}</span>
                    </p>
                    <p className={`text-xs mt-1 ${data.contribution >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'}`}>
                      Contribution: <span className="font-mono">{data.contribution >= 0 ? '+' : ''}{data.contribution?.toFixed(4)}</span>
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <ReferenceLine x={0} stroke="rgba(255,255,255,0.3)" />
          <Bar dataKey="contribution" radius={[0, 4, 4, 0]}>
            {chartData.map((entry, index) => (
              <Cell key={index} fill={entry.fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Attention Heatmap ──────────────────────────────────────────────────────

export function AttentionHeatmap({ weights }: { weights: number[] }) {
  const chartData = weights.map((w, i) => ({ step: i + 1, attention: w }));

  return (
    <div className="h-[200px]">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 0, bottom: 10 }}>
          <defs>
            <linearGradient id="attentionGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8} />
              <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.1} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
          <XAxis
            dataKey="step"
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            label={{ value: 'Time Step', position: 'insideBottom', offset: -5, fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
          />
          <YAxis
            tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
            axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
            domain={[0, 1]}
            label={{ value: 'Attention', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
          />
          <Tooltip
            content={({ active, payload }) => {
              if (active && payload && payload.length) {
                return (
                  <div className="bg-black/90 border border-white/20 rounded-lg p-2 shadow-xl">
                    <p className="text-white text-sm">
                      Step {payload[0]!.payload.step}: <span className="font-mono text-violet-400">{(payload[0]!.value as number * 100).toFixed(1)}%</span>
                    </p>
                  </div>
                );
              }
              return null;
            }}
          />
          <Area type="monotone" dataKey="attention" stroke="#8b5cf6" strokeWidth={2} fill="url(#attentionGradient)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── Calibration Curve ──────────────────────────────────────────────────────

export function CalibrationCurve({ calibration }: { calibration: NonNullable<XAIExplanation['calibration']> }) {
  const chartData = calibration.reliabilityDiagram.map(bin => ({
    confidence: bin.binMid * 100,
    accuracy: bin.accuracy * 100,
    count: bin.count,
  }));

  const perfectCalibration = [
    { confidence: 0, perfect: 0 },
    { confidence: 100, perfect: 100 },
  ];

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-muted-foreground">Expected Confidence</p>
          <p className="text-lg font-mono text-white">{(calibration.expectedConfidence * 100).toFixed(1)}%</p>
        </div>
        <div className="bg-white/5 rounded-lg p-3 border border-white/10">
          <p className="text-xs text-muted-foreground">Actual Accuracy</p>
          <p className="text-lg font-mono text-white">{(calibration.actualAccuracy * 100).toFixed(1)}%</p>
        </div>
      </div>
      <div className="h-[200px]">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart margin={{ top: 10, right: 20, left: 0, bottom: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
            <XAxis
              dataKey="confidence"
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              label={{ value: 'Confidence (%)', position: 'insideBottom', offset: -10, fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <YAxis
              tick={{ fill: 'rgba(255,255,255,0.6)', fontSize: 10 }}
              axisLine={{ stroke: 'rgba(255,255,255,0.2)' }}
              domain={[0, 100]}
              label={{ value: 'Accuracy (%)', angle: -90, position: 'insideLeft', fill: 'rgba(255,255,255,0.5)', fontSize: 10 }}
            />
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const data = payload[0]!.payload;
                  return (
                    <div className="bg-black/90 border border-white/20 rounded-lg p-2 shadow-xl">
                      <p className="text-white text-sm">
                        Confidence: <span className="font-mono">{data.confidence?.toFixed(0)}%</span>
                      </p>
                      <p className="text-cyan-400 text-sm">
                        Accuracy: <span className="font-mono">{data.accuracy?.toFixed(1)}%</span>
                      </p>
                    </div>
                  );
                }
                return null;
              }}
            />
            <Line data={perfectCalibration} dataKey="perfect" stroke="rgba(255,255,255,0.3)" strokeDasharray="5 5" dot={false} />
            <Line data={chartData} dataKey="accuracy" stroke="#06b6d4" strokeWidth={2} dot={{ fill: '#06b6d4', r: 4 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// ─── Counterfactual List ────────────────────────────────────────────────────

export function CounterfactualList({ counterfactuals }: { counterfactuals: CounterfactualExample[]; currentPrediction: string | number }) {
  return (
    <div className="space-y-3">
      {counterfactuals.map((cf, idx) => (
        <div key={idx} className="bg-white/5 rounded-lg p-3 border border-white/10">
          <div className="flex items-center justify-between mb-2">
            <Badge className="bg-violet-500/20 text-violet-300 border-violet-500/30 text-xs">
              Counterfactual {idx + 1}
            </Badge>
            <span className="text-xs text-muted-foreground font-mono">
              Distance: {cf.distance.toFixed(4)}
            </span>
          </div>
          <div className="flex items-center gap-2 text-sm mb-2">
            <span className="text-muted-foreground">Flips prediction to:</span>
            <Badge className={
              cf.newPrediction === 2 ? "bg-[hsl(var(--data-pos)/0.2)] text-[hsl(var(--data-pos))]" :
              cf.newPrediction === 0 ? "bg-[hsl(var(--data-neg)/0.2)] text-[hsl(var(--data-neg))]" :
              "bg-yellow-500/20 text-yellow-400"
            }>
              {cf.newPrediction === 2 ? 'UP' : cf.newPrediction === 0 ? 'DOWN' : 'NEUTRAL'}
            </Badge>
          </div>
          <div className="space-y-1.5">
            {cf.changes.slice(0, 5).map((change, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span className="text-white/70 w-20 truncate">{change.feature}</span>
                <span className="font-mono text-[hsl(var(--data-neg))]">{change.from.toFixed(3)}</span>
                <ChevronRight className="h-3 w-3 text-muted-foreground" />
                <span className="font-mono text-[hsl(var(--data-pos))]">{change.to.toFixed(3)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Prediction Badge ───────────────────────────────────────────────────────

export function PredictionBadge({ prediction }: { prediction: XAIExplanation['prediction'] }) {
  const direction = prediction.class === 2 ? 'up' : prediction.class === 0 ? 'down' : 'neutral';
  const Icon = direction === 'up' ? TrendingUp : direction === 'down' ? TrendingDown : Target;
  const colorClass = direction === 'up' ? 'text-[hsl(var(--data-pos))] bg-[hsl(var(--data-pos)/0.2)]' :
                     direction === 'down' ? 'text-[hsl(var(--data-neg))] bg-[hsl(var(--data-neg)/0.2)]' :
                     'text-yellow-400 bg-yellow-500/20';

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg ${colorClass}`}>
      <Icon className="h-4 w-4" />
      <span className="font-medium text-sm uppercase">{direction}</span>
      <span className="text-xs opacity-70">({(prediction.confidence * 100).toFixed(1)}%)</span>
    </div>
  );
}

// ─── Class Probabilities ────────────────────────────────────────────────────

export function ClassProbabilities({ probabilities }: { probabilities: number[] }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      {['Down', 'Neutral', 'Up'].map((label, i) => (
        <div key={label} className="bg-white/5 rounded-lg p-2 border border-white/10 text-center">
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-lg font-mono text-white">
            {((probabilities[i] || 0) * 100).toFixed(1)}%
          </p>
          <Progress value={(probabilities[i] || 0) * 100} className="h-1 mt-1" />
        </div>
      ))}
    </div>
  );
}
