import { memo, useMemo } from 'react';
import { Target } from 'lucide-react';
import { useCycleStore } from '@/cycle/store';
import { runIsShown } from '@/cycle/useRunOverlay';

export const ForecastAccuracyHUD = memo(function ForecastAccuracyHUD() {
  const isShown = useCycleStore(runIsShown);
  const modelType = useCycleStore((state) => state.modelType);
  const plan = useCycleStore((state) => state.plan);
  const bars = useCycleStore((state) => state.bars);
  const barCount = useCycleStore((state) => state.barCount);
  const running = useCycleStore((state) => state.running);
  const finalScoreboard = useCycleStore((state) => state.final);

  const stats = useMemo(() => {
    if (!isShown || barCount === 0 || !bars.timestamps) return null;

    let evaluated = 0;
    let hits = 0;
    let misses = 0;
    let sumAbsError = 0;
    let sumSqError = 0;
    let errorCount = 0;
    let totalPredictions = 0;
    let confidenceSumHits = 0;
    let confidenceSumMisses = 0;

    const n = Math.min(barCount, bars.timestamps.length);
    for (let i = 0; i < n; i++) {
      const predDir = bars.predictedDirection?.[i];
      if (predDir !== undefined && predDir !== null && predDir !== 0) {
        totalPredictions++;
      }

      const isCorrect = bars.correct?.[i];
      const probUp = bars.probabilityUp?.[i];
      const conf = probUp !== undefined && probUp !== null ? Math.max(probUp, 1 - probUp) : null;

      if (isCorrect === true) {
        evaluated++;
        hits++;
        if (conf !== null) confidenceSumHits += conf;
      } else if (isCorrect === false) {
        evaluated++;
        misses++;
        if (conf !== null) confidenceSumMisses += conf;
      }

      const predClose = bars.predictedClose?.[i];
      const actualClose = bars.close?.[i];
      if (predClose != null && actualClose != null) {
        const err = Math.abs(predClose - actualClose);
        sumAbsError += err;
        sumSqError += err * err;
        errorCount++;
      }
    }

    const hitRate = evaluated > 0 ? (hits / evaluated) * 100 : null;
    const mae = errorCount > 0 ? sumAbsError / errorCount : null;
    const rmse = errorCount > 0 ? Math.sqrt(sumSqError / errorCount) : null;
    const avgHitConf = hits > 0 ? (confidenceSumHits / hits) * 100 : null;
    const avgMissConf = misses > 0 ? (confidenceSumMisses / misses) * 100 : null;

    // Use running or final scoreboard metrics if available, otherwise compute from bars
    const scoreboard = finalScoreboard ?? running;
    const reportedHitRate = scoreboard?.metrics?.accuracy != null ? scoreboard.metrics.accuracy * 100 : hitRate;
    const reportedMae = scoreboard?.metrics?.mae != null ? scoreboard.metrics.mae : mae;
    const reportedRmse = scoreboard?.metrics?.rmse != null ? scoreboard.metrics.rmse : rmse;
    const equity = scoreboard?.metrics?.equity_usd != null ? scoreboard.metrics.equity_usd : bars.equityUsd?.[n - 1] ?? null;
    const profitFactor = scoreboard?.metrics?.profit_factor ?? null;

    return {
      totalPredictions,
      evaluated,
      hits,
      misses,
      hitRate: reportedHitRate,
      mae: reportedMae,
      rmse: reportedRmse,
      avgHitConf,
      avgMissConf,
      equity,
      profitFactor,
      horizon: plan?.labelHorizonBars ?? 6,
    };
  }, [isShown, barCount, bars, plan, running, finalScoreboard]);

  if (!isShown || !stats || stats.totalPredictions === 0) return null;

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-1.5 border-b border-white/[0.08] bg-black/40 text-[11px] font-mono shrink-0 overflow-x-auto"
      data-testid="forecast-accuracy-hud"
    >
      {/* Model Badge */}
      <div className="flex items-center gap-1.5 shrink-0 pr-1">
        <Target className="h-3.5 w-3.5 text-primary drop-shadow-[0_0_6px_rgba(96,165,250,0.5)]" />
        <span className="font-bold text-foreground">{modelType || 'Model Walk'}</span>
        <span className="text-[10px] text-muted-foreground/80">(H: {stats.horizon}b)</span>
      </div>

      <div className="w-px h-4 bg-white/10 shrink-0" />

      {/* Directional Edge (Hit Rate) */}
      <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] shrink-0">
        <span className="text-muted-foreground text-[10px]">Directional Edge:</span>
        <span
          className={`font-bold ${
            stats.hitRate != null && stats.hitRate >= 52
              ? 'text-[hsl(var(--data-pos))] drop-shadow-[0_0_4px_rgba(52,211,153,0.3)]'
              : 'text-[hsl(var(--data-neg))]'
          }`}
        >
          {stats.hitRate != null ? `${stats.hitRate.toFixed(1)}%` : '—'}
        </span>
        {stats.evaluated > 0 && (
          <span className="text-[9px] text-muted-foreground/70">
            ({stats.hits}/{stats.evaluated})
          </span>
        )}
      </div>

      {/* Forecast Error: MAE */}
      {stats.mae != null && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] shrink-0">
          <span className="text-muted-foreground text-[10px]">MAE:</span>
          <span className="font-semibold text-foreground">
            ±{stats.mae.toFixed(2)} pts
          </span>
        </div>
      )}

      {/* Forecast Error: RMSE */}
      {stats.rmse != null && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] shrink-0">
          <span className="text-muted-foreground text-[10px]">RMSE:</span>
          <span className="font-semibold text-foreground">
            {stats.rmse.toFixed(2)}
          </span>
        </div>
      )}

      {/* Confidence Edge */}
      {stats.avgHitConf != null && stats.avgMissConf != null && (
        <div className="hidden lg:flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] shrink-0">
          <span className="text-muted-foreground text-[10px]">Confidence Edge:</span>
          <span className="text-[hsl(var(--data-pos))] font-medium">{stats.avgHitConf.toFixed(0)}%</span>
          <span className="text-muted-foreground/60">vs</span>
          <span className="text-muted-foreground font-medium">{stats.avgMissConf.toFixed(0)}%</span>
        </div>
      )}

      {/* Cumulative Simulated P&L / Backtest Equity */}
      {stats.equity != null && (
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] shrink-0">
          <span className="text-muted-foreground text-[10px]">Simulated Net:</span>
          <span
            className={`font-bold ${
              stats.equity >= 0 ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]'
            }`}
          >
            {stats.equity >= 0 ? '+' : ''}${Math.round(stats.equity).toLocaleString()}
          </span>
          {stats.profitFactor != null && (
            <span className="text-[9px] text-cyan-400 font-medium ml-0.5">
              (PF {stats.profitFactor === Infinity ? '∞' : stats.profitFactor.toFixed(2)})
            </span>
          )}
        </div>
      )}

      <div className="flex-1" />

      {/* Prediction Counts Tag */}
      <span className="text-[10px] text-muted-foreground/60 shrink-0">
        {stats.totalPredictions.toLocaleString()} predictions evaluated on chart
      </span>
    </div>
  );
});
