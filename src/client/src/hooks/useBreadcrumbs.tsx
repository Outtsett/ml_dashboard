import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: LucideIcon;
}

interface BreadcrumbContextValue {
  items: BreadcrumbItem[];
  setItems: (items: BreadcrumbItem[]) => void;
}

const BreadcrumbContext = createContext<BreadcrumbContextValue>({
  items: [],
  setItems: () => {},
});

export function BreadcrumbProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<BreadcrumbItem[]>([]);

  return (
    <BreadcrumbContext.Provider value={{ items, setItems }}>
      {children}
    </BreadcrumbContext.Provider>
  );
}

/**
 * Hook for pages to register their breadcrumb trail.
 * Call with an array of crumb items — they will be appended after the
 * auto-detected page crumb rendered in Layout.
 * 
 * Cleans up on unmount so stale crumbs don't linger.
 */
export function useBreadcrumbs(crumbs: BreadcrumbItem[]) {
  const { setItems } = useContext(BreadcrumbContext);

  useEffect(() => {
    setItems(crumbs);
    return () => setItems([]);
  }, [JSON.stringify(crumbs)]);
}

export function useBreadcrumbItems() {
  return useContext(BreadcrumbContext).items;
}
