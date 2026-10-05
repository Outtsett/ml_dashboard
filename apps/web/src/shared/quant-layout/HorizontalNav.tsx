import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { Link, useLocation } from "wouter";
import { cn } from "@/shared/utils/utils";
import { Library, Database, BookMarked, BarChart3, Radio, Compass } from "lucide-react";

const NAV_ITEMS = [
  { label: "Assets", href: "/", icon: BarChart3 },
  { label: "Models", href: "/models", icon: Library },
  { label: "Inference", href: "/live", icon: Radio },
  { label: "Datasets", href: "/databases", icon: Database },
  { label: "Experiments", href: "/analytics", icon: Compass },
  { label: "Knowledge", href: "/glossary", icon: BookMarked },
];

export function HorizontalNav() {
  const [location] = useLocation();

  return (
    <div className="w-full h-10 bg-neutral-950 border-b border-neutral-800 flex items-center shrink-0 overflow-x-auto overflow-y-hidden px-2 scrollbar-none">
      <NavigationMenu.Root className="flex-1">
        <NavigationMenu.List className="flex flex-row items-center gap-1 w-full m-0 list-none">
          {NAV_ITEMS.map((item) => {
            const isActive = item.href === "/" ? location === item.href : location.startsWith(item.href);
            const Icon = item.icon;
            
            return (
              <NavigationMenu.Item key={item.href}>
                <Link
                  href={item.href}
                  data-testid={`nav-${item.href === "/" ? "market" : item.href.slice(1)}`}
                  aria-label={item.label}
                  className="block outline-none"
                >
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-md transition-colors whitespace-nowrap",
                    isActive 
                      ? "bg-blue-500/10 text-blue-400 font-medium" 
                      : "text-neutral-400 hover:text-neutral-200 hover:bg-neutral-800/50"
                  )}>
                    <Icon className="h-4 w-4" />
                    <span className="text-xs tracking-wide">{item.label}</span>
                  </div>
                </Link>
              </NavigationMenu.Item>
            );
          })}
        </NavigationMenu.List>
      </NavigationMenu.Root>
    </div>
  );
}

