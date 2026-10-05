import { useEffect } from "react";
import { X } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/shared/utils/utils";
import { useTabStore } from "../store/tabStore";
import { useEntityStore } from "../contexts/EntityContext";

export function WorkspaceTabs() {
  const { openTabs, activeTabId, closeTab, setActiveTab } = useTabStore();
  const [, navigate] = useLocation();
  const { setEntity, activeEntity } = useEntityStore();

  // Sync tab switch to route and entity state
  useEffect(() => {
    const active = openTabs.find(t => t.id === activeTabId);
    if (active) {
      if (activeEntity?.id !== active.id) {
        setEntity(active.type as any, active.id, active.title);
      }
      if (active.path) {
        navigate(active.path);
      }
    }
  }, [activeTabId, openTabs, navigate, setEntity]);

  if (openTabs.length === 0) {
    return null; // Don't show tab bar if nothing is open
  }

  return (
    <div className="flex w-full h-9 bg-neutral-950 border-b border-neutral-800 shrink-0 overflow-x-auto scrollbar-none">
      {openTabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "group relative flex items-center gap-2 px-3 h-full border-r border-neutral-800 min-w-[120px] max-w-[200px] cursor-pointer transition-colors select-none",
              isActive ? "bg-neutral-900 text-blue-400" : "bg-neutral-950 text-neutral-500 hover:bg-neutral-900/50 hover:text-neutral-300"
            )}
          >
            {/* Active Indicator Line */}
            {isActive && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500" />}
            
            <span className="text-xs truncate flex-1 font-medium">{tab.title}</span>
            
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              className="p-0.5 rounded-sm opacity-0 group-hover:opacity-100 hover:bg-neutral-700 transition-all text-neutral-400 hover:text-neutral-200"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        );
      })}
    </div>
  );
}
