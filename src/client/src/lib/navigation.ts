import { 
  Home, 
  Database, 
  Settings, 
  Server, 
  BarChart2, 
  List, 
  Newspaper, 
  BrainCircuit, 
  BookOpen, 
  AudioWaveform, 
  Network,
  LucideIcon 
} from "lucide-react";

export interface NavItem {
  icon: LucideIcon;
  label: string;
  href: string;
  description?: string;
}

export interface NavGroup {
  title: string;
  items: NavItem[];
}

export const NAVIGATION_CONFIG: NavGroup[] = [
  {
    title: "Market & Data",
    items: [
      { icon: Database, label: "Market Data", href: "/" },
      { icon: List, label: "Watchlist", href: "/watchlist" },
      { icon: Newspaper, label: "News", href: "/news" },
      { icon: Server, label: "Databases", href: "/databases" },
    ]
  },
  {
    title: "Analysis & Models",
    items: [
      { icon: BrainCircuit, label: "ML Studio", href: "/ml-studio" },
      { icon: BookOpen, label: "Model Catalog", href: "/model-catalog" },
      { icon: AudioWaveform, label: "Fourier Analysis", href: "/fourier" },
      { icon: Network, label: "Architecture", href: "/architecture" },
    ]
  },
  {
    title: "Execution",
    items: [
      { icon: BarChart2, label: "Portfolio", href: "/portfolio" },
    ]
  },
  {
    title: "System",
    items: [
      { icon: Settings, label: "Settings", href: "/settings" },
    ]
  }
];

export const getRouteMeta = () => {
  const meta: Record<string, NavItem> = {};
  NAVIGATION_CONFIG.forEach(group => {
    group.items.forEach(item => {
      meta[item.href] = item;
    });
  });
  return meta;
};

export const ROUTE_META = getRouteMeta();
