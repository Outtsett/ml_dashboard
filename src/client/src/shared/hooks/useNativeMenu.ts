import { useEffect } from "react";
import { useLocation } from "wouter";

/**
 * Listens for native menu actions from Electron and dispatches
 * them as route navigations, custom DOM events, or direct API calls.
 */
export function useNativeMenu() {
  const [, setLocation] = useLocation();

  useEffect(() => {
    const api = window.electronAPI;
    if (!api?.onMenuAction) return;

    return api.onMenuAction((action: string) => {
      if (action.startsWith("navigate:")) {
        setLocation(action.replace("navigate:", ""));
        return;
      }

      switch (action) {
        case "toggle-sidebar":
          window.dispatchEvent(new CustomEvent("toggle-sidebar"));
          break;
        case "open-questdb":
          window.open("http://localhost:9000", "_blank");
          break;
        case "open-logs":
          api.openLogsFolder?.();
          break;
        case "import-data":
          window.dispatchEvent(new CustomEvent("menu-import-data"));
          break;
        case "export-results":
          window.dispatchEvent(new CustomEvent("menu-export-results"));
          break;
        default:
          // Forward unhandled actions as generic CustomEvents
          window.dispatchEvent(
            new CustomEvent("menu-action", { detail: action }),
          );
      }
    });
  }, [setLocation]);
}
