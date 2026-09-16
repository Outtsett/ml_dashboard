import React from 'react';
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, 
  ResponsiveContainer, Legend, LineChart, Line 
} from 'recharts';
import { Card, CardHeader, CardTitle, CardContent } from '@/shared/ui/card';
import { useTrainingLive } from "@/training/lib/TrainingContext";

/**
 * Microstructure & First-Principles Analytics
 * Visualizes order book imbalance and price action "Pressure" metrics.
 */
export const MicrostructureAnalytics: React.FC = () => {
  const { iterationHistory } = useTrainingLive();

  // Extract relevant metrics from history
  // useTrainingLive() is fully typed, so h infers as the iterationHistory element.
  const data = iterationHistory.map((h) => ({
    iteration: h.iteration,
    imbalance: h.metrics.book_imbalance_top || 0,
    imbalance5: h.metrics.book_imbalance_5 || 0,
    absorption: h.metrics.absorption_score_10 || 0,
    vwap_stretch: h.metrics.vwap_stretch_100 || 0,
  }));

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No microstructure data available for this model.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
      {/* Book Imbalance Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Order Book Imbalance</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="iteration" hide />
              <YAxis domain={[-1, 1]} tick={{fontSize: 10}} />
              <Tooltip 
                contentStyle={{backgroundColor: '#1a1a1a', border: 'none', borderRadius: '4px'}}
                itemStyle={{fontSize: '12px'}}
              />
              <Legend />
              <Area 
                type="monotone" 
                dataKey="imbalance" 
                name="Top Level" 
                stroke="#E69F00" 
                fill="#E69F00" 
                fillOpacity={0.2} 
              />
              <Area 
                type="monotone" 
                dataKey="imbalance5" 
                name="5-Level" 
                stroke="#3b82f6" 
                fill="#3b82f6" 
                fillOpacity={0.1} 
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Absorption Score Chart */}
      <Card className="bg-card/50 border-border/50">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">Absorption (Effort vs Result)</CardTitle>
        </CardHeader>
        <CardContent className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="iteration" hide />
              <YAxis tick={{fontSize: 10}} />
              <Tooltip 
                contentStyle={{backgroundColor: '#1a1a1a', border: 'none', borderRadius: '4px'}}
                itemStyle={{fontSize: '12px'}}
              />
              <Legend />
              <Line 
                type="monotone" 
                dataKey="absorption" 
                name="Absorption" 
                stroke="#f59e0b" 
                dot={false}
                strokeWidth={2}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* VWAP Stretch Chart */}
      <Card className="bg-card/100 border-border/50 md:col-span-2">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium">VWAP Elasticity (Standard Deviations)</CardTitle>
        </CardHeader>
        <CardContent className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data}>
              <defs>
                <linearGradient id="colorStretch" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0072B2" stopOpacity={0.3}/>
                  <stop offset="50%" stopColor="#0072B2" stopOpacity={0}/>
                  <stop offset="95%" stopColor="#0072B2" stopOpacity={0.3}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#333" />
              <XAxis dataKey="iteration" hide />
              <YAxis domain={[-4, 4]} tick={{fontSize: 10}} />
              <Tooltip 
                contentStyle={{backgroundColor: '#1a1a1a', border: 'none', borderRadius: '4px'}}
                itemStyle={{fontSize: '12px'}}
              />
              <Area 
                type="monotone" 
                dataKey="vwap_stretch" 
                name="VWAP σ" 
                stroke="#0072B2" 
                fill="url(#colorStretch)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
};

export default MicrostructureAnalytics;
