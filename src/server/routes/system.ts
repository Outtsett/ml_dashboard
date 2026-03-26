/**
 * System Routes
 *
 * Hardware monitoring: GPU telemetry via nvidia-smi, system info.
 * GPU metrics are polled server-side and broadcast via the 'system' SSE channel.
 *
 * Routes:
 *   GET  /api/system/gpu          — Current GPU snapshot (VRAM, utilization, temp, power)
 *   GET  /api/system/gpu/info     — Static GPU device info (name, driver, CUDA, compute cap)
 *   POST /api/system/gpu/monitor  — Start/stop periodic GPU metric broadcasting via SSE
 */

import { Router, type Request, type Response } from "express";
import { execFile } from "child_process";
import { promisify } from "util";
import { getEventBus } from "../events/event-bus";
import crypto from "crypto";
import type { EventMetadata } from "@shared/event-types";

const execFileAsync = promisify(execFile);
const router = Router();

// ── Types ────────────────────────────────────────────────────

export interface GpuSnapshot {
  name: string;
  temperatureC: number;
  utilizationGpu: number;
  utilizationMemory: number;
  memoryUsedMB: number;
  memoryFreeMB: number;
  memoryTotalMB: number;
  memoryUsedPct: number;
  powerDrawW: number;
  powerLimitW: number;
  fanSpeedPct: number;
  clockGraphicsMHz: number;
  clockMemoryMHz: number;
  timestamp: number;
}

export interface GpuDeviceInfo {
  name: string;
  driverVersion: string;
  cudaVersion: string;
  computeCapability: string;
  memoryTotalMB: number;
  pciBusId: string;
  architecture: string;
}

// ── nvidia-smi query helpers ─────────────────────────────────

const NVIDIA_SMI = "nvidia-smi";

async function queryGpuSnapshot(): Promise<GpuSnapshot | null> {
  try {
    const { stdout } = await execFileAsync(NVIDIA_SMI, [
      "--query-gpu=name,temperature.gpu,utilization.gpu,utilization.memory,memory.used,memory.free,memory.total,power.draw,power.limit,fan.speed,clocks.current.graphics,clocks.current.memory",
      "--format=csv,noheader,nounits",
    ]);

    const parts = stdout.trim().split(",").map((s) => s.trim());
    if (parts.length < 12) return null;

    // Safe to assert — length check above guarantees indices 0..11 exist
    const p = parts as [string, string, string, string, string, string, string, string, string, string, string, string, ...string[]];
    const memUsed = parseFloat(p[4]);
    const memTotal = parseFloat(p[6]);

    return {
      name: p[0],
      temperatureC: parseFloat(p[1]),
      utilizationGpu: parseFloat(p[2]),
      utilizationMemory: parseFloat(p[3]),
      memoryUsedMB: memUsed,
      memoryFreeMB: parseFloat(p[5]),
      memoryTotalMB: memTotal,
      memoryUsedPct: memTotal > 0 ? Math.round((memUsed / memTotal) * 1000) / 10 : 0,
      powerDrawW: parseFloat(p[7]),
      powerLimitW: parseFloat(p[8]),
      fanSpeedPct: parseFloat(p[9]) || 0,
      clockGraphicsMHz: parseFloat(p[10]),
      clockMemoryMHz: parseFloat(p[11]),
      timestamp: Date.now(),
    };
  } catch {
    return null;
  }
}

async function queryGpuDeviceInfo(): Promise<GpuDeviceInfo | null> {
  try {
    const { stdout } = await execFileAsync(NVIDIA_SMI, [
      "--query-gpu=name,driver_version,pci.bus_id,compute_cap,memory.total",
      "--format=csv,noheader,nounits",
    ]);

    const parts = stdout.trim().split(",").map((s) => s.trim());
    if (parts.length < 5) return null;

    // Safe to assert — length check above guarantees indices 0..4 exist
    const p = parts as [string, string, string, string, string, ...string[]];

    // Get CUDA version from nvidia-smi header
    const { stdout: headerOut } = await execFileAsync(NVIDIA_SMI, []);
    const cudaMatch = headerOut.match(/CUDA Version:\s+([\d.]+)/);

    // Map compute capability to architecture name
    const computeCap = p[3];
    const archMap: Record<string, string> = {
      "7.5": "Turing",
      "8.0": "Ampere",
      "8.6": "Ampere",
      "8.9": "Ada Lovelace",
      "9.0": "Hopper",
      "10.0": "Blackwell",
      "12.0": "Blackwell",
    };

    return {
      name: p[0],
      driverVersion: p[1],
      cudaVersion: cudaMatch?.[1] ?? "unknown",
      computeCapability: computeCap,
      memoryTotalMB: parseFloat(p[4]),
      pciBusId: p[2],
      architecture: archMap[computeCap] ?? "Unknown",
    };
  } catch {
    return null;
  }
}

// ── SSE monitor (periodic broadcast) ─────────────────────────

let monitorInterval: ReturnType<typeof setInterval> | null = null;
let monitorIntervalMs = 2000;

function makeMetadata(): EventMetadata {
  const id = crypto.randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

function startGpuMonitor(intervalMs: number = 2000): void {
  if (monitorInterval) return; // already running
  monitorIntervalMs = intervalMs;

  const bus = getEventBus();

  monitorInterval = setInterval(async () => {
    const snapshot = await queryGpuSnapshot();
    if (!snapshot) return;

    bus.emit({
      type: "system.gpu" as any,
      data: snapshot as any,
      metadata: makeMetadata(),
    });
  }, monitorIntervalMs);
}

function stopGpuMonitor(): void {
  if (monitorInterval) {
    clearInterval(monitorInterval);
    monitorInterval = null;
  }
}

// ── Routes ───────────────────────────────────────────────────

// GET /api/system/gpu — current GPU metrics snapshot
router.get("/system/gpu", async (_req: Request, res: Response) => {
  const snapshot = await queryGpuSnapshot();
  if (!snapshot) {
    res.status(503).json({ error: "GPU not available or nvidia-smi failed" });
    return;
  }
  res.json(snapshot);
});

// GET /api/system/gpu/info — static device info
router.get("/system/gpu/info", async (_req: Request, res: Response) => {
  const info = await queryGpuDeviceInfo();
  if (!info) {
    res.status(503).json({ error: "GPU not available or nvidia-smi failed" });
    return;
  }
  res.json(info);
});

// POST /api/system/gpu/monitor — start or stop SSE broadcasting
router.post("/system/gpu/monitor", (req: Request, res: Response) => {
  const { action, intervalMs } = req.body as { action: "start" | "stop"; intervalMs?: number };

  if (action === "start") {
    startGpuMonitor(intervalMs ?? 2000);
    res.json({ status: "monitoring", intervalMs: monitorIntervalMs });
  } else if (action === "stop") {
    stopGpuMonitor();
    res.json({ status: "stopped" });
  } else {
    res.status(400).json({ error: 'action must be "start" or "stop"' });
  }
});

// Auto-start GPU monitor on import (broadcasts to SSE system channel)
startGpuMonitor(2000);

export default router;

/** Gracefully stop the GPU monitor. */
export function shutdownGpuMonitor(): void {
  stopGpuMonitor();
}
