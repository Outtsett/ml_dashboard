import pandas as pd
import json
import os

csv_path = r'E:\source\repos\trading_models\logs\oos_backtest_results.csv'
df = pd.read_csv(csv_path)

# Ensure chronologic order if not already
if 'timestamp' in df.columns:
    df = df.sort_values('timestamp')

# Filter only taken trades
trades = df[df['signal'] != 0].copy()

# Cumulative PnL
trades['cumulative_pnl'] = trades['net_usd'].cumsum()

# Downsample the equity curve to ~500 points for the chart to keep HTML size small
if len(trades) > 500:
    step = len(trades) // 500
    equity_curve = trades['cumulative_pnl'].iloc[::step].tolist()
else:
    equity_curve = trades['cumulative_pnl'].tolist()

# Histogram data: group by $10 bins
bins = pd.cut(trades['net_usd'], bins=40)
hist_counts = trades.groupby(bins).size()
hist_data = [{"bin": str(b), "count": int(c)} for b, c in zip(hist_counts.index, hist_counts.values)]

# Key metrics
total_trades = len(trades)
win_rate = (trades['net_usd'] > 0).mean() * 100
avg_net = trades['net_usd'].mean()
total_net = trades['net_usd'].sum()
expected_daily = total_net / 320  # Approx 320 days in OOS

data = {
    "equity_curve": equity_curve,
    "hist_data": hist_data,
    "metrics": {
        "Total Trades": total_trades,
        "Win Rate": f"{win_rate:.2f}%",
        "Avg Net per Trade": f"${avg_net:.2f}",
        "Total Net Profit": f"${total_net:,.2f}",
        "Expected Daily Profit": f"${expected_daily:.2f}"
    }
}

html_content = f"""<!DOCTYPE html>
<html>
<head>
  <script src="https://www.gstatic.com/antigravity/web/dev/tailwindcss.min.js"></script>
  <!-- Chart.js for visualization -->
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <style>
    /* Theme overrides for Muted Institutional Palette */
    :root {{
      --emerald: #10b981;
      --blue: #3b82f6;
      --amber: #f59e0b;
      --red: #ef4444;
    }}
    body {{
      background-color: var(--background);
      color: var(--foreground);
    }}
    .metric-card {{
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }}
    .glow-text {{
      text-shadow: 0 0 10px rgba(16, 185, 129, 0.3);
    }}
  </style>
</head>
<body class="antialiased p-8 font-sans">
  <div class="max-w-6xl mx-auto">
    <div class="flex items-center justify-between mb-8">
      <div>
        <h1 class="text-3xl font-bold tracking-tight text-[var(--foreground)]">OOS Strategy Analytics</h1>
        <p class="text-[var(--muted-foreground)] mt-1">Confidence-Stratified Filter (128d/2L/0.00073LR) | 5 Micro Contracts</p>
      </div>
      <div class="px-4 py-2 bg-emerald-500/10 border border-emerald-500/20 rounded-full">
        <span class="text-emerald-500 font-semibold text-sm">LIVE EVALUATION</span>
      </div>
    </div>

    <!-- Metrics Grid -->
    <div class="grid grid-cols-1 md:grid-cols-5 gap-4 mb-8">
      <div class="metric-card">
        <div class="text-sm text-[var(--muted-foreground)] font-medium">Expected Daily Profit</div>
        <div class="text-3xl font-bold mt-2 text-emerald-500 glow-text">{data['metrics']['Expected Daily Profit']}</div>
      </div>
      <div class="metric-card">
        <div class="text-sm text-[var(--muted-foreground)] font-medium">Total Net Profit</div>
        <div class="text-2xl font-semibold mt-2">{data['metrics']['Total Net Profit']}</div>
      </div>
      <div class="metric-card">
        <div class="text-sm text-[var(--muted-foreground)] font-medium">Win Rate</div>
        <div class="text-2xl font-semibold mt-2">{data['metrics']['Win Rate']}</div>
      </div>
      <div class="metric-card">
        <div class="text-sm text-[var(--muted-foreground)] font-medium">Avg Net / Trade</div>
        <div class="text-2xl font-semibold mt-2">{data['metrics']['Avg Net per Trade']}</div>
      </div>
      <div class="metric-card">
        <div class="text-sm text-[var(--muted-foreground)] font-medium">Total Trades</div>
        <div class="text-2xl font-semibold mt-2">{data['metrics']['Total Trades']}</div>
      </div>
    </div>

    <!-- Charts -->
    <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div class="lg:col-span-2 metric-card">
        <h3 class="text-lg font-semibold mb-4 text-[var(--foreground)]">Cumulative Equity Curve (Net)</h3>
        <div class="relative h-72 w-full">
          <canvas id="equityChart"></canvas>
        </div>
      </div>
      <div class="metric-card">
        <h3 class="text-lg font-semibold mb-4 text-[var(--foreground)]">Trade PnL Distribution</h3>
        <div class="relative h-72 w-full">
          <canvas id="histChart"></canvas>
        </div>
      </div>
    </div>
  </div>

  <script>
    const dashboardData = {json.dumps(data)};
    
    // Check theme
    const isDark = document.documentElement.classList.contains('dark') || window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.1)' : 'rgba(0, 0, 0, 0.1)';
    const textColor = isDark ? '#9ca3af' : '#4b5563';

    // Equity Curve Chart
    const ctxEquity = document.getElementById('equityChart').getContext('2d');
    const labelsEquity = Array.from({{length: dashboardData.equity_curve.length}}, (_, i) => i);
    
    // Gradient fill
    let gradient = ctxEquity.createLinearGradient(0, 0, 0, 400);
    gradient.addColorStop(0, 'rgba(16, 185, 129, 0.5)');
    gradient.addColorStop(1, 'rgba(16, 185, 129, 0.0)');

    new Chart(ctxEquity, {{
      type: 'line',
      data: {{
        labels: labelsEquity,
        datasets: [{{
          label: 'Cumulative PnL ($)',
          data: dashboardData.equity_curve,
          borderColor: '#10b981',
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          fill: true,
          tension: 0.1
        }}]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{
          legend: {{ display: false }},
          tooltip: {{
            mode: 'index',
            intersect: false,
            callbacks: {{
              label: function(context) {{
                return '$' + context.parsed.y.toLocaleString();
              }}
            }}
          }}
        }},
        scales: {{
          x: {{ display: false }},
          y: {{
            grid: {{ color: gridColor, drawBorder: false }},
            ticks: {{ 
              color: textColor,
              callback: function(value) {{ return '$' + value; }}
            }}
          }}
        }}
      }}
    }});

    // Histogram Chart
    const ctxHist = document.getElementById('histChart').getContext('2d');
    const histLabels = dashboardData.hist_data.map(d => {{
        // clean up interval string
        let match = d.bin.match(/\[([-\d.]+),\s*([-\d.]+)\)/);
        if(match) return '$' + parseFloat(match[1]).toFixed(0) + ' to $' + parseFloat(match[2]).toFixed(0);
        return d.bin;
    }});
    const histCounts = dashboardData.hist_data.map(d => d.count);
    
    // Color positive green, negative red
    const barColors = dashboardData.hist_data.map(d => {{
        return d.bin.includes('-') && parseFloat(d.bin.split(',')[0].replace(/[\\[\\(]/,'')) < 0 ? '#ef4444' : '#10b981';
    }});

    new Chart(ctxHist, {{
      type: 'bar',
      data: {{
        labels: histLabels,
        datasets: [{{
          data: histCounts,
          backgroundColor: barColors,
          borderRadius: 4
        }}]
      }},
      options: {{
        responsive: true,
        maintainAspectRatio: false,
        plugins: {{ legend: {{ display: false }} }},
        scales: {{
          x: {{ display: false }},
          y: {{
            grid: {{ color: gridColor, drawBorder: false }},
            ticks: {{ color: textColor }}
          }}
        }}
      }}
    }});
  </script>
</body>
</html>"""

out_path = r'C:\Users\tyler\.gemini\antigravity\brain\31b8c500-cc6a-4e1f-9d3f-d34470676109\oos_dashboard.html'
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html_content)

print(f"Generated dashboard at: {out_path}")
