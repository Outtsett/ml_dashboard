import si from 'systeminformation';
import { Router, type Request, type Response } from 'express';
import { spawn } from 'child_process';
import { getEventBus } from '../events/event-bus.js';
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
  gpu?: any;
  processes?: any[];
  timestamp: number;
}

// --- Python Node Controller ---

let pythonNode: any = null;
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

  console.log(`[HardwareNode] Starting Python node: ${scriptPath}`);
  
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
              data: snapshot.gpu,
              metadata: makeMetadata()
            });
          }
        }
      } catch (e) {
        // Silently skip malformed lines (buffer splits etc)
      }
    }
  });

  pythonNode.stderr.on('data', (data: Buffer) => {
    console.error(`[HardwareNode] Python error: ${data.toString()}`);
  });

  pythonNode.on('close', (code: number) => {
    console.warn('[HardwareNode] Python node exited. Restarting in 5s...');
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
  } catch (e) {
    res.status(503).json({ error: 'GPU info unavailable' });
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
