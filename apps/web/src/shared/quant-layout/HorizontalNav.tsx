import * as NavigationMenu from "@radix-ui/react-navigation-menu";
import { Link, useLocation } from "wouter";
import { cn } from "@/shared/utils/utils";
import { BrainCircuit, Database, BookMarked, BarChart3, Activity } from "lucide-react";

const NAV_ITEMS = [
  { label: "Market", href: "/", icon: BarChart3 },
  { label: "Analytics", href: "/analytics", icon: Activity },
  { label: "AI Studio", href: "/training", icon: BrainCircuit },
  { label: "Data", href: "/databases", icon: Database },
  { label: "Knowledge", href: "/studies", icon: BookMarked },
];

export function HorizontalNav() {
  const [pathname] = useLocation();

  return (
    <div className="w-full h-10 bg-neutral-950 border-b border-neutral-800 flex items-center shrink-0 overflow-x-auto overflow-y-hidden px-2 scrollbar-none">
      <NavigationMenu.Root className="flex-1">
        <NavigationMenu.List className="flex flex-row items-center gap-1 w-full m-0 list-none">
          {NAV_ITEMS.map((item) => {
            let isActive = false;
            if (item.href === "/") {
              isActive = pathname === "/";
            } else if (item.href === "/analytics") {
              isActive = pathname.startsWith("/analytics") || pathname.startsWith("/models") || pathname.startsWith("/model-catalog");
            } else if (item.href === "/training") {
              isActive = pathname.startsWith("/training");
            } else if (item.href === "/studies") {
              isActive = pathname.startsWith("/studies") || pathname.startsWith("/glossary") || pathname.startsWith("/knowledge");
            } else {
              isActive = pathname.startsWith(item.href);
            }
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

