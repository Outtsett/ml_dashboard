import { cn } from "@/lib/utils";
import { Link } from "wouter";
import { prefetchOnHover } from "@/lib/prefetch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { NavItem } from "@/lib/navigation";

export const NavItemComponent = ({ 
  item, 
  isActive, 
  collapsed 
}: { 
  item: NavItem, 
  isActive: boolean, 
  collapsed: boolean 
}) => {
  const Icon = item.icon;
  
  const content = (
    <Link href={item.href}>
      <div
        data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, '-')}`}
        className={cn(
          "flex items-center gap-2.5 px-3 py-2 cursor-pointer transition-all text-sm rounded-md group relative",
          isActive
            ? "bg-primary/10 text-primary font-semibold border-l-[3px] border-primary"
            : "text-muted-foreground hover:text-foreground hover:bg-muted/50 border-l-[3px] border-transparent"
        )}
        onMouseEnter={prefetchOnHover(item.href)}
      >
        <Icon className={cn(
          "min-w-[1rem] transition-all shrink-0",
          isActive 
            ? "h-[1.125rem] w-[1.125rem] text-primary drop-shadow-[0_0_8px_hsla(210,100%,60%,0.5)]" 
            : "h-4 w-4 group-hover:scale-110"
        )} />
        {!collapsed && <span className="whitespace-nowrap truncate">{item.label}</span>}
        {isActive && !collapsed && (
          <div className="absolute right-2 h-1.5 w-1.5 rounded-full bg-primary animate-pulse" />
        )}
      </div>
    </Link>
  );

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12} className="bg-popover border-border text-popover-foreground shadow-xl">
          <p className="text-xs font-bold">{item.label}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
};
