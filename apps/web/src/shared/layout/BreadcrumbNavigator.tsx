import React from "react";
import { ChevronRight, Home } from "lucide-react";
import { Link } from "wouter";
import { cn } from "@/shared/utils/utils";
import {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem as BreadcrumbSlot,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/shared/ui/breadcrumb";
import { NavItem } from "@/shared/hooks/navigation";
import { BreadcrumbItem } from "@/shared/hooks/useBreadcrumbs";

export const BreadcrumbNavigator = ({ location, subCrumbs, currentRoute }: { 
  location: string, 
  subCrumbs: BreadcrumbItem[], 
  currentRoute: NavItem | undefined 
}) => {
  const RouteIcon = currentRoute?.icon || Home;
  
  return (
    <div className={cn(
      "border-b border-border bg-background/95 supports-[backdrop-filter]:bg-background/60 backdrop-blur px-4 pb-2 shrink-0 z-10 sticky top-0 shadow-sm",
      window.electronAPI ? "pt-[36px]" : "pt-4 drag-region"
    )}>     
      <Breadcrumb className="no-drag">
        <BreadcrumbList>
          <BreadcrumbSlot>
            <BreadcrumbLink asChild>
              <Link href="/" className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors">
                <Home className="h-3.5 w-3.5" />
              </Link>
            </BreadcrumbLink>
          </BreadcrumbSlot>

          <BreadcrumbSeparator>
            <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
          </BreadcrumbSeparator>

          {subCrumbs.length === 0 ? (
            <BreadcrumbSlot>
              <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                <RouteIcon className="h-3.5 w-3.5 text-primary/80" />
                {currentRoute?.label || "Page"}
              </BreadcrumbPage>
            </BreadcrumbSlot>
          ) : (
            <>
              <BreadcrumbSlot>
                <BreadcrumbLink asChild>
                  <Link href={location} className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium">
                    <RouteIcon className="h-3.5 w-3.5" />
                    {currentRoute?.label || "Page"}
                  </Link>
                </BreadcrumbLink>
              </BreadcrumbSlot>

              {subCrumbs.map((crumb, i) => (
                <React.Fragment key={i}>
                  <BreadcrumbSeparator>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/30" />
                  </BreadcrumbSeparator>
                  <BreadcrumbSlot>
                    {i === subCrumbs.length - 1 ? (
                      <BreadcrumbPage className="flex items-center gap-1.5 text-sm font-bold text-foreground">
                        {crumb.icon && <crumb.icon className="h-3.5 w-3.5 text-primary/80" />}
                        {crumb.label}
                      </BreadcrumbPage>
                    ) : (
                      <BreadcrumbLink
                        {...(crumb.href ? { asChild: true } : {})}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors font-medium"
                      >
                        {crumb.href ? (
                          <Link href={crumb.href}>
                            {crumb.icon && <crumb.icon className="h-3.5 w-3.5" />}
                            {crumb.label}
                          </Link>
                        ) : (
                          <>
                            {crumb.icon && <crumb.icon className="h-3.5 w-3.5" />}
                            {crumb.label}
                          </>
                        )}
                      </BreadcrumbLink>
                    )}
                  </BreadcrumbSlot>
                </React.Fragment>
              ))}
            </>
          )}
        </BreadcrumbList>
      </Breadcrumb>
    </div>
  );
};
