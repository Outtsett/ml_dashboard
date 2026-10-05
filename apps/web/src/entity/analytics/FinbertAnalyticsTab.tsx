import React from 'react';
import { Card } from "@/shared/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

export function FinbertAnalyticsTab({ profileId }: { profileId: string }) {
  // Mock data for sentiment shifts
  const data = Array.from({ length: 20 }).map((_, i) => ({
    time: `10:${i < 10 ? '0'+i : i}`,
    positive: Math.random() * 40 + (i > 15 ? 40 : 0),
    neutral: Math.random() * 20 + 20,
    negative: Math.random() * 30 + (i > 5 && i < 12 ? 50 : 0),
  }));

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-blue-500">FinBERT Sentiment Analysis</h2>
        <span className="text-xs text-neutral-400 bg-neutral-900 px-2 py-1 rounded">Asynchronous Event Alignment</span>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase tracking-wider">Sentiment Logit Stream</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={data} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="time" stroke="#666" />
              <YAxis stroke="#666" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
              <Legend />
              {/* Okabe-Ito: positive=#E69F00, neutral=#CC79A7, negative=#0072B2 */}
              <Bar dataKey="positive" stackId="a" fill="#E69F00" />
              <Bar dataKey="neutral" stackId="a" fill="#CC79A7" />
              <Bar dataKey="negative" stackId="a" fill="#0072B2" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <div className="grid grid-cols-2 gap-6">
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-400 mb-2">Decay Factor (?)</h3>
          <p className="text-3xl font-mono text-purple-400">0.92</p>
          <p className="text-xs text-neutral-500 mt-1">Current learned exponential temporal decay parameter.</p>
        </Card>
        <Card className="p-6 bg-neutral-900 border-neutral-800">
          <h3 className="text-sm font-medium text-neutral-400 mb-2">Event Density</h3>
          <p className="text-3xl font-mono text-amber-400">14.2 / hr</p>
          <p className="text-xs text-neutral-500 mt-1">Average text signals snapped to market index.</p>
        </Card>
      </div>
    </div>
  );
}
