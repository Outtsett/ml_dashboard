import React from 'react';
import { Card } from "@/shared/ui/card";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function BoostingAnalyticsTab({ profileId }: { profileId: string }) {
  const data = [
    { feature: 'roc_10', importance: 0.85 },
    { feature: 'macd_cross', importance: 0.65 },
    { feature: 'vwap_dist', importance: 0.55 },
    { feature: 'volatility_20', importance: 0.40 },
    { feature: 'volume_ratio', importance: 0.25 },
  ];

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-emerald-500">Gradient Boosting Diagnostics</h2>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase">SHAP Feature Importance</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <BarChart data={data} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis type="number" stroke="#666" />
              <YAxis dataKey="feature" type="category" stroke="#666" width={100} />
              <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
              <Bar dataKey="importance" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
