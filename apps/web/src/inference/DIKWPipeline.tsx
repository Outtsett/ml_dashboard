import React, { useState } from 'react';
import { Card } from "@/shared/ui/card";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, AreaChart, Area, BarChart, Bar } from 'recharts';
import { BrainCircuit, Activity, LineChart as LineChartIcon, ShieldCheck } from 'lucide-react';

const MOCK_DATA = Array.from({ length: 50 }).map((_, i) => ({
  time: i,
  price: 15000 + Math.sin(i / 4) * 200 + (Math.random() * 50),
  volatility: Math.abs(Math.cos(i / 5)) * 100,
  sentiment: Math.sin(i / 8) * 100,
  confidence: 60 + Math.random() * 30
}));

export default function DIKWPipeline() {
  const [activeStage, setActiveStage] = useState(0);

  const stages = [
    {
      title: "Descriptive (Data)",
      subtitle: "What is happening?",
      icon: <Activity className="w-5 h-5 text-[#E69F00]" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">Raw OHLCVA & Text ingestion. Tracking market microstructure and asynchronous news flow.</p>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <LineChart data={MOCK_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" />
                <YAxis stroke="#666" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Line type="monotone" dataKey="price" stroke="#E69F00" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    },
    {
      title: "Diagnostic (Information)",
      subtitle: "Why is it happening?",
      icon: <BrainCircuit className="w-5 h-5 text-[#0072B2]" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">HMM Regime states and FinBERT sentiment shifts.</p>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <AreaChart data={MOCK_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Area type="monotone" dataKey="sentiment" stackId="1" stroke="#0072B2" fill="#0072B2" fillOpacity={0.2} />
                <Area type="monotone" dataKey="volatility" stackId="2" stroke="#E69F00" fill="#E69F00" fillOpacity={0.2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    },
    {
      title: "Predictive (Knowledge)",
      subtitle: "What will happen?",
      icon: <LineChartIcon className="w-5 h-5 text-amber-500" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">Kronos structural forecasts aligned with fusion embeddings.</p>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <LineChart data={MOCK_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" />
                <YAxis stroke="#666" domain={['auto', 'auto']} />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Line type="monotone" dataKey="price" stroke="#E69F00" dot={false} strokeWidth={2} />
                <Line type="monotone" dataKey="price" stroke="#56B4E9" dot={false} strokeDasharray="5 5" strokeWidth={2} style={{ transform: 'translateX(20px)' }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    },
    {
      title: "Prescriptive (Wisdom)",
      subtitle: "What should we do?",
      icon: <ShieldCheck className="w-5 h-5 text-[#CC79A7]" />,
      content: (
        <div className="space-y-4">
          <p className="text-sm text-neutral-400">Gaussian NLL bounded actions. Position sizing based on confidence thresholds.</p>
          <div className="h-[300px] w-full">
            <ResponsiveContainer>
              <BarChart data={MOCK_DATA}>
                <CartesianGrid strokeDasharray="3 3" stroke="#333" />
                <XAxis dataKey="time" stroke="#666" />
                <YAxis stroke="#666" />
                <Tooltip contentStyle={{ backgroundColor: '#111', borderColor: '#333' }} />
                <Bar dataKey="confidence" fill="#E69F00" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )
    }
  ];

  return (
    <div className="p-6 h-full flex flex-col space-y-6 text-white overflow-y-auto">
      <div className="space-y-1">
        <h1 className="text-2xl font-bold tracking-tight">DIKW Visual Inference Pipeline</h1>
        <p className="text-neutral-400">Pre-training analytical verification for Kronos, FinBERT, and HMM subagents.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {stages.map((stage, idx) => (
          <Card 
            key={idx}
            className={`p-4 cursor-pointer transition-all duration-200 border bg-black/60 backdrop-blur-md ${activeStage === idx ? 'border-white/40 shadow-[0_0_15px_rgba(255,255,255,0.1)]' : 'border-white/[0.04] opacity-50 hover:opacity-100'}`}
            onClick={() => setActiveStage(idx)}
          >
            <div className="flex items-center space-x-3 mb-2">
              {stage.icon}
              <h3 className="font-semibold text-sm">{stage.title}</h3>
            </div>
            <p className="text-xs text-neutral-500">{stage.subtitle}</p>
          </Card>
        ))}
      </div>

      <Card className="flex-1 p-6 border-white/[0.04] bg-black/60 backdrop-blur-md">
        <div className="animate-in fade-in zoom-in duration-300">
          <div className="flex items-center space-x-3 mb-6">
            {stages[activeStage].icon}
            <h2 className="text-xl font-semibold">{stages[activeStage].title} Panel</h2>
          </div>
          {stages[activeStage].content}
        </div>
      </Card>
    </div>
  );
}
