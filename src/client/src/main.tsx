import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// --- Beta Mode: Heartbeat responder + global error recovery ---
const api = (window as any).electronAPI;
if (api?.onHeartbeatPing) {
  api.onHeartbeatPing(); // auto-responds with pong
}

// Catch truly fatal errors and auto-reload after a brief delay
let reloadScheduled = false;
window.addEventListener("error", (event) => {
  console.error("[beta] Uncaught error:", event.error);
  // Only auto-reload for fatal rendering errors, not network/resource errors
  if (!reloadScheduled && event.error?.stack?.includes("React")) {
    reloadScheduled = true;
    console.warn("[beta] Fatal React error — reloading in 3s...");
    setTimeout(() => window.location.reload(), 3000);
  }
});

createRoot(document.getElementById("root")!).render(<App />);
