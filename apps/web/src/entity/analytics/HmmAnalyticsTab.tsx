import React from 'react';
import { Card } from "@/shared/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function HmmAnalyticsTab({ profileId }: { profileId: string }) {
  // Mock data for regime probabilities
  const data = Array.from({ length: 50 }).map((_, i) => ({
    time: i,
    regimeA: Math.max(0, Math.sin(i / 10) * 100),
    regimeB: Math.max(0, Math.cos(i / 10) * 100),
    regimeC: Math.max(0, Math.sin(i / 5) * 50),
  }));

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-emerald-500">HMM Regime Router</h2>
        <span className="text-xs text-neutral-400 bg-neutral-900 px-2 py-1 rounded">Latent State Segregation</span>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase tracking-wider">State Transition Probabilities</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
              <Area type="monotone" dataKey="regimeA" stackId="1" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.6} name="Trending" />
              <Area type="monotone" dataKey="regimeB" stackId="1" stroke="#f59e0b" fill="#f59e0b" fillOpacity={0.6} name="Mean Reverting" />
              <Area type="monotone" dataKey="regimeC" stackId="1" stroke="#ef4444" fill="#ef4444" fillOpacity={0.6} name="High Volatility" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
