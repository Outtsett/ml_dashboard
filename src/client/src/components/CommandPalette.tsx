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
} from "@/components/ui/command";
import {
  Database, List, Newspaper, Server, BrainCircuit, BookOpen,
  AudioWaveform, Network, BarChart2, Settings,
  Search, Keyboard,
} from "lucide-react";

const NAV_ITEMS = [
  { icon: Database, label: "Market Data", href: "/", keywords: ["chart", "trading", "forex", "symbol"] },
  { icon: BrainCircuit, label: "ML Studio", href: "/ml-studio", keywords: ["train", "model", "curriculum", "backtest"] },
  { icon: BookOpen, label: "Model Catalog", href: "/model-catalog", keywords: ["models", "catalog", "registry"] },
  { icon: AudioWaveform, label: "Fourier Analysis", href: "/fourier", keywords: ["fft", "frequency", "spectral"] },
  { icon: Network, label: "Architecture", href: "/architecture", keywords: ["system", "pipeline", "diagram"] },
  { icon: BarChart2, label: "Portfolio", href: "/portfolio", keywords: ["positions", "trades", "pnl"] },
  { icon: List, label: "Watchlist", href: "/watchlist", keywords: ["watch", "instruments", "monitor"] },
  { icon: Newspaper, label: "News", href: "/news", keywords: ["articles", "feed", "sentiment"] },
  { icon: Server, label: "Databases", href: "/databases", keywords: ["questdb", "sqlite", "data"] },
  { icon: Settings, label: "Settings", href: "/settings", keywords: ["config", "preferences", "performance"] },
] as const;

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
        <CommandGroup heading="Navigation">
          {NAV_ITEMS.map((item) => (
            <CommandItem
              key={item.href}
              value={`${item.label} ${item.keywords.join(" ")}`}
              onSelect={() => navigateTo(item.href)}
              className="gap-3 cursor-pointer"
            >
              <item.icon className="h-4 w-4 text-muted-foreground" />
              <span>{item.label}</span>
            </CommandItem>
          ))}
        </CommandGroup>
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
