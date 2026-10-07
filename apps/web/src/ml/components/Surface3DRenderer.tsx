/**
 * Surface3DRenderer — 3D loss surface / trajectory visualization.
 *
 * Two modes based on data shape:
 *   Trajectory: PCA-projected optimizer path through weight space (live training)
 *   Surface: Filter-normalized loss landscape grid (Li et al. 2018, post-training)
 *
 * Uses Three.js via @react-three/fiber + @react-three/drei (already in stack).
 * Renders inside RendererShell for consistent card styling.
 */

import { useState, useMemo, useEffect } from 'react';
import type { RendererProps } from "@/ml/lib/diagnostics-schema";
import { RendererShell, useShellProps } from './RendererShell';
import { cn } from "@/shared/utils/utils";

// ── Types ───────────────────────────────────────────────────────────────────

interface TrajectoryPoint {
  pc1: number;
  pc2: number;
  loss: number;
  epoch: number;
}

interface TrajectoryData {
  points: TrajectoryPoint[];
  explained_variance?: number[];
}

interface SurfaceDiagnostics {
  sharpness: number;
  condition_number: number;
  valley_width: number;
  locally_convex: boolean;
}

export interface SurfaceGridData {
  alphas: number[];
  betas: number[];
  losses: number[][];
  resolution: number;
  range: [number, number];
  trajectory_3d?: [number, number, number][];
  diagnostics?: SurfaceDiagnostics;
}

type ViewMode = '3d' | 'contour' | 'heatmap';

// ── Viridis Colormap ────────────────────────────────────────────────────────

const VIRIDIS_STOPS = [
  { t: 0.0, r: 0.267, g: 0.004, b: 0.329 },
  { t: 0.25, r: 0.282, g: 0.140, b: 0.458 },
  { t: 0.5, r: 0.127, g: 0.566, b: 0.551 },
  { t: 0.75, r: 0.544, g: 0.774, b: 0.247 },
  { t: 1.0, r: 0.993, g: 0.906, b: 0.144 },
];

function viridis(t: number): { r: number; g: number; b: number } {
  t = Math.max(0, Math.min(1, t));
  for (let i = 0; i < VIRIDIS_STOPS.length - 1; i++) {
    const s0 = VIRIDIS_STOPS[i]!;
    const s1 = VIRIDIS_STOPS[i + 1]!;
    if (t <= s1.t) {
      const f = (t - s0.t) / (s1.t - s0.t);
      return {
        r: s0.r + f * (s1.r - s0.r),
        g: s0.g + f * (s1.g - s0.g),
        b: s0.b + f * (s1.b - s0.b),
      };
    }
  }
  return VIRIDIS_STOPS[VIRIDIS_STOPS.length - 1]!;
}

function lossToColor(loss: number, minLoss: number, maxLoss: number): string {
  const range = maxLoss - minLoss || 1;
  const t = (loss - minLoss) / range;
  const c = viridis(t);
  return `rgb(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)})`;
}

// ── Type Guards ──────────────────────────────────────────────────────────────

function isTrajectoryData(v: unknown): v is TrajectoryData {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.points) && obj.points.length > 0 &&
    typeof (obj.points as TrajectoryPoint[])[0]?.pc1 === 'number';
}

function isSurfaceGridData(v: unknown): v is SurfaceGridData {
  if (!v || typeof v !== 'object') return false;
  const obj = v as Record<string, unknown>;
  return Array.isArray(obj.alphas) && Array.isArray(obj.betas) && Array.isArray(obj.losses);
}

// ── SVG Fallback: Trajectory ────────────────────────────────────────────────

function TrajectoryFallback({ data }: { data: TrajectoryData }) {
  const { points } = data;
  if (points.length < 2) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-600 text-xs font-mono">
        Waiting for trajectory data (need 2+ snapshots)...
      </div>
    );
  }

  const losses = points.map(p => p.loss);
  const minLoss = Math.min(...losses);
  const maxLoss = Math.max(...losses);
  const pc1s = points.map(p => p.pc1);
  const pc2s = points.map(p => p.pc2);
  const xMin = Math.min(...pc1s);
  const xMax = Math.max(...pc1s);
  const yMin = Math.min(...pc2s);
  const yMax = Math.max(...pc2s);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const toSvgX = (v: number) => 20 + ((v - xMin) / xRange) * 260;
  const toSvgY = (v: number) => 160 - ((v - yMin) / yRange) * 140;

  const pathD = points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'} ${toSvgX(p.pc1).toFixed(1)},${toSvgY(p.pc2).toFixed(1)}`
  ).join(' ');

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 300 180" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Grid */}
        <g opacity="0.15" stroke="#71717a" strokeWidth="0.5">
          {[0, 1, 2, 3, 4].map(i => (
            <line key={`gx-${i}`} x1={20 + i * 65} y1="20" x2={20 + i * 65} y2="160" />
          ))}
          {[0, 1, 2, 3].map(i => (
            <line key={`gy-${i}`} x1="20" y1={20 + i * 46.6} x2="280" y2={20 + i * 46.6} />
          ))}
        </g>

        {/* Axis labels */}
        <text x="150" y="175" fill="#52525b" fontSize="8" textAnchor="middle">PC1</text>
        <text x="8" y="90" fill="#52525b" fontSize="8" textAnchor="middle" transform="rotate(-90, 8, 90)">PC2</text>

        {/* Gradient definition */}
        <defs>
          <linearGradient id="traj-grad" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#0072B2" stopOpacity="0.6" />
            <stop offset="40%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#E69F00" />
          </linearGradient>
        </defs>

        {/* Trajectory path */}
        <path d={pathD} fill="none" stroke="url(#traj-grad)" strokeWidth="2" strokeLinecap="round" />

        {/* Epoch markers */}
        {points.map((p, i) => {
          const color = lossToColor(p.loss, minLoss, maxLoss);
          const isLast = i === points.length - 1;
          return (
            <g key={p.epoch}>
              <circle
                cx={toSvgX(p.pc1)}
                cy={toSvgY(p.pc2)}
                r={isLast ? 4 : 2.5}
                fill={isLast ? '#E69F00' : color}
                opacity={isLast ? 1 : 0.7}
              />
              {(i === 0 || isLast || i % Math.max(1, Math.floor(points.length / 4)) === 0) && (
                <text
                  x={toSvgX(p.pc1) + 6}
                  y={toSvgY(p.pc2) - 4}
                  fill={isLast ? '#E69F00' : '#71717a'}
                  fontSize="7"
                  fontWeight={isLast ? 600 : 400}
                >
                  E{p.epoch}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Stats overlay */}
      {data.explained_variance && data.explained_variance.length >= 2 && (
        <div className="absolute bottom-1 right-1 text-[9px] font-mono text-zinc-600">
          Var: {(data.explained_variance[0]! * 100).toFixed(0)}% + {(data.explained_variance[1]! * 100).toFixed(0)}%
        </div>
      )}
    </div>
  );
}

// ── SVG Fallback: Surface Contour ───────────────────────────────────────────

export function SurfaceContourFallback({ data }: { data: SurfaceGridData }) {
  const { losses, resolution, trajectory_3d } = data;
  const flatLosses = losses.flat();
  const minLoss = Math.min(...flatLosses);
  const maxLoss = Math.max(...flatLosses);
  const range = maxLoss - minLoss || 1;

  const cellW = 260 / resolution;
  const cellH = 150 / resolution;

  return (
    <div className="relative h-full w-full">
      <svg viewBox="0 0 300 180" className="w-full h-full" preserveAspectRatio="xMidYMid meet">
        {/* Heatmap cells */}
        {losses.map((row, i) =>
          row.map((val, j) => {
            const t = (val - minLoss) / range;
            const c = viridis(t);
            return (
              <rect
                key={`${i}-${j}`}
                x={20 + j * cellW}
                y={10 + i * cellH}
                width={cellW + 0.5}
                height={cellH + 0.5}
                fill={`rgb(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)})`}
                opacity={0.85}
              />
            );
          })
        )}

        {/* Trajectory overlay */}
        {trajectory_3d && trajectory_3d.length > 1 && (() => {
          const pts = trajectory_3d;
          const alphaMin = data.alphas[0] ?? 0;
          const alphaMax = data.alphas[data.alphas.length - 1] ?? 1;
          const betaMin = data.betas[0] ?? 0;
          const betaMax = data.betas[data.betas.length - 1] ?? 1;
          const aRange = alphaMax - alphaMin || 1;
          const bRange = betaMax - betaMin || 1;

          const toX = (a: number) => 20 + ((a - alphaMin) / aRange) * 260;
          const toY = (b: number) => 10 + ((b - betaMin) / bRange) * 150;

          const pathD = pts.map((p, i) =>
            `${i === 0 ? 'M' : 'L'} ${toX(p[0]!).toFixed(1)},${toY(p[2]!).toFixed(1)}`
          ).join(' ');

          const first = pts[0]!;
          const last = pts[pts.length - 1]!;

          return (
            <g>
              <path d={pathD} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.8" />
              <circle cx={toX(first[0]!)} cy={toY(first[2]!)} r="2.5" fill="#0072B2" />
              <circle cx={toX(last[0]!)} cy={toY(last[2]!)} r="3" fill="#E69F00" />
            </g>
          );
        })()}

        {/* Axis labels */}
        <text x="150" y="175" fill="#52525b" fontSize="8" textAnchor="middle">Direction 1</text>
        <text x="8" y="85" fill="#52525b" fontSize="8" textAnchor="middle" transform="rotate(-90, 8, 85)">Direction 2</text>
      </svg>

      {/* Colorbar */}
      <div className="absolute top-2 right-2 flex flex-col items-end gap-0.5">
        <div className="w-2 h-20 rounded-sm overflow-hidden" style={{
          background: `linear-gradient(to bottom, ${viridis(1).r * 255 | 0}, ${viridis(1).g * 255 | 0}, ${viridis(1).b * 255 | 0}), rgb(${viridis(0.5).r * 255 | 0}, ${viridis(0.5).g * 255 | 0}, ${viridis(0.5).b * 255 | 0}), rgb(${viridis(0).r * 255 | 0}, ${viridis(0).g * 255 | 0}, ${viridis(0).b * 255 | 0})`,
          backgroundImage: `linear-gradient(to top, rgb(68,1,84), rgb(32,144,141), rgb(253,231,37))`,
        }} />
        <span className="text-[8px] font-mono text-zinc-600">{maxLoss.toFixed(2)}</span>
        <span className="text-[8px] font-mono text-zinc-600">{minLoss.toFixed(2)}</span>
      </div>
    </div>
  );
}

// ── 3D Surface (R3F) — lazy loaded ──────────────────────────────────────────

export function Surface3DScene({ data }: { data: SurfaceGridData }) {
  const [ThreeComponents, setThreeComponents] = useState<{
    fiber: typeof import('@react-three/fiber');
    drei: typeof import('@react-three/drei');
    THREE: typeof import('three');
  } | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    if (!gl) {
      setLoadFailed(true);
      return;
    }

    Promise.all([
      import('@react-three/fiber'),
      import('@react-three/drei'),
      import('three'),
    ]).then(([fiber, drei, three]) => {
      setThreeComponents({ fiber, drei, THREE: three });
    }).catch(() => setLoadFailed(true));
  }, []);

  if (loadFailed || !ThreeComponents) {
    return <SurfaceContourFallback data={data} />;
  }
  // the geometry hook lives in a child so no hook runs after the early return above
  return <LoadedSurfaceScene data={data} modules={ThreeComponents} />;
}

function LoadedSurfaceScene({
  data,
  modules,
}: {
  data: SurfaceGridData;
  modules: { fiber: typeof import('@react-three/fiber'); drei: typeof import('@react-three/drei'); THREE: typeof import('three') };
}) {
  const { Canvas } = modules.fiber;
  const { OrbitControls, Grid: DreiGrid } = modules.drei;
  const THREE = modules.THREE;

  const { losses, resolution, trajectory_3d } = data;

  // Memoize geometry and trajectory to avoid recreating on every render
  const { geo, trajectoryPoints, trajectoryLine } = useMemo(() => {
    const flatLosses = losses.flat();
    const minLoss = Math.min(...flatLosses);
    const maxLoss = Math.max(...flatLosses);

    const width = 4;
    const height = 4;
    const geometry = new THREE.PlaneGeometry(width, height, resolution - 1, resolution - 1);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position!;
    const positions = posAttr.array as Float32Array;
    const colorArray = new Float32Array(positions.length);
    const logMin = Math.log(minLoss + 1e-6);
    const logMax = Math.log(maxLoss + 1e-6);
    const logRange = logMax - logMin || 1;

    for (let i = 0; i < resolution; i++) {
      for (let j = 0; j < resolution; j++) {
        const vertexIndex = i * resolution + j;
        const logLoss = Math.log((losses[i]?.[j] ?? 0) + 1e-6);
        const t = (logLoss - logMin) / logRange;
        positions[vertexIndex * 3 + 1] = t * 2;

        const c = viridis(t);
        colorArray[vertexIndex * 3 + 0] = c.r;
        colorArray[vertexIndex * 3 + 1] = c.g;
        colorArray[vertexIndex * 3 + 2] = c.b;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colorArray, 3));
    geometry.computeVertexNormals();
    posAttr.needsUpdate = true;

    // Build trajectory
    let trajPts: [number, number, number][] | null = null;
    let trajLine: InstanceType<typeof THREE.Line> | null = null;
    if (trajectory_3d && trajectory_3d.length > 1) {
      const alphaMin = data.alphas[0] ?? 0;
      const alphaMax = data.alphas[data.alphas.length - 1] ?? 1;
      const betaMin = data.betas[0] ?? 0;
      const betaMax = data.betas[data.betas.length - 1] ?? 1;
      const aRange = alphaMax - alphaMin || 1;
      const bRange = betaMax - betaMin || 1;

      trajPts = trajectory_3d.map(([alpha, loss, beta]) => {
        const x = (((alpha ?? 0) - alphaMin) / aRange - 0.5) * width;
        const z = (((beta ?? 0) - betaMin) / bRange - 0.5) * height;
        const y = ((Math.log((loss ?? 0) + 1e-6) - logMin) / logRange) * 2 + 0.05;
        return [x, y, z] as [number, number, number];
      });

      const lineGeo = new THREE.BufferGeometry();
      const verts = new Float32Array(trajPts.length * 3);
      trajPts.forEach(([x, y, z], i) => {
        verts[i * 3] = x;
        verts[i * 3 + 1] = y;
        verts[i * 3 + 2] = z;
      });
      lineGeo.setAttribute('position', new THREE.BufferAttribute(verts, 3));
      trajLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: '#f59e0b', linewidth: 2 }));
    }

    return { geo: geometry, trajectoryPoints: trajPts, trajectoryLine: trajLine };
  }, [losses, resolution, trajectory_3d, data.alphas, data.betas, THREE]);

  return (
    <Canvas
      camera={{ position: [3, 3, 3], fov: 45 }}
      gl={{ antialias: true, alpha: true, failIfMajorPerformanceCaveat: false }}
      style={{ width: '100%', height: '100%' }}
      onCreated={({ gl }) => gl.setClearColor(0x09090b, 1)}
    >
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 10, 5]} intensity={0.8} />

      {/* Solid surface */}
      <mesh geometry={geo}>
        <meshStandardMaterial
          vertexColors
          side={THREE.DoubleSide}
          metalness={0.1}
          roughness={0.6}
        />
      </mesh>

      {/* Wireframe overlay */}
      <mesh geometry={geo}>
        <meshBasicMaterial wireframe color="#000000" opacity={0.12} transparent />
      </mesh>

      {/* Trajectory line + markers (memoized) */}
      {trajectoryPoints && trajectoryPoints.length > 1 && (
        <group>
          {trajectoryPoints.map((pt, i) => (
            <mesh key={i} position={pt}>
              <sphereGeometry args={[0.03, 8, 8]} />
              <meshBasicMaterial color={i === trajectoryPoints!.length - 1 ? '#E69F00' : '#f59e0b'} />
            </mesh>
          ))}
          {trajectoryLine && <primitive object={trajectoryLine} />}
        </group>
      )}

      <DreiGrid
        position={[0, -0.05, 0]}
        args={[6, 6]}
        cellSize={0.5}
        cellThickness={0.5}
        cellColor="#27272a"
        sectionSize={1}
        sectionThickness={0.8}
        sectionColor="#3f3f46"
        fadeDistance={8}
        fadeStrength={1}
      />

      <OrbitControls
        enablePan
        enableZoom
        enableRotate
        minDistance={1.5}
        maxDistance={10}
        target={[0, 0.5, 0]}
      />
    </Canvas>
  );
}

// ── Diagnostics Panel ───────────────────────────────────────────────────────

function DiagnosticsPanel({ diagnostics }: { diagnostics: SurfaceDiagnostics }) {
  const items = [
    {
      label: 'Sharpness',
      value: diagnostics.sharpness.toFixed(4),
      color: diagnostics.sharpness < 0.05 ? 'text-[hsl(var(--data-pos))]' : diagnostics.sharpness < 0.2 ? 'text-amber-400' : 'text-[hsl(var(--data-neg))]',
      hint: diagnostics.sharpness < 0.05 ? 'flat (good)' : diagnostics.sharpness < 0.2 ? 'moderate' : 'sharp (risky)',
    },
    {
      label: 'Condition #',
      value: diagnostics.condition_number.toFixed(1),
      color: diagnostics.condition_number < 10 ? 'text-[hsl(var(--data-pos))]' : diagnostics.condition_number < 50 ? 'text-amber-400' : 'text-[hsl(var(--data-neg))]',
      hint: diagnostics.condition_number < 10 ? 'isotropic' : diagnostics.condition_number < 50 ? 'anisotropic' : 'ill-conditioned',
    },
    {
      label: 'Valley Width',
      value: diagnostics.valley_width.toFixed(3),
      color: 'text-zinc-300',
      hint: '1% contour',
    },
    {
      label: 'Convex',
      value: diagnostics.locally_convex ? 'yes' : 'no',
      color: diagnostics.locally_convex ? 'text-[hsl(var(--data-pos))]' : 'text-[hsl(var(--data-neg))]',
      hint: diagnostics.locally_convex ? 'all eigenvalues > 0' : 'saddle point',
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-1.5 mt-2">
      {items.map(({ label, value, color, hint }) => (
        <div key={label} className="bg-black/20 rounded px-2 py-1.5 text-center">
          <div className="text-[9px] text-zinc-600 font-mono">{label}</div>
          <div className={cn('text-sm font-semibold font-mono', color)}>{value}</div>
          <div className="text-[8px] text-zinc-600">{hint}</div>
        </div>
      ))}
    </div>
  );
}

// ── View Toggle ─────────────────────────────────────────────────────────────

function ViewToggle({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  const options: { key: ViewMode; label: string }[] = [
    { key: '3d', label: '3D Surface' },
    { key: 'contour', label: 'Contour' },
    { key: 'heatmap', label: 'Heatmap' },
  ];

  return (
    <div className="flex gap-1 mb-2">
      {options.map(({ key, label }) => (
        <button
          key={key}
          onClick={() => onChange(key)}
          className={cn(
            'px-2 py-0.5 rounded text-[9px] font-mono transition-colors',
            mode === key
              ? 'bg-purple-500/20 text-purple-400 font-semibold'
              : 'bg-zinc-800/50 text-zinc-600 hover:text-zinc-400',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// ── Main Renderer ───────────────────────────────────────────────────────────

export function Surface3DRenderer(props: RendererProps) {
  const shellProps = useShellProps(props);
  const value = props.metric.value;
  const [viewMode, setViewMode] = useState<ViewMode>('3d');

  // Trajectory mode
  if (isTrajectoryData(value)) {
    return (
      <RendererShell {...shellProps}>
        <div className="min-h-[180px]">
          <TrajectoryFallback data={value} />
        </div>
      </RendererShell>
    );
  }

  // Surface grid mode
  if (isSurfaceGridData(value)) {
    return (
      <RendererShell {...shellProps}>
        <ViewToggle mode={viewMode} onChange={setViewMode} />
        <div className="min-h-[200px] relative">
          {viewMode === '3d' ? (
            <div className="h-[200px] rounded overflow-hidden">
              <Surface3DScene data={value} />
            </div>
          ) : (
            <SurfaceContourFallback data={value} />
          )}
        </div>
        {value.diagnostics && <DiagnosticsPanel diagnostics={value.diagnostics} />}
      </RendererShell>
    );
  }

  // Unknown data shape
  return (
    <RendererShell {...shellProps}>
      <div className="flex items-center justify-center h-24 text-zinc-600 text-xs font-mono">
        Unsupported surface data format
      </div>
    </RendererShell>
  );
}

export default Surface3DRenderer;
