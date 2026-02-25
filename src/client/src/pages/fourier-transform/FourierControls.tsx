import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Play, Pause, RotateCcw, Zap, CandlestickChart, Loader2 } from 'lucide-react';
import { TF_LABELS } from './constants';
import type { WaveType, TransformMode, InstrumentInfo } from './types';

interface FourierControlsProps {
  transformMode: TransformMode;
  setTransformMode: (mode: TransformMode) => void;
  waveType: WaveType;
  setWaveType: (type: WaveType) => void;
  isPriceMode: boolean;
  isHilbert: boolean;
  priceSymbol: string;
  setPriceSymbol: (symbol: string) => void;
  priceTimeframe: number;
  setPriceTimeframe: (tf: number) => void;
  priceLoading: boolean;
  instruments: InstrumentInfo[];
  numTerms: number;
  setNumTerms: (n: number) => void;
  speed: number;
  setSpeed: (s: number) => void;
  amplitude: number;
  setAmplitude: (a: number) => void;
  showComponents: boolean;
  setShowComponents: (fn: (prev: boolean) => boolean) => void;
  playing: boolean;
  setPlaying: (fn: (prev: boolean) => boolean) => void;
  regenerateCustom: () => void;
  reset: () => void;
}

export function FourierControls({
  transformMode, setTransformMode,
  waveType, setWaveType,
  isPriceMode, isHilbert,
  priceSymbol, setPriceSymbol,
  priceTimeframe, setPriceTimeframe,
  priceLoading, instruments,
  numTerms, setNumTerms,
  speed, setSpeed,
  amplitude, setAmplitude,
  showComponents, setShowComponents,
  playing, setPlaying,
  regenerateCustom, reset,
}: FourierControlsProps) {
  return (
    <Card className="glass rounded-2xl gradient-border shrink-0">
      <CardContent className="py-3 px-4">
        <div className="flex items-center gap-4 flex-wrap">
          {/* Transform mode toggle */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">TRANSFORM</span>
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={transformMode === 'fourier' ? 'default' : 'ghost'}
                className={`h-6 px-2.5 text-[10px] font-mono ${
                  transformMode === 'fourier'
                    ? 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                    : 'text-muted-foreground'
                }`}
                onClick={() => { setTransformMode('fourier'); reset(); }}
              >
                Fourier
              </Button>
              <Button
                size="sm"
                variant={transformMode === 'hilbert' ? 'default' : 'ghost'}
                className={`h-6 px-2.5 text-[10px] font-mono ${
                  transformMode === 'hilbert'
                    ? 'bg-pink-500/20 text-pink-400 border border-pink-500/30'
                    : 'text-muted-foreground'
                }`}
                onClick={() => { setTransformMode('hilbert'); reset(); }}
              >
                Hilbert
              </Button>
            </div>
          </div>

          {/* Separator */}
          <div className="w-px h-5 bg-white/10" />

          {/* Wave / signal source */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-muted-foreground font-mono">SIGNAL</span>
            <div className="flex gap-1">
              {(['square', 'sawtooth', 'triangle', 'custom', 'price'] as WaveType[]).map(w => (
                <Button
                  key={w}
                  size="sm"
                  variant={waveType === w ? 'default' : 'ghost'}
                  className={`h-6 px-2 text-[10px] font-mono capitalize ${
                    waveType === w
                      ? w === 'price'
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'bg-violet-500/20 text-violet-400 border border-violet-500/30'
                      : 'text-muted-foreground'
                  }`}
                  onClick={() => {
                    setWaveType(w);
                    if (w === 'custom') regenerateCustom();
                    reset();
                  }}
                >
                  {w === 'price' && <CandlestickChart className="h-3 w-3 mr-1" />}
                  {w}
                </Button>
              ))}
            </div>
          </div>

          {/* Price controls */}
          {isPriceMode && (
            <>
              <div className="flex items-center gap-2">
                <Select value={priceSymbol} onValueChange={v => { setPriceSymbol(v); reset(); }}>
                  <SelectTrigger className="h-7 w-[90px] text-[10px] font-mono bg-black/30 border-white/10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {instruments.map(inst => (
                      <SelectItem key={inst.symbol} value={inst.symbol} className="text-xs font-mono">
                        {inst.symbol}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-0.5">
                {Object.entries(TF_LABELS).map(([mins, label]) => (
                  <Button
                    key={mins}
                    size="sm"
                    variant={priceTimeframe === Number(mins) ? 'default' : 'ghost'}
                    className={`h-5 px-1.5 text-[9px] font-mono ${
                      priceTimeframe === Number(mins)
                        ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30'
                        : 'text-muted-foreground'
                    }`}
                    onClick={() => { setPriceTimeframe(Number(mins)); reset(); }}
                  >
                    {label}
                  </Button>
                ))}
              </div>
              {priceLoading && <Loader2 className="h-3 w-3 animate-spin text-amber-400" />}
            </>
          )}

          {/* Terms slider (Fourier mode) */}
          {!isHilbert && (
            <div className="flex items-center gap-2 min-w-[150px]">
              <span className="text-[10px] text-muted-foreground font-mono">TERMS</span>
              <Slider
                value={[numTerms]}
                onValueChange={([v]) => {
                  setNumTerms(v!);
                  if (waveType === 'custom') regenerateCustom();
                  if (isPriceMode) reset();
                }}
                min={1}
                max={isPriceMode ? 50 : 20}
                step={1}
                className="flex-1"
              />
              <span className="text-xs font-mono text-violet-400 w-6 text-right">{numTerms}</span>
            </div>
          )}

          {/* Speed */}
          <div className="flex items-center gap-2 min-w-[100px]">
            <span className="text-[10px] text-muted-foreground font-mono">SPD</span>
            <Slider
              value={[speed]}
              onValueChange={([v]) => setSpeed(v!)}
              min={0.1}
              max={3}
              step={0.1}
              className="flex-1"
            />
            <span className="text-xs font-mono text-teal-400 w-6 text-right">{speed.toFixed(1)}×</span>
          </div>

          {/* Amplitude (synthetic fourier only) */}
          {!isPriceMode && !isHilbert && (
            <div className="flex items-center gap-2 min-w-[100px]">
              <span className="text-[10px] text-muted-foreground font-mono">AMP</span>
              <Slider
                value={[amplitude]}
                onValueChange={([v]) => setAmplitude(v!)}
                min={30}
                max={200}
                step={5}
                className="flex-1"
              />
              <span className="text-xs font-mono text-amber-400 w-6 text-right">{amplitude}</span>
            </div>
          )}

          {/* Buttons */}
          <div className="flex items-center gap-1 ml-auto">
            {!isPriceMode && !isHilbert && (
              <Button
                size="sm" variant="ghost"
                className={`h-7 w-7 p-0 ${showComponents ? 'text-teal-400' : 'text-muted-foreground'}`}
                onClick={() => setShowComponents(v => !v)}
                title="Toggle component waves"
              >
                <Zap className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => setPlaying(v => !v)}>
              {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </Button>
            <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={reset}>
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
