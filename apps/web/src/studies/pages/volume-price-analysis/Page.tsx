import { Link } from "wouter";

export default function VolumePriceAnalysisPage() {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-neutral-800 px-6 py-4">
        <div className="flex items-center gap-2">
          <Link href="/studies" className="text-neutral-500 hover:text-neutral-300">Studies</Link>
          <span className="text-neutral-600">/</span>
          <h1 className="text-base font-semibold text-neutral-50">Volume Bar Height to Price & Anatomy</h1>
        </div>
        <p className="mt-1 text-sm text-neutral-400">
          DIKW Study: Descriptive, Diagnostic, Predictive, and Prescriptive Analytics (MNQ 15m)
        </p>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-6 text-sm text-neutral-300 space-y-8">
        
        <section>
          <h2 className="text-lg font-medium text-neutral-100 mb-3 border-b border-neutral-800 pb-2">1. Descriptive Analytics (Information)</h2>
          <p className="mb-4">Understanding the baseline relationship between volume height and candle anatomy.</p>
          <ul className="list-disc list-inside space-y-2 text-neutral-400">
            <li><strong className="text-neutral-300">Directional Volume Bias:</strong> Down bars exhibit slightly heavier average volume (11,690) compared to Up bars (11,154).</li>
            <li><strong className="text-neutral-300">Correlation with True Range:</strong> 0.7542 (Strong positive). High volume directly translates to a wider spread.</li>
            <li><strong className="text-neutral-300">Correlation with Body Size:</strong> 0.5820 (Solid positive). Volume expansion drives body expansion.</li>
            <li><strong className="text-neutral-300">Correlation with Wicks:</strong> ~0.51. Volume is less correlated with wicks than with the body or total range.</li>
          </ul>
        </section>

        <section>
          <h2 className="text-lg font-medium text-[#56B4E9] mb-3 border-b border-neutral-800 pb-2">2. Diagnostic Analytics (Knowledge)</h2>
          <p className="mb-4">Root Cause Analysis isolating what anatomically happens to a candle when volume spikes &gt; 3x above average (&gt;95th percentile).</p>
          <div className="grid grid-cols-3 gap-4 mb-4 border border-neutral-800 rounded p-4 bg-neutral-900/50">
            <div><span className="block text-xs text-neutral-500 uppercase">Avg Body Size</span><span className="text-base text-neutral-200">33.19 pts</span><span className="ml-2 text-xs text-neutral-500">(Normal: 11.29)</span></div>
            <div><span className="block text-xs text-neutral-500 uppercase">Avg Upper Wick</span><span className="text-base text-neutral-200">13.73 pts</span><span className="ml-2 text-xs text-neutral-500">(Normal: 5.81)</span></div>
            <div><span className="block text-xs text-neutral-500 uppercase">Avg Lower Wick</span><span className="text-base text-neutral-200">16.08 pts</span><span className="ml-2 text-xs text-neutral-500">(Normal: 6.53)</span></div>
            <div><span className="block text-xs text-neutral-500 uppercase">Wick-to-Body Ratio</span><span className="text-base text-neutral-200">0.90</span><span className="ml-2 text-xs text-neutral-500">(Normal: 1.09)</span></div>
          </div>
          <p className="text-neutral-300 border-l-2 border-neutral-600 pl-3">
            <strong>Diagnostic Conclusion:</strong> Extreme volume spikes are overwhelmingly <strong>Expansion Bars</strong>, not Absorption Bars. While wicks double in size, bodies <em>triple</em> in size. The root cause of a 3x volume anomaly is a sudden directional imbalance (breakout or panic), resulting in the body dominating the candle.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-medium text-[#E69F00] mb-3 border-b border-neutral-800 pb-2">3. Predictive Analytics (Knowledge)</h2>
          <p className="mb-4">Statistical probabilities of the next 1-bar and 3-bar directional moves based on specific volume and candle-shape criteria (Base UP Probability: 51.99%).</p>
          
          <div className="space-y-4">
            <div className="bg-neutral-900/40 p-4 rounded border border-neutral-800">
              <h3 className="font-medium text-neutral-200 mb-2">Scenario A: Extreme Momentum</h3>
              <ul className="list-disc list-inside space-y-1 text-neutral-400">
                <li><strong className="text-neutral-300">Extreme Up Expansion</strong> (&gt;3x Vol, Up Bar, Large Body): Next 1 Bar UP = <span className="text-[#0072B2] font-semibold">53.93%</span>. <em>Strong momentum continuation edge.</em></li>
                <li><strong className="text-neutral-300">Extreme Down Expansion</strong> (&gt;3x Vol, Down Bar, Large Body): Next 1 Bar UP = <span className="text-neutral-300 font-semibold">51.64%</span>. <em>Weak continuation (suggests capitulation).</em></li>
              </ul>
            </div>
            <div className="bg-neutral-900/40 p-4 rounded border border-neutral-800">
              <h3 className="font-medium text-neutral-200 mb-2">Scenario B: Extreme Rejection</h3>
              <ul className="list-disc list-inside space-y-1 text-neutral-400">
                <li><strong className="text-neutral-300">Extreme Upper Rejection</strong> (&gt;3x Vol, Upper Wick &gt; 2x Body): Next 1 Bar UP = <span className="text-[#D55E00] font-semibold">50.41%</span>. <em>Valid, albeit weak, bearish reversal signal.</em></li>
                <li><strong className="text-neutral-300">Extreme Lower Rejection</strong> (&gt;3x Vol, Lower Wick &gt; 2x Body): Next 1 Bar UP = <span className="text-neutral-300 font-semibold">51.33%</span>. <em>Muted predictive value.</em></li>
              </ul>
            </div>
          </div>
        </section>

        <section>
          <h2 className="text-lg font-medium text-[#009E73] mb-3 border-b border-neutral-800 pb-2">4. Prescriptive Analytics (Wisdom)</h2>
          <p className="mb-4">Actionable algorithmic trading rules derived directly from the data.</p>
          <ul className="space-y-4">
            <li className="bg-neutral-950 p-4 border-l-4 border-[#009E73] rounded shadow-sm">
              <h4 className="font-semibold text-neutral-100">Rule 1: Trade Upward Breakouts, Fade Downward Capitulations</h4>
              <p className="mt-1 text-neutral-400">The data shows a statistical asymmetry. When you see an Extreme Up Expansion bar (&gt;3x relative volume, large green body), go LONG for a 1-to-3 bar scalp. The momentum carries forward 54% of the time. Conversely, when you see an Extreme Down Expansion bar, DO NOT short it. Heavy volume on down bars frequently indicates capitulation (V-bottoms), neutralizing the downside edge.</p>
            </li>
            <li className="bg-neutral-950 p-4 border-l-4 border-[#D55E00] rounded shadow-sm">
              <h4 className="font-semibold text-neutral-100">Rule 2: Do Not Hunt for High-Volume Reversals (Absorption)</h4>
              <p className="mt-1 text-neutral-400">Diagnostic analytics proved that extreme volume creates bodies, not wicks. Waiting for a "high volume Doji" to signal a reversal is statistically suboptimal because 3x volume spikes rarely form Dojis. Train mean-reversion models to look for lower relative volume exhaustion.</p>
            </li>
            <li className="bg-neutral-950 p-4 border-l-4 border-[#56B4E9] rounded shadow-sm">
              <h4 className="font-semibold text-neutral-100">Rule 3: Use Volume to Confirm Range Expansion</h4>
              <p className="mt-1 text-neutral-400">Because Volume and True Range have a massive 0.75 correlation, volume should be fed into models as a proxy for volatility forecasting. If the current bar has 2x relative volume, the algorithm should prescribe widening its Take Profit (TP) and Stop Loss (SL) targets for subsequent bars.</p>
            </li>
          </ul>
        </section>

      </div>
    </div>
  );
}
