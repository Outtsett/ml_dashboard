import React from 'react';
import { Card } from "@/shared/ui/card";
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export function TransformerAnalyticsTab({ profileId }: { profileId: string }) {
  const data = Array.from({ length: 30 }).map((_, i) => ({
    head: i,
    attention: Math.sin(i / 3) * 50 + 50,
  }));

  return (
    <div className="flex flex-col gap-6 p-6 overflow-y-auto">
      <div className="flex items-center gap-4">
        <h2 className="text-xl font-bold text-blue-500">Transformer Diagnostics</h2>
      </div>
      <Card className="p-6 bg-neutral-900 border-neutral-800">
        <h3 className="text-sm font-medium text-neutral-400 mb-4 uppercase">Attention Head Weights</h3>
        <div className="h-72 w-full">
          <ResponsiveContainer>
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="head" stroke="#666" />
              <YAxis stroke="#666" />
              <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
              <Area type="monotone" dataKey="attention" stroke="#3b82f6" fill="#3b82f6" fillOpacity={0.2} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}
