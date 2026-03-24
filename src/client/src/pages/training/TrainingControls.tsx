import { useState, useEffect } from "react";

export function TrainingControls() {
  const [running, setRunning] = useState(false);
  const [loading, setLoading] = useState(false);
  const [pid, setPid] = useState<number | null>(null);

  useEffect(() => {
    fetch("/api/training/process-status")
      .then((r) => r.json())
      .then((data) => {
        setRunning(data.running);
        setPid(data.pid);
      })
      .catch(() => {});
  }, []);

  const start = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training/start", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setRunning(true);
        setPid(data.pid);
      }
    } finally {
      setLoading(false);
    }
  };

  const stop = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/training/stop", { method: "POST" });
      if (res.ok) {
        setRunning(false);
        setPid(null);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-between">
      <h1 className="text-base font-mono font-semibold">Training</h1>
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${running ? "bg-emerald-500 animate-pulse" : "bg-neutral-500"}`} />
          <span className="text-xs font-mono text-muted-foreground">
            {running ? `PID ${pid}` : "Idle"}
          </span>
        </div>
        {running ? (
          <button
            onClick={stop}
            disabled={loading}
            className="px-3 py-1 text-xs font-mono bg-red-600/80 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={start}
            disabled={loading}
            className="px-3 py-1 text-xs font-mono bg-emerald-600/80 text-white rounded hover:bg-emerald-600 disabled:opacity-50 transition-colors"
          >
            Start Training
          </button>
        )}
      </div>
    </div>
  );
}
