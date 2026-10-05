import { useState, useEffect } from "react";
import { ResponsiveGridLayout, useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export interface MarketGridLayoutProps {
  chartElement: React.ReactNode;
  mlStudioElement: React.ReactNode;
  terminalElement: React.ReactNode;
}

const defaultLayouts = {
  lg: [
    { i: "chart", x: 0, y: 0, w: 9, h: 20 },
    { i: "ml", x: 9, y: 0, w: 3, h: 20 },
    { i: "terminal", x: 0, y: 20, w: 12, h: 10 },
  ],
  md: [
    { i: "chart", x: 0, y: 0, w: 8, h: 16 },
    { i: "ml", x: 8, y: 0, w: 4, h: 16 },
    { i: "terminal", x: 0, y: 16, w: 12, h: 10 },
  ],
  sm: [
    { i: "chart", x: 0, y: 0, w: 12, h: 14 },
    { i: "ml", x: 0, y: 14, w: 12, h: 12 },
    { i: "terminal", x: 0, y: 26, w: 12, h: 10 },
  ],
};

export function MarketGridLayout({
  chartElement,
  mlStudioElement,
  terminalElement,
}: MarketGridLayoutProps) {
  const { width, containerRef, mounted } = useContainerWidth();
  const [layouts, setLayouts] = useState(() => {
    const saved = localStorage.getItem("market-grid-layout");
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {}
    }
    return defaultLayouts;
  });

  // react-grid-layout v2: `Layout` is the item array itself; breakpoint map is partial.
  const onLayoutChange = (_layout: Layout, allLayouts: Partial<Record<"lg" | "md" | "sm" | "xs" | "xxs", Layout>>) => {
    setLayouts(allLayouts);
    localStorage.setItem("market-grid-layout", JSON.stringify(allLayouts));
  };

  return (
    <div ref={containerRef} className="flex-1 w-full h-full overflow-y-auto bg-neutral-950">
      {mounted && (
        <ResponsiveGridLayout
          className="layout"
          width={width}
          layouts={layouts}
          breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
          cols={{ lg: 12, md: 12, sm: 12, xs: 12, xxs: 12 }}
          rowHeight={30}
          onLayoutChange={onLayoutChange}
          // v2 API: `draggableHandle` is a legacy prop and is silently ignored here, which made the
          // whole tile a drag surface — panning the chart dragged the panel.
          dragConfig={{ handle: ".drag-handle" }}
        >
        <div key="chart" className="flex flex-col border border-white/[0.05] bg-black rounded-md shadow-sm overflow-hidden">
          <div className="drag-handle flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.05] cursor-move text-xs font-medium text-foreground/80 hover:bg-white/[0.04] transition-colors">
            <span>Market Chart</span>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {chartElement}
          </div>
        </div>

        <div key="ml" className="flex flex-col border border-white/[0.05] bg-black rounded-md shadow-sm overflow-hidden">
          <div className="drag-handle flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.05] cursor-move text-xs font-medium text-foreground/80 hover:bg-white/[0.04] transition-colors">
            <span>ML Workflow & Studio</span>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {mlStudioElement}
          </div>
        </div>

        <div key="terminal" className="flex flex-col border border-white/[0.05] bg-black rounded-md shadow-sm overflow-hidden">
          <div className="drag-handle flex items-center justify-between px-3 py-1.5 bg-white/[0.02] border-b border-white/[0.05] cursor-move text-xs font-medium text-foreground/80 hover:bg-white/[0.04] transition-colors">
            <span>Terminal & Logs</span>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            {terminalElement}
          </div>
        </div>
      </ResponsiveGridLayout>
      )}
    </div>
  );
}
