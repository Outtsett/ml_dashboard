import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Progress } from "@/components/ui/progress";
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, 
  AreaChart, Area, ComposedChart, Bar, ReferenceLine 
} from "recharts";
import { 
  Zap, TrendingUp, TrendingDown, AlertCircle, Clock, Target, 
  Brain, Sparkles, ArrowUpRight, ArrowDownRight, Activity, RefreshCw
} from "lucide-react";
import { useState, useEffect } from "react";

interface Signal {
  id: number;
  timestamp: string;
  symbol: string;
  direction: "long" | "short";
  confidence: number;
  entryPrice: number;
  targetPrice: number;
  stopLoss: number;
  model: string;
  status: "active" | "triggered" | "expired";
  pnl?: number;
}

interface ModelPrediction {
  symbol: string;
  prediction: number;
  confidence: number;
  direction: "bullish" | "bearish" | "neutral";
  features: { name: string; contribution: number }[];
}

type PriceDataPoint = {
  time: number;
  price: number;
  prediction: number;
  upper: number;
  lower: number;
};

export default function Signals() {
  const [priceData] = useState<PriceDataPoint[]>([]);
  const [signals] = useState<Signal[]>([]);
  const [modelPredictions] = useState<ModelPrediction[]>([]);
  const [selectedSymbol, setSelectedSymbol] = useState("");
  const [isLive, setIsLive] = useState(false);

  const selectedPrediction = modelPredictions.find(p => p.symbol === selectedSymbol);
  const activeSignals = signals.filter(s => s.status === "active");
  const todayPnL = signals.filter(s => s.pnl).reduce((acc, s) => acc + (s.pnl || 0), 0);

  return (
    <div className="space-y-4 h-[calc(100vh-6rem)] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex justify-between items-center shrink-0">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Zap className="h-5 w-5 text-muted-foreground" />
            <span className="text-sm font-medium text-muted-foreground">
              Signal Generation Not Implemented
            </span>
          </div>
          <h1 className="text-4xl font-display font-bold text-foreground">ML Signals</h1>
          <p className="text-muted-foreground text-sm mt-1">Model predictions and trade signals (not implemented)</p>
        </div>
        <div className="flex gap-3">
          <Badge variant="outline" className="h-10 px-4 font-mono gap-2 text-sm rounded-full border-white/10 text-muted-foreground bg-black/30">
            <Activity className="h-4 w-4" /> -- Active
          </Badge>
          <Badge variant="outline" className="h-10 px-4 font-mono gap-2 text-sm rounded-full border-white/10 text-muted-foreground bg-black/30">
            <ArrowUpRight className="h-4 w-4" /> $--
          </Badge>
          <Button 
            variant="outline" 
            className="h-10 rounded-xl opacity-50 cursor-not-allowed"
            disabled
            data-testid="button-toggle-live"
          >
            <RefreshCw className="h-4 w-4 mr-2" />
            Disabled
          </Button>
        </div>
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Price Chart with Predictions */}
        <Card className="lg:col-span-2 glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="border-b border-white/5 py-2 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Brain className="h-4 w-4 text-primary" /> 
              Price & Prediction: <span className="text-muted-foreground font-mono">{selectedSymbol || '--'}</span>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 p-2">
            {priceData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={priceData}>
                  <defs>
                    <linearGradient id="predictionBand" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="hsl(260, 80%, 70%)" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsla(260, 30%, 30%, 0.2)" />
                  <XAxis dataKey="time" stroke="hsl(var(--muted-foreground))" fontSize={10} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={10} domain={['auto', 'auto']} />
                  <Tooltip contentStyle={{ backgroundColor: 'hsla(250, 25%, 14%, 0.95)', borderRadius: '8px' }} />
                  <Area type="monotone" dataKey="upper" stroke="transparent" fill="hsla(260, 80%, 70%, 0.1)" />
                  <Area type="monotone" dataKey="lower" stroke="transparent" fill="hsla(260, 80%, 70%, 0.1)" />
                  <Line type="monotone" dataKey="price" stroke="hsl(185, 70%, 55%)" strokeWidth={2} dot={false} name="Actual" />
                  <Line type="monotone" dataKey="prediction" stroke="hsl(260, 80%, 70%)" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Predicted" />
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground">
                <Brain className="h-12 w-12 mb-3 opacity-20" />
                <p className="text-sm font-medium">No Price Data</p>
                <p className="text-xs">Live price predictions not implemented</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Model Predictions */}
        <Card className="glass rounded-2xl flex flex-col gradient-border overflow-hidden">
          <CardHeader className="border-b border-white/5 py-2 px-4">
            <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-accent" /> Model Predictions
            </CardTitle>
          </CardHeader>
          <ScrollArea className="flex-1">
            <CardContent className="space-y-3 pt-3">
              {modelPredictions.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Sparkles className="h-12 w-12 mx-auto mb-3 opacity-20" />
                  <p className="text-sm font-medium">No Predictions</p>
                  <p className="text-xs">Model predictions not implemented</p>
                </div>
              ) : modelPredictions.map((pred) => (
                <button
                  key={pred.symbol}
                  onClick={() => setSelectedSymbol(pred.symbol)}
                  className={`w-full p-3 rounded-xl text-left transition-all ${
                    selectedSymbol === pred.symbol ? 'glass glow-soft' : 'bg-white/5 hover:bg-white/10'
                  }`}
                  data-testid={`prediction-${pred.symbol}`}
                >
                  <div className="flex justify-between items-center mb-2">
                    <span className="font-mono font-bold">{pred.symbol}</span>
                    <Badge variant="outline" className={`text-xs rounded-full ${
                      pred.direction === 'bullish' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                      pred.direction === 'bearish' ? 'border-rose-500/50 text-rose-400 bg-rose-500/10' :
                      'border-muted-foreground/50'
                    }`}>
                      {pred.direction === 'bullish' ? <TrendingUp className="h-3 w-3 mr-1" /> : 
                       pred.direction === 'bearish' ? <TrendingDown className="h-3 w-3 mr-1" /> : null}
                      {pred.direction}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-xs text-muted-foreground">Confidence</span>
                    <span className="font-mono text-sm">{(pred.confidence * 100).toFixed(0)}%</span>
                  </div>
                  <Progress value={pred.confidence * 100} className="h-1.5" />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {pred.features.slice(0, 3).map(f => (
                      <Badge key={f.name} variant="outline" className={`text-[9px] rounded-full ${
                        f.contribution > 0 ? 'border-green-500/30 text-green-400' : 'border-rose-500/30 text-rose-400'
                      }`}>
                        {f.name}: {f.contribution > 0 ? '+' : ''}{(f.contribution * 100).toFixed(0)}%
                      </Badge>
                    ))}
                  </div>
                </button>
              ))}
            </CardContent>
          </ScrollArea>
        </Card>
      </div>

      {/* Active Signals Table */}
      <Card className="h-52 shrink-0 glass rounded-2xl gradient-border flex flex-col overflow-hidden">
        <CardHeader className="border-b border-white/5 py-2 px-4 shrink-0">
          <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
            <Target className="h-4 w-4 text-green-400" /> Trade Signals
          </CardTitle>
        </CardHeader>
        <ScrollArea className="flex-1">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-background/80 backdrop-blur-sm">
              <tr className="border-b border-white/5 text-muted-foreground">
                <th className="text-left py-2 px-3 font-medium">Time</th>
                <th className="text-left py-2 px-3 font-medium">Symbol</th>
                <th className="text-left py-2 px-3 font-medium">Direction</th>
                <th className="text-right py-2 px-3 font-medium">Confidence</th>
                <th className="text-right py-2 px-3 font-medium">Entry</th>
                <th className="text-right py-2 px-3 font-medium">Target</th>
                <th className="text-right py-2 px-3 font-medium">Stop</th>
                <th className="text-left py-2 px-3 font-medium">Model</th>
                <th className="text-right py-2 px-3 font-medium">Status</th>
                <th className="text-right py-2 px-3 font-medium">P&L</th>
              </tr>
            </thead>
            <tbody>
              {signals.length === 0 ? (
                <tr>
                  <td colSpan={10} className="py-8 text-center text-muted-foreground">
                    <Target className="h-10 w-10 mx-auto mb-2 opacity-20" />
                    <p className="text-sm font-medium">No Trade Signals</p>
                    <p className="text-xs">Signal generation not implemented</p>
                  </td>
                </tr>
              ) : signals.map((signal) => (
                <tr key={signal.id} className="border-b border-white/5 hover:bg-white/5" data-testid={`signal-${signal.id}`}>
                  <td className="py-2 px-3 font-mono text-muted-foreground">{signal.timestamp}</td>
                  <td className="py-2 px-3 font-mono font-bold text-primary">{signal.symbol}</td>
                  <td className="py-2 px-3">
                    <Badge variant="outline" className={`text-[10px] rounded-full ${
                      signal.direction === 'long' ? 'border-green-500/50 text-green-400' : 'border-rose-500/50 text-rose-400'
                    }`}>
                      {signal.direction === 'long' ? <TrendingUp className="h-2.5 w-2.5 mr-1" /> : <TrendingDown className="h-2.5 w-2.5 mr-1" />}
                      {signal.direction.toUpperCase()}
                    </Badge>
                  </td>
                  <td className="py-2 px-3 text-right font-mono">{(signal.confidence * 100).toFixed(0)}%</td>
                  <td className="py-2 px-3 text-right font-mono">{signal.entryPrice}</td>
                  <td className="py-2 px-3 text-right font-mono text-green-400">{signal.targetPrice}</td>
                  <td className="py-2 px-3 text-right font-mono text-rose-400">{signal.stopLoss}</td>
                  <td className="py-2 px-3 text-muted-foreground">{signal.model}</td>
                  <td className="py-2 px-3 text-right">
                    <Badge variant="outline" className={`text-[10px] rounded-full ${
                      signal.status === 'active' ? 'border-green-500/50 text-green-400 bg-green-500/10' :
                      signal.status === 'triggered' ? 'border-primary/50 text-primary bg-primary/10' :
                      'border-muted-foreground/30 text-muted-foreground'
                    }`}>
                      {signal.status}
                    </Badge>
                  </td>
                  <td className={`py-2 px-3 text-right font-mono font-bold ${
                    signal.pnl === undefined ? 'text-muted-foreground' :
                    signal.pnl >= 0 ? 'text-green-400' : 'text-rose-400'
                  }`}>
                    {signal.pnl !== undefined ? `${signal.pnl >= 0 ? '+' : ''}$${signal.pnl}` : '-'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollArea>
      </Card>
    </div>
  );
}
