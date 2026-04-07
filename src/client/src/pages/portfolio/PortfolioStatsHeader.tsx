import { Wallet, DollarSign, TrendingUp, Target } from "lucide-react";
import type { Trade } from "@/lib/types";
import type { Position } from "./types";
import { StatCard } from "@/components/ui/stat-card";

interface PortfolioStatsHeaderProps {
  isLoading: boolean;
  positions: Position[];
  closedTradesRaw: Trade[];
  totalValue: number;
  totalPnL: number;
  dailyPnL: number;
  winRate: number | null;
}

export function PortfolioStatsHeader({
  isLoading,
  positions,
  closedTradesRaw,
  totalValue,
  totalPnL,
  dailyPnL,
  winRate,
}: PortfolioStatsHeaderProps) {
  return (
    <div className="grid grid-cols-4 gap-4 shrink-0">
      <StatCard
        label="Portfolio Value"
        value={positions.length > 0 ? `$${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
        icon={Wallet}
        color="violet"
        loading={isLoading}
      />
      <StatCard
        label="Total P&L"
        value={closedTradesRaw.length > 0 ? `${totalPnL >= 0 ? "+" : ""}$${totalPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
        icon={DollarSign}
        color={totalPnL >= 0 ? "emerald" : "rose"}
        loading={isLoading}
      />
      <StatCard
        label="Today's P&L"
        value={closedTradesRaw.length > 0 ? `${dailyPnL >= 0 ? "+" : ""}$${dailyPnL.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "--"}
        icon={TrendingUp}
        color={dailyPnL >= 0 ? "cyan" : "rose"}
        loading={isLoading}
      />
      <StatCard
        label="Win Rate"
        value={winRate !== null ? `${winRate}%` : "--"}
        subValue={winRate !== null ? `${closedTradesRaw.length} trades` : undefined}
        icon={Target}
        color="amber"
        loading={isLoading}
      />
    </div>
  );
}
