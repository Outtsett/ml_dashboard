import { Suspense, useCallback, useEffect, useState } from "react";
import { TopBar } from "../quant-layout/TopBar";
import { LeftSidebar } from "../quant-layout/LeftSidebar";
import { RightSidebar } from "../quant-layout/RightSidebar";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { ErrorBoundary } from "@/shared/layout/ErrorBoundary";

const SIDE_PANEL_STORAGE_KEY = "side-panel-open-v1";

/** Closed unless it was left open: the chart gets the whole window by default. */
function loadSidePanelOpen(): boolean {
  try {
    return localStorage.getItem(SIDE_PANEL_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [sidePanelOpen, setSidePanelOpen] = useState(loadSidePanelOpen);

  const toggleSidePanel = useCallback(() => {
    setSidePanelOpen((open) => {
      const next = !open;
      try {
        localStorage.setItem(SIDE_PANEL_STORAGE_KEY, String(next));
      } catch {
        // A full quota must not stop the panel from opening.
      }
      return next;
    });
  }, []);

  // Ctrl+B collapses the navigation; Ctrl+J opens the metrics drawer.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "b") {
        e.preventDefault();
        setCollapsed((c) => !c);
      } else if (e.key === "j") {
        e.preventDefault();
        toggleSidePanel();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleSidePanel]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white flex flex-col font-sans selection:bg-primary/30">

      {/* 1. Top Navigation Bar */}
      <TopBar sidePanelOpen={sidePanelOpen} onToggleSidePanel={toggleSidePanel} />

      <div className="flex-1 flex overflow-hidden">
        {/* 2. Left Sidebar Navigation */}
        <LeftSidebar collapsed={collapsed} />

        {/* 3. Main Canvas — the side panel opens OVER this, so the chart keeps
               its width and never has to re-measure and redraw. */}
        <main className="flex-1 min-w-0 bg-neutral-950 flex flex-col overflow-hidden relative">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <div className="flex-1 flex flex-col overflow-hidden relative">
                {children}
              </div>
            </Suspense>
          </ErrorBoundary>

          <RightSidebar open={sidePanelOpen} onClose={toggleSidePanel} />
        </main>
      </div>
    </div>
  );
}
