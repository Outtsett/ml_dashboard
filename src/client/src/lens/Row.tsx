/**
 * LensRow — two views side by side with a draggable splitter between them.
 *
 * The split is remembered per row (react-resizable-panels writes it to local
 * storage under `autoSaveId`). Below the wide breakpoint there is no room to
 * split anything, so the two views stack and the splitter disappears rather
 * than becoming a 40-pixel-wide panel nobody can read.
 */

import { useEffect, useState, type ReactNode } from "react";
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/shared/ui/resizable";

const WIDE_SCREEN = "(min-width: 1280px)";

function useWideScreen(): boolean {
  const [wide, setWide] = useState(() =>
    typeof window !== "undefined" && typeof window.matchMedia === "function"
      ? window.matchMedia(WIDE_SCREEN).matches
      : true,
  );
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const query = window.matchMedia(WIDE_SCREEN);
    const onChange = (event: MediaQueryListEvent) => setWide(event.matches);
    query.addEventListener("change", onChange);
    setWide(query.matches);
    return () => query.removeEventListener("change", onChange);
  }, []);
  return wide;
}

export interface LensRowProps {
  /** Storage slot for the split position. */
  id: string;
  left: ReactNode;
  right: ReactNode;
  /** Percentage width of the left view before anyone drags it. */
  defaultLeftPercent?: number;
  minPercent?: number;
}

export function LensRow({ id, left, right, defaultLeftPercent = 66, minPercent = 20 }: LensRowProps) {
  const wide = useWideScreen();

  if (!wide) {
    return (
      <div className="flex flex-col gap-3" data-testid={`lens-row-${id}`}>
        {left}
        {right}
      </div>
    );
  }

  return (
    <ResizablePanelGroup
      direction="horizontal"
      autoSaveId={`lens-row:${id}`}
      className="h-auto items-stretch gap-0"
      data-testid={`lens-row-${id}`}
    >
      <ResizablePanel defaultSize={defaultLeftPercent} minSize={minPercent} className="flex min-w-0 flex-col">
        {left}
      </ResizablePanel>
      <ResizableHandle withHandle className="mx-1.5 bg-transparent" />
      <ResizablePanel defaultSize={100 - defaultLeftPercent} minSize={minPercent} className="flex min-w-0 flex-col">
        {right}
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
