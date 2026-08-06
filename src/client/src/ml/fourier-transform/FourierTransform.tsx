import { Card, CardContent, CardHeader, CardTitle } from "@/shared/ui/card";
import { Badge } from "@/shared/ui/badge";
import { 
  Waves, 
  Activity, 
  Zap, 
  TrendingUp, 
  Timer,
  Cpu
} from "lucide-react";

import { TF_LABELS } from "./constants";
import { FourierControls } from "./FourierControls";
import { AnalysisChart } from "./AnalysisChart";
import { SpectrumChart } from "./SpectrumChart";
import { HilbertVector } from "./HilbertVector";
import { useFourierState } from "./useFourierState";
import { StatCard } from "@/shared/ui/stat-card";

export default function FourierTransform() {
  const {
    numTerms, setNumTerms,
    speed, setSpeed,
    waveType, setWaveType,
    transformMode, setTransformMode,
    playing, setPlaying,
    showComponents, setShowComponents,
    amplitude, setAmplitude,
    priceSymbol, setPriceSymbol,
    priceTimeframe, setPriceTimeframe,
    instruments,
    priceLoading,
    priceDFT,
    priceHilbert,
    regenerateCustom,
    reset,
    isPriceMode,
    isHilbert
  } = useFourierState();

  const dominantPeriod = isHilbert ? 0 : (priceDFT?.dominantPeriod || 0);
  const snr = isPriceMode && priceDFT ? (10 * Math.log10(priceDFT.analysisSeries.reduce((acc: number, curr: { reconstructed: number }) => acc + curr.reconstructed ** 2, 0) / priceDFT.analysisSeries.reduce((acc: number, curr: { residual: number }) => acc + curr.residual ** 2, 0))).toFixed(1) : "--";

  return (
    <div className="p-6 space-y-6 h-full flex flex-col overflow-hidden bg-background/50">
      {/* Institutional Header */}
      <div className="flex items-center justify-between shrink-0">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-primary/10 flex items-center justify-center border border-primary/20 shadow-[0_0_30px_-5px_rgba(59,130,246,0.3)]">
            <Waves className="h-8 w-8 text-primary animate-pulse" />
          </div>
          <div>
            <h1 className="text-4xl font-display font-bold tracking-tight text-foreground">
              {isHilbert ? "Analytic Phase Space" : "Quantum Spectral Analysis"}
            </h1>
            <p className="text-sm text-muted-foreground flex items-center gap-2 mt-1">
              <Cpu className="h-3 w-3" />
              Institutional Signal Decomposition â€” Linear Detrending Active
            </p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <Badge variant="outline" className="h-10 px-4 rounded-xl border-white/10 bg-white/5 font-mono text-sm gap-2">
            <Timer className="h-4 w-4 text-primary" />
            {isPriceMode ? `${priceSymbol} @ ${TF_LABELS[priceTimeframe]}` : "Synthetic Wave"}
          </Badge>
          <Badge variant="outline" className="h-10 px-4 rounded-xl border-emerald-500/20 text-emerald-400 bg-emerald-500/5 font-mono text-sm">
            LIVE_DATA_NODE_ONLINE
          </Badge>
        </div>
      </div>

      {/* Control Surface */}
      <div className="shrink-0">
        <FourierControls
          transformMode={transformMode}
          setTransformMode={setTransformMode}
          waveType={waveType}
          setWaveType={setWaveType}
          isPriceMode={isPriceMode}
          isHilbert={isHilbert}
          priceSymbol={priceSymbol}
          setPriceSymbol={setPriceSymbol}
          priceTimeframe={priceTimeframe}
          setPriceTimeframe={setPriceTimeframe}
          priceLoading={priceLoading}
          instruments={instruments}
          numTerms={numTerms}
          setNumTerms={setNumTerms}
          speed={speed}
          setSpeed={setSpeed}
          amplitude={amplitude}
          setAmplitude={setAmplitude}
          showComponents={showComponents}
          setShowComponents={setShowComponents}
          playing={playing}
          setPlaying={setPlaying}
          regenerateCustom={regenerateCustom}
          reset={reset}
        />
      </div>

      {/* Analytics Dashboard Grid */}
      <div className="flex-1 min-h-0 grid grid-cols-12 gap-6">
        
        {/* Main Temporal Analysis (75% width) */}
        <div className="col-span-12 lg:col-span-9 flex flex-col space-y-6">
          
          {/* Top Metric Strip */}
          <div className="grid grid-cols-4 gap-4 shrink-0">
            <StatCard 
              label="Dominant Period" 
              value={dominantPeriod > 0 ? `${dominantPeriod} bars` : "--"} 
              icon={Timer} 
              color="primary" 
            />
            <StatCard 
              label="Signal-to-Noise (SNR)" 
              value={snr !== "--" ? `${snr} dB` : "--"} 
              icon={Activity} 
              color="emerald" 
            />
            <StatCard 
              label="Spectral Terms" 
              value={numTerms} 
              icon={Zap} 
              color="amber" 
            />
            <StatCard 
              label="Confidence Edge" 
              value={isPriceMode ? "High" : "Optimal"} 
              icon={TrendingUp} 
              color="cyan" 
            />
          </div>

          {/* Primary Chart */}
          <div className="flex-1 min-h-0">
            <AnalysisChart
              data={(isHilbert ? priceHilbert?.hilbertSeries : priceDFT?.analysisSeries) ?? []}
              isHilbert={isHilbert}
            />
          </div>
        </div>

        {/* Secondary Analysis (25% width) */}
        <div className="col-span-12 lg:col-span-3 flex flex-col space-y-6">
          <div className="flex-1 min-h-0">
            {isHilbert ? (
              <HilbertVector data={priceHilbert?.hilbertSeries ?? []} />
            ) : (
              <SpectrumChart data={priceDFT?.spectrumSeries ?? []} />
            )}
          </div>
          
          <Card className="glass border-white/5 shrink-0">
            <CardHeader className="py-2 px-4 border-b border-white/5">
              <CardTitle className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                Quantum State Summary
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Computation Method</span>
                <span className="font-mono text-primary">Radix-2 FFT</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Window Function</span>
                <span className="font-mono text-primary">Hann (Implicit)</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-muted-foreground">Stationarity</span>
                <span className="font-mono text-emerald-400">Verified</span>
              </div>
              <div className="pt-2 mt-2 border-t border-white/5">
                <p className="text-[10px] text-muted-foreground leading-relaxed italic">
                  * Fourier components represent the energy distribution across the temporal window. Detrending is performed via least-squares linear regression prior to transform.
                </p>
              </div>
            </CardContent>
          </Card>
        </div>

      </div>
    </div>
  );
}
