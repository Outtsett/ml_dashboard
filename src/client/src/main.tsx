import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// --- Beta Mode: Heartbeat responder + global error recovery ---
const api = (window as any).electronAPI;
if (api?.onHeartbeatPing) {
  api.onHeartbeatPing(); // auto-responds with pong
}

// Beta mode: auto-recover from fatal errors
let reloadScheduled = false;
function scheduleReload(reason: string, delayMs = 2000) {
  if (reloadScheduled) return;
  reloadScheduled = true;
  console.warn(`[beta] ${reason} — reloading in ${delayMs}ms…`);
  setTimeout(() => window.location.reload(), delayMs);
}

// Catch synchronous errors (React render crashes, etc.)
window.addEventListener("error", (event) => {
  console.error("[beta] Uncaught error:", event.error);
  const msg = event.error?.message || "";
  if (/dynamically imported module|Failed to fetch|Loading chunk/i.test(msg)) {
    scheduleReload("Stale chunk detected", 500);
  } else if (event.error?.stack?.includes("React")) {
    scheduleReload("Fatal React error", 3000);
  }
});

// Catch async failures (dynamic import() rejections)
window.addEventListener("unhandledrejection", (event) => {
  const msg = event.reason?.message || String(event.reason);
  console.error("[beta] Unhandled rejection:", msg);
  if (/dynamically imported module|Failed to fetch|Loading chunk/i.test(msg)) {
    scheduleReload("Dynamic import rejection", 500);
  }
});

createRoot(document.getElementById("root")!).render(<App />);
