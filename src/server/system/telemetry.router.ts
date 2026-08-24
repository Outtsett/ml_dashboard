import si from 'systeminformation';
import { Router, type Request, type Response } from 'express';
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import { getEventBus } from '../infrastructure/events/event-bus.js';
import { getNestApp } from '../infrastructure/lib/nest-context.js';
import { ManifestService, type SystemManifest } from '../infrastructure/core/manifest.service.js';
import { log } from '../infrastructure/lib/log.js';
import type { DomainEvent } from '../../shared/event-types.js';
import crypto from 'crypto';
import path from 'path';

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

function makeMetadata() {
  const id = crypto.randomUUID().slice(0, 12);
  return { correlationId: id, causationId: id, timestamp: Date.now() };
}

function startHardwareNode() {
  if (pythonNode) return;

  const scriptPath = path.resolve(process.cwd(), 'scripts', 'hardware_node.py');
  const pythonPath = 'C:\\Users\\tyler\\anaconda3\\python.exe';

  log(`Starting Python node: ${scriptPath}`, 'HardwareNode');
  
  pythonNode = spawn(pythonPath, [scriptPath]);

  pythonNode.stdout.on('data', (data: Buffer) => {
    const lines = data.toString().split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const update = JSON.parse(line);
        if (update.type === 'hardware_node_update') {
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
    console.warn(`[HardwareNode] Python node exited (code ${code ?? 'null'}). Restarting in 5s...`);
    pythonNode = null;
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
