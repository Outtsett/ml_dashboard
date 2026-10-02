import { useEffect, useState, useCallback, useMemo } from "react";
import { useLocation } from "wouter";
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandSeparator,
} from "@/shared/ui/command";
import { Keyboard } from "lucide-react";
import { NAVIGATION_CONFIG } from "@/shared/hooks/navigation";

/** Per-route extra keywords. Lets users find pages by terms that don't appear
 *  in the visible label (e.g. "pnl" → Positions, "vaR" → Risk). */
const KEYWORDS: Record<string, string[]> = {
  "/": ["chart", "trading", "forex", "symbol", "market"],
  // Risk and RL Console are tabs now, not routes, so their search terms point
  // at the page that holds them — otherwise "var" or "optuna" finds nothing.
  "/portfolio": [
    "positions",
    "trades",
    "pnl",
    "equity curve",
    "risk",
    "var",
    "expected shortfall",
    "exposure",
    "drawdown",
    "correlation",
  ],
  "/watchlist": ["watch", "instruments", "monitor"],
  "/ml-studio": [
    "train",
    "model",
    "pipeline",
    "features",
    "labels",
    "rl console",
    "ppo",
    "dqn",
    "hpo",
    "optuna",
    "tuning",
    "trials",
  ],
  "/glossary": ["term", "symbol", "acronym", "definition", "notation", "jargon"],
  "/model-catalog": ["models", "catalog", "library", "registry", "specs"],
  "/databases": ["lake", "sqlite", "data", "freshness", "parquet"],
  "/experiments": ["ledger", "runs", "history", "sharpe", "results"],
  "/backtest": ["walk-forward", "monte carlo", "benchmark", "costs"],
  "/registry": ["promote", "rollback", "lineage", "version"],
  "/paper": ["drift", "calibration", "latency", "inference"],
  "/news": ["articles", "feed", "sentiment"],
  "/terminals": ["shell", "tty", "bash", "pty"],
  "/hardware": ["gpu", "cpu", "ram", "vram", "telemetry"],
  "/settings": ["config", "preferences", "performance"],
};

const isMac = typeof navigator !== "undefined" && navigator.platform.includes("Mac");

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [, setLocation] = useLocation();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const navigateTo = useCallback((href: string) => {
    setLocation(href);
    setOpen(false);
  }, [setLocation]);

  const shortcutLabel = useMemo(() => (isMac ? "⌘" : "Ctrl+"), []);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a page name or keyword..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {NAVIGATION_CONFIG.map((group) => {
          // Only navigate to items that are actually wired. Pending items are
          // displayed but dimmed and refuse to navigate.
          const items = group.items;
          if (items.length === 0) return null;
          return (
            <CommandGroup key={group.title} heading={group.title}>
              {items.map((item) => {
                const kw = KEYWORDS[item.href] ?? [];
                const pending = item.pending === true;
                return (
                  <CommandItem
                    key={item.href}
                    value={`${item.label} ${kw.join(" ")}`}
                    onSelect={() => {
                      if (pending) return;
                      navigateTo(item.href);
                    }}
                    className={
                      pending
                        ? "cursor-not-allowed gap-3 opacity-50"
                        : "cursor-pointer gap-3"
                    }
                  >
                    <item.icon className="h-4 w-4 text-muted-foreground" />
                    <span>{item.label}</span>
                    {pending && (
                      <span className="ml-auto rounded-sm bg-white/5 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground">
                        soon
                      </span>
                    )}
                  </CommandItem>
                );
              })}
            </CommandGroup>
          );
        })}
        <CommandSeparator />
        <CommandGroup heading="Quick Actions">
          <CommandItem
            value="keyboard shortcuts help"
            onSelect={() => setOpen(false)}
            className="gap-3"
          >
            <Keyboard className="h-4 w-4 text-muted-foreground" />
            <span>Keyboard Shortcuts</span>
            <span className="ml-auto text-xs text-muted-foreground">{shortcutLabel}1-7</span>
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
