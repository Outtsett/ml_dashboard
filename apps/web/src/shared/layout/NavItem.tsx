import { cn } from "@/shared/utils/utils";
import { Link } from "wouter";
import { prefetchOnHover } from "@/infrastructure/lib/prefetch";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/shared/ui/tooltip";
import type { NavItem } from "@/shared/hooks/navigation";

export const NavItemComponent = ({
  item,
  isActive,
  collapsed,
}: {
  item: NavItem;
  isActive: boolean;
  collapsed: boolean;
}) => {
  const Icon = item.icon;
  const pending = item.pending === true;

  const inner = (
    <div
      data-testid={`nav-${item.label.toLowerCase().replace(/\s+/g, "-")}`}
      data-pending={pending || undefined}
      className={cn(
        "group relative flex items-center gap-2.5 rounded-md border-l-[3px] px-3 py-2 text-sm transition-all",
        pending
          ? "cursor-not-allowed border-transparent text-muted-foreground/40"
          : isActive
            ? "cursor-pointer border-primary bg-primary/10 font-semibold text-primary"
            : "cursor-pointer border-transparent text-muted-foreground hover:bg-muted/50 hover:text-foreground",
      )}
      onMouseEnter={pending ? undefined : prefetchOnHover(item.href)}
    >
      <Icon
        className={cn(
          "min-w-[1rem] shrink-0 transition-all",
          isActive && !pending
            ? "h-[1.125rem] w-[1.125rem] text-primary drop-shadow-[0_0_8px_hsla(210,100%,60%,0.5)]"
            : "h-4 w-4",
          !pending && "group-hover:scale-110",
        )}
      />
      {!collapsed && (
        <>
          <span className="truncate whitespace-nowrap">{item.label}</span>
          {pending && (
            <span
              className="ml-auto rounded-sm bg-white/5 px-1 py-px font-mono text-[8px] uppercase tracking-wider text-muted-foreground/70"
              aria-label="not yet implemented"
            >
              SOON
            </span>
          )}
        </>
      )}
      {isActive && !collapsed && !pending && (
        <div className="absolute right-2 h-1.5 w-1.5 animate-pulse rounded-full bg-primary" />
      )}
    </div>
  );

  // Pending items are not navigable — render as a static div + tooltip.
  const content = pending ? inner : <Link href={item.href}>{inner}</Link>;

  if (collapsed) {
    return (
      <Tooltip delayDuration={0}>
        <TooltipTrigger asChild>{content}</TooltipTrigger>
        <TooltipContent
          side="right"
          sideOffset={12}
          className="border-border bg-popover text-popover-foreground shadow-xl"
        >
          <p className="text-xs font-bold">
            {item.label}
            {pending && " · soon"}
          </p>
          {item.description && (
            <p className="mt-0.5 max-w-[220px] text-[10px] text-muted-foreground">
              {item.description}
            </p>
          )}
        </TooltipContent>
      </Tooltip>
    );
  }

  return content;
};
