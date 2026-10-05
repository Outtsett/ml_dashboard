import si from 'systeminformation';
import { Router, type Request, type Response } from 'express';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { getEventBus } from '../infrastructure/events/event-bus.js';
import { getNestApp } from '../infrastructure/lib/nest-context.js';
import { ManifestService, type SystemManifest } from '../infrastructure/core/manifest.service.js';
import { log } from '../infrastructure/lib/log.js';
import type { DomainEvent } from '@shared/event-types.js';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';

const router = Router();

// --- Types ---

export interface SystemSnapshot {
  cpu: {
    load: number;
    cores: number[];
    temp: number;
    speed: number;
  };
  mem: {
    total: number;
    active: number;
    used: number;
    swaptotal: number;
    swapused: number;
  };
  network: {
    tx_sec: number;
    rx_sec: number;
  };
  gpu?: GpuSnapshot;
  processes?: unknown[];
  timestamp: number;
}

/**
 * The GPU payload exactly as `scripts/hardware_node.py` emits it (see gpu_data,
 * hardware_node.py:61-75). camelCase on the wire — the client reads these keys
 * verbatim off the `system.gpu` SSE channel (SystemStats.tsx:62, GpuPage.tsx:340).
 *
 * NOTE: this is NOT the shape of SystemManifest['hardware']['gpu'] in
 * manifest.service.ts, which declares snake_case (utilization / memory_used_mb /
 * temperature) and shares no keys with this. That manifest field is never
 * populated by anything — the live GPU feed reaches the client over SSE, not the
 * manifest. Do not assign a GpuSnapshot onto it.
 */
/** The canonical `system.gpu` payload — single source of truth in shared/event-types.ts:149. */
type GpuEventData = Extract<DomainEvent, { type: 'system.gpu' }>['data'];

/**
 * The GPU payload exactly as `scripts/hardware_node.py` emits it (gpu_data,
 * hardware_node.py:61-75): the canonical event payload MINUS `timestamp`, which
 * the Python node does not put inside gpu_data — it lives on the enclosing
 * snapshot. The emit below re-attaches it so the event satisfies its contract.
 *
 * Derived from the canonical type rather than re-declared, so a change to the
 * event contract breaks here instead of drifting silently.
 */
export type GpuSnapshot = Omit<GpuEventData, 'timestamp'>;

// --- Python Node Controller ---

let pythonNode: ChildProcessWithoutNullStreams | null = null;
let lastSnapshot: SystemSnapshot | null = null;
let lastNetBytes: { tx: number, rx: number, ts: number } | null = null;

/**
 * Hardware telemetry is a nice-to-have, so a broken node must degrade rather
 * than loop. Restarts are counted and capped: the node used to respawn
 * unconditionally every 5s, which on any machine without the hardcoded
 * interpreter meant a permanent crash loop for the life of the process.
 *
 * The counter resets as soon as the node emits a valid update, so the cap means
 * "five failures in a row" rather than "five failures ever".
 */
let hardwareNodeRestarts = 0;
let hardwareNodeDisabled = false;
const MAX_HARDWARE_NODE_RESTARTS = 5;

/**
 * The interpreter that runs `scripts/hardware_node.py`.
 *
 * Order: explicit override, then the repo's own virtualenv, then PATH.
 *
 * This used to be the literal `C:\Users\tyler\anaconda3\python.exe`, which meant
 * telemetry could only ever start on one machine. Falling back to a bare
 * `python` fixed that and introduced a quieter version of the same problem:
 * `hardware_node.py` imports `psutil` and `pynvml`, and on this machine the repo
 * `.venv` has them while the `python` that PATH resolves to does not. The script
 * would exit 1 on ModuleNotFoundError, the counted-restart path below would give
 * up, and GPU/CPU telemetry would go dark after ~25 seconds — on the developer
 * machine, which is the one place it is actually wanted.
 *
 * `.venv` is the project interpreter the deployment checklist and pyproject both
 * describe, so it is what gets tried first.
 */
function resolveHardwareNodePython(): string {
  if (process.env.HARDWARE_NODE_PYTHON) return process.env.HARDWARE_NODE_PYTHON;

  const venv =
    process.platform === 'win32'
      ? path.resolve(process.cwd(), '.venv', 'Scripts', 'python.exe')
      : path.resolve(process.cwd(), '.venv', 'bin', 'python3');
  if (fs.existsSync(venv)) return venv;

  return process.platform === 'win32' ? 'python' : 'python3';
}

function makeMetadata() {
  const id = crypto.randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

function startHardwareNode() {
  if (pythonNode || hardwareNodeDisabled) return;

  const scriptPath = path.resolve(process.cwd(), 'scripts', 'hardware_node.py');
  const pythonPath = resolveHardwareNodePython();

  log(`Starting Python node: ${scriptPath} (${pythonPath})`, 'HardwareNode');

  pythonNode = spawn(pythonPath, [scriptPath]);

  /**
   * Without this listener a failed spawn is an unhandled 'error' event, which
   * Node throws. It landed in the global uncaughtException handler in main.ts —
   * which deliberately does not exit — so the process stayed up, the 'close'
   * handler below rescheduled, and the whole thing repeated every 5 seconds
   * forever. An absent interpreter is a normal condition, not an exception.
   */
  pythonNode.on('error', (err: NodeJS.ErrnoException) => {
    pythonNode = null;

    // A missing or unusable interpreter will not fix itself, so stop immediately
    // and say what to set. Anything else — a transient EAGAIN under load, say —
    // goes through the same counted-restart path as a normal exit rather than
    // permanently disabling telemetry on one bad spawn.
    if (err.code === 'ENOENT' || err.code === 'EACCES') {
      hardwareNodeDisabled = true;
      console.warn(
        `[HardwareNode] disabled: interpreter "${pythonPath}" is ${
          err.code === 'ENOENT' ? 'not found' : 'not executable'
        } — set HARDWARE_NODE_PYTHON to override. GPU/CPU telemetry will be unavailable.`,
      );
      return;
    }

    console.warn(`[HardwareNode] spawn failed: ${err.message}. Will retry.`);
  });

  pythonNode.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const update = JSON.parse(line);
        if (update.type === 'hardware_node_update') {
          // A parsed update means this spawn is working, so the crash-loop
          // counter starts over. Without this reset it was a LIFETIME cap: five
          // unrelated restarts spread across days of uptime — a GPU driver
          // reload, a laptop resume — would permanently disable telemetry even
          // though the node recovered cleanly every time.
          hardwareNodeRestarts = 0;
          // Calculate network deltas
          let tx_sec = 0;
          let rx_sec = 0;
          const now = Date.now();
          
          if (lastNetBytes) {
            const dt = (now - lastNetBytes.ts) / 1000;
            if (dt > 0) {
              tx_sec = Math.max(0, (update.network.total_tx - lastNetBytes.tx) / dt);
              rx_sec = Math.max(0, (update.network.total_rx - lastNetBytes.rx) / dt);
            }
          }
          lastNetBytes = { tx: update.network.total_tx, rx: update.network.total_rx, ts: now };

          const snapshot: SystemSnapshot = {
            cpu: update.cpu,
            mem: {
              ...update.mem,
              active: update.mem.active ?? update.mem.used, // fallback for older Python scripts
            },
            network: { tx_sec, rx_sec },
            gpu: update.gpu ? { ...update.gpu, timestamp: update.timestamp } : undefined,
            timestamp: update.timestamp
          };

          lastSnapshot = snapshot;

          // Broadcast to Matrix channel
          const bus = getEventBus();
          bus.emit({
            type: 'system.matrix',
            data: snapshot,
            metadata: makeMetadata()
          });

          // Broadcast to GPU channel if present
          if (snapshot.gpu) {
            bus.emit({
              type: 'system.gpu',
              // hardware_node.py omits `timestamp` inside gpu_data, but the
              // system.gpu contract requires it — re-attach from the snapshot
              // rather than shipping an event that violates its own type.
              data: { ...snapshot.gpu, timestamp: snapshot.timestamp },
              metadata: makeMetadata()
            });
          }
        }
      } catch {
        // Silently skip malformed lines (buffer splits etc)
      }
    }
  });

  pythonNode.stderr.on('data', (data: Buffer) => {
    console.error(`[HardwareNode] Python error: ${data.toString()}`);
  });

  pythonNode.on('close', (code: number | null) => {
    pythonNode = null;

    // A spawn that never started reports both 'error' and 'close'; the error
    // handler has already disabled the node and said why, so stay quiet.
    if (hardwareNodeDisabled) return;

    if (++hardwareNodeRestarts > MAX_HARDWARE_NODE_RESTARTS) {
      hardwareNodeDisabled = true;
      console.warn(
        `[HardwareNode] Python node exited ${hardwareNodeRestarts} times (last code ${code ?? 'null'}). ` +
          `Giving up rather than restarting forever; telemetry will be unavailable.`,
      );
      return;
    }

    console.warn(
      `[HardwareNode] Python node exited (code ${code ?? 'null'}). ` +
        `Restarting in 5s (${hardwareNodeRestarts}/${MAX_HARDWARE_NODE_RESTARTS})...`,
    );
    setTimeout(startHardwareNode, 5000);
  });
}

// --- Routes ---

router.get('/system/matrix', (_req, res) => {
  res.json(lastSnapshot || { error: 'Node initializing...' });
});

router.get('/system/gpu', (_req, res) => {
  if (lastSnapshot?.gpu) {
    res.json(lastSnapshot.gpu);
  } else {
    res.status(503).json({ error: 'GPU telemetry not available' });
  }
});

router.get('/system/gpu/info', async (_req, res) => {
  // Prefer live NVIDIA data from Python process over systeminformation (which may pick up iGPU)
  if (lastSnapshot?.gpu) {
    const g = lastSnapshot.gpu;
    res.json({
      name: g.name || 'NVIDIA GPU',
      driverVersion: 'N/A',  // pynvml doesn't easily expose this in our snapshot
      cudaVersion: 'N/A',
      computeCapability: 'N/A',
      memoryTotalMB: g.memoryTotalMB || 0,
      pciBusId: 'N/A',
      architecture: 'NVIDIA'
    });
    return;
  }
  // Fallback to systeminformation
  try {
    const gpu = await si.graphics();
    // Prefer NVIDIA controller if multiple GPUs
    const nvidiaGpu = gpu.controllers.find(c => /nvidia/i.test(c.vendor || c.model || ''));
    const mainGpu = nvidiaGpu || gpu.controllers[0];
    res.json({
      name: mainGpu?.model || 'Unknown GPU',
      driverVersion: mainGpu?.driverVersion || 'Unknown',
      cudaVersion: 'N/A',
      computeCapability: 'N/A',
      memoryTotalMB: mainGpu?.vram || 0,
      pciBusId: mainGpu?.pciBus || 'N/A',
      architecture: nvidiaGpu ? 'NVIDIA' : 'Unknown'
    });
  } catch {
    res.status(503).json({ error: 'GPU info unavailable' });
  }
});

// Bridge the NestJS-only ManifestService to Express. The Nest app runs as a
// DI-only ApplicationContext (no HTTP), so SystemController.@Get('manifest') is
// never registered — the dashboard sidebar polls /api/system/manifest, so we
// serve it here and graft on the live GPU snapshot from the hardware node.
router.get('/system/manifest', async (_req: Request, res: Response) => {
  try {
    const manifest = await getNestApp().get(ManifestService).generateManifest();
    // Top-level `gpu`, NOT manifest.hardware.gpu: the snapshot is camelCase
    // (GpuSnapshot) while hardware.gpu is declared snake_case and shares none of
    // its keys, so assigning it there would hand every consumer undefined fields.
    // No current consumer reads either — the live feed reaches the client over
    // the `system.gpu` SSE channel — but the key is kept so the response shape
    // stays unchanged for anything reading it off the wire.
    const payload: SystemManifest & { gpu?: GpuSnapshot } = lastSnapshot?.gpu
      ? { ...manifest, gpu: lastSnapshot.gpu }
      : manifest;
    res.json(payload);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Auto-start the institutional node
startHardwareNode();

export default router;

export function shutdownHardwareNode() {
  if (pythonNode) {
    pythonNode.kill();
    pythonNode = null;
  }
}
