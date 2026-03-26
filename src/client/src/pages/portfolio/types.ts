import type { Trade } from "@/lib/types";

export type Position = { 
  symbol: string; 
  name: string; 
  quantity: number; 
  avgPrice: number; 
  currentPrice: number; 
  pnl: number; 
  pnlPercent: number 
};

export type AllocationEntry = { 
  name: string; 
  value: number; 
  color: string 
};

export type EquityPoint = { 
  date: string; 
  value: number 
};

export type RecentTrade = { 
  time: string; 
  symbol: string; 
  side: string; 
  qty: number; 
  price: number; 
  pnl: number | null 
};

export const COLORS = ['#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899'];

/** Format price — forex pairs get 5 decimals, others get 2 */
export function fmtPrice(price: number): string {
  return price < 50 ? price.toFixed(5) : price.toFixed(2);
}
