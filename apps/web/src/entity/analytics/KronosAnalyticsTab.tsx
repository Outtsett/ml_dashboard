import React from 'react';
import { Card } from "@/shared/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function KronosAnalyticsTab({ profileId }: { profileId: string }) {
  // Mock data for Kronos structural paths
  const data = Array.from({ length: 40 }).map((_, i) => ({
    step: i,
    actual: i < 30 ? 100 + Math.sin(i / 5) * 10 : null,
    forecast: i >= 30 ? 100 + Math.sin(i / 5) * 10 : null,
    upperBound: i >= 30 ? 100 + Math.sin(i / 5) * 10 + (i - 30) * 1.5 : null,
    lowerBound: i >= 30 ? 100 + Math.sin(i / 5) * 10 - (i - 30) * 1.5 : null,
  }));

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-amber-500">Kronos K-Line Inference</h2>
        <span className="text-xs text-neutral-400 bg-neutral-900 px-2 py-1 rounded">Autoregressive Structural Paths</span>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase tracking-wider">Zero-Shot Latent Forecast</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="step" stroke="#666" />
              <YAxis stroke="#666" domain={['auto', 'auto']} />
              <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
              <Area type="monotone" dataKey="upperBound" stroke="none" fill="#f59e0b" fillOpacity={0.1} />
              <Area type="monotone" dataKey="lowerBound" stroke="none" fill="#f59e0b" fillOpacity={0.1} />
              <Area type="monotone" dataKey="actual" stroke="#E69F00" fill="none" strokeWidth={2} />
              <Area type="monotone" dataKey="forecast" stroke="#0072B2" fill="none" strokeWidth={2} strokeDasharray="5 5" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-400 mb-2">Hierarchical Tokens</h3>
          <p className="text-3xl font-mono text-[#E69F00]">12.4M</p>
          <p className="text-xs text-neutral-500 mt-1">Total OHLCVA tokens mapped to local state space.</p>
        </Card>
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-400 mb-2">Latent Distance</h3>
          <p className="text-3xl font-mono text-blue-400">0.0412</p>
          <p className="text-xs text-neutral-500 mt-1">Mean separation in the final hidden state vector.</p>
        </Card>
      </div>
    </div>
  );
}
