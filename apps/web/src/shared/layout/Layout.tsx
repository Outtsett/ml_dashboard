import { Suspense, useEffect, useState } from "react";
import { TopBar } from "../quant-layout/TopBar";
import { LeftSidebar } from "../quant-layout/LeftSidebar";
import { HorizontalNav } from "../quant-layout/HorizontalNav";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { ErrorBoundary } from "@/shared/layout/ErrorBoundary";

const NAV_COLLAPSED_STORAGE_KEY = "left-nav-collapsed-v1";

/** Whether the navigation rail was last left popped in (icons only). */
function loadNavCollapsed(): boolean {
  try {
    return localStorage.getItem(NAV_COLLAPSED_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(loadNavCollapsed);

  // A plain function: the React Compiler memoizes it.
  const toggleNav = () => {
    setCollapsed((c) => {
      const next = !c;
      try {
        localStorage.setItem(NAV_COLLAPSED_STORAGE_KEY, String(next));
      } catch {
        // A full quota must not stop the rail from moving.
      }
      return next;
    });
  };
  // Ctrl+B collapses the navigation.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key === "b") {
        e.preventDefault();
        toggleNav();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggleNav]);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white flex flex-col font-sans selection:bg-primary/30">

      {/* 1. Top Navigation Bar */}
      <TopBar />
      <HorizontalNav />

      <div className="flex-1 flex overflow-hidden">
        {/* 2. Left Sidebar Navigation */}
        <LeftSidebar collapsed={collapsed} onToggle={toggleNav} />

        {/* 3. Main Canvas */}
        <main className="flex-1 min-w-0 bg-neutral-950 flex flex-col overflow-hidden relative">
          <ErrorBoundary>
            <Suspense fallback={<PageLoader />}>
              <div className="flex-1 flex flex-col overflow-hidden relative">
                {children}
              </div>
            </Suspense>
          </ErrorBoundary>

        </main>
      </div>
    </div>
  );
}
