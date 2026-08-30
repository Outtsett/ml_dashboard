import { Suspense, useState, useEffect } from "react";
import { TopBar } from "../quant-layout/TopBar";
import { LeftSidebar } from "../quant-layout/LeftSidebar";
import { RightSidebar } from "../quant-layout/RightSidebar";
import { PageLoader } from "@/shared/layout/LoadingSkeletons";
import { ErrorBoundary } from "@/shared/layout/ErrorBoundary";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);

  // Keyboard shortcut: Ctrl+B to toggle sidebar
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
        e.preventDefault();
        setCollapsed(c => !c);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  return (
    <div className="h-screen w-screen overflow-hidden bg-black text-white flex flex-col font-sans selection:bg-primary/30">
      
      {/* 1. Top Navigation Bar */}
      <TopBar />

      <div className="flex-1 flex overflow-hidden">
        {/* 2. Left Sidebar Navigation */}
        <LeftSidebar collapsed={collapsed} />

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

        {/* 4. Right Sidebar */}
        <RightSidebar />
      </div>
    </div>
  );
}
