import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import * as THREE from 'three';

interface LossHistoryPoint {
  epoch: number;
  loss: number;
  valLoss: number;
}

interface LossSurfaceProps {
  currentEpoch: number;
  maxEpochs: number;
  currentLoss: number;
  currentValLoss: number;
  lossHistory?: LossHistoryPoint[];
}

function FallbackVisualization({ currentEpoch, maxEpochs, currentLoss, currentValLoss, lossHistory = [] }: LossSurfaceProps) {
  const gridSize = 20;
  const progressFactor = Math.min(currentEpoch / 100, 1);
  const normalizedLoss = Math.max(0.01, Math.min(1.5, currentLoss));
  const normalizedValLoss = Math.max(0.01, Math.min(1.5, currentValLoss));
  const avgLoss = (normalizedLoss + normalizedValLoss) / 2;

  const gridPoints = useMemo(() => {
    const points: { x: number; y: number; z: number; color: string }[] = [];
    
    for (let i = 0; i < gridSize; i++) {
      for (let j = 0; j < gridSize; j++) {
        const x = (i - gridSize / 2) * 2;
        const y = (j - gridSize / 2) * 2;
        
        const baseHeight = 8 * avgLoss;
        const minHeight = 0.5;
        const currentMinimum = baseHeight - (baseHeight - minHeight) * progressFactor;
        
        const dist = Math.sqrt(x * x + y * y);
        const bowl = (dist / 20) ** 2 * 5 * avgLoss;
        
        const valLossFactor = normalizedValLoss / normalizedLoss;
        const ridgeIntensity = Math.min(2, valLossFactor) * 0.5;
        const ridge = Math.sin(x * 0.3) * Math.cos(y * 0.3) * ridgeIntensity * avgLoss * (1 - progressFactor * 0.7);
        
        const z = currentMinimum + bowl + ridge;
        
        const t = Math.min(1, Math.max(0, z / 10));
        const r = Math.round(124 + (244 - 124) * t);
        const g = Math.round(58 + (114 - 58) * (t < 0.5 ? t * 2 : 1 - (t - 0.5) * 2));
        const b = Math.round(237 + (182 - 237) * t);
        
        points.push({ x: i, y: j, z, color: `rgb(${r}, ${g}, ${b})` });
      }
    }
    return points;
  }, [avgLoss, normalizedLoss, normalizedValLoss, progressFactor]);

  const currentPointPos = useMemo(() => {
    const lossHeight = normalizedLoss * 8;
    const minLossHeight = 0.5;
    const x = 50 + (-5 * progressFactor / 20) * 100;
    const y = 50 + (3 * progressFactor / 20) * 100;
    const z = (lossHeight - (lossHeight - minLossHeight) * progressFactor);
    return { x: `${x}%`, y: `${100 - y}%`, size: Math.max(8, 20 - z * 2) };
  }, [normalizedLoss, progressFactor]);

  const trailPoints = useMemo(() => {
    if (!lossHistory || lossHistory.length < 2) return [];
    
    return lossHistory.map((point) => {
      const prog = Math.min(point.epoch / 100, 1);
      const normLoss = Math.max(0.01, Math.min(1.5, point.loss));
      const lh = normLoss * 8;
      const mlh = 0.5;
      const x = 50 + (-5 * prog / 20) * 100;
      const y = 50 + (3 * prog / 20) * 100;
      return { x, y };
    });
  }, [lossHistory]);

  return (
    <div className="w-full h-full relative overflow-hidden" style={{ background: 'radial-gradient(ellipse at center, hsla(260, 30%, 15%, 1) 0%, hsla(250, 30%, 6%, 1) 100%)' }}>
      {/* Grid visualization */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div 
          className="relative"
          style={{ 
            width: '80%', 
            height: '80%',
            transform: 'perspective(800px) rotateX(60deg) rotateZ(-30deg)',
            transformStyle: 'preserve-3d'
          }}
        >
          {/* Surface grid */}
          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="surfaceGradient" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="hsl(260, 80%, 70%)" stopOpacity="0.6" />
                <stop offset="50%" stopColor="hsl(185, 70%, 55%)" stopOpacity="0.6" />
                <stop offset="100%" stopColor="hsl(330, 70%, 70%)" stopOpacity="0.6" />
              </linearGradient>
            </defs>
            
            {/* Grid lines */}
            {Array.from({ length: 11 }).map((_, i) => (
              <g key={`grid-${i}`}>
                <line
                  x1={i * 10}
                  y1={0}
                  x2={i * 10}
                  y2={100}
                  stroke="hsl(260, 60%, 40%)"
                  strokeWidth="0.3"
                  opacity="0.5"
                />
                <line
                  x1={0}
                  y1={i * 10}
                  x2={100}
                  y2={i * 10}
                  stroke="hsl(260, 60%, 40%)"
                  strokeWidth="0.3"
                  opacity="0.5"
                />
              </g>
            ))}
            
            {/* Surface representation with contour lines */}
            {[0.2, 0.4, 0.6, 0.8].map((r, i) => (
              <ellipse
                key={`contour-${i}`}
                cx="50"
                cy="50"
                rx={r * 45 * (1 - progressFactor * 0.3)}
                ry={r * 35 * (1 - progressFactor * 0.3)}
                fill="none"
                stroke={`hsla(${260 - i * 30}, 70%, ${50 + i * 10}%, ${0.4 + progressFactor * 0.3})`}
                strokeWidth="1"
              />
            ))}
            
            {/* Trail path */}
            {trailPoints.length > 1 && (
              <polyline
                points={trailPoints.map(p => `${p.x},${100 - p.y}`).join(' ')}
                fill="none"
                stroke="hsl(330, 70%, 70%)"
                strokeWidth="2"
                opacity="0.7"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            
            {/* Current position */}
            <circle
              cx={parseFloat(currentPointPos.x)}
              cy={100 - parseFloat(currentPointPos.y)}
              r={currentPointPos.size / 3}
              fill="hsl(185, 70%, 55%)"
              filter="url(#glow)"
            />
            <defs>
              <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
                <feMerge>
                  <feMergeNode in="coloredBlur"/>
                  <feMergeNode in="SourceGraphic"/>
                </feMerge>
              </filter>
            </defs>
          </svg>
        </div>
      </div>
      
      {/* Floating particles effect */}
      <div className="absolute inset-0 pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full animate-pulse"
            style={{
              width: `${2 + Math.random() * 4}px`,
              height: `${2 + Math.random() * 4}px`,
              left: `${10 + Math.random() * 80}%`,
              top: `${10 + Math.random() * 80}%`,
              background: `hsla(${260 + Math.random() * 60}, 70%, 60%, ${0.2 + Math.random() * 0.3})`,
              animationDelay: `${Math.random() * 2}s`,
              animationDuration: `${2 + Math.random() * 2}s`
            }}
          />
        ))}
      </div>
      
      {/* Axis labels */}
      <div className="absolute bottom-8 right-8 text-xs text-primary/60 font-mono">Weight 1</div>
      <div className="absolute top-8 left-8 text-xs text-primary/60 font-mono">Weight 2</div>
      <div className="absolute top-8 right-8 text-xs text-rose-400/60 font-mono">Loss</div>

      {/* Overlay info */}
      <div className="absolute bottom-4 left-4 glass rounded-xl p-3 text-xs font-mono space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Epoch:</span>
          <span className="text-primary">{currentEpoch} / {maxEpochs}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Loss:</span>
          <span className="text-accent">{currentLoss.toFixed(4)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Val Loss:</span>
          <span className="text-rose-400">{currentValLoss.toFixed(4)}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 text-xs text-muted-foreground font-mono">
        2D Loss Contour View
      </div>
    </div>
  );
}

export default function LossSurface3D(props: LossSurfaceProps) {
  const [webglSupported, setWebglSupported] = useState<boolean | null>(null);
  const [ThreeComponents, setThreeComponents] = useState<any>(null);
  const [contextLost, setContextLost] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
    const supported = !!gl;
    setWebglSupported(supported);
    
    if (supported) {
      Promise.all([
        import('@react-three/fiber'),
        import('@react-three/drei'),
        import('three')
      ]).then(([fiber, drei, three]) => {
        setThreeComponents({ fiber, drei, three });
        setContextLost(false);
      }).catch(() => {
        setWebglSupported(false);
      });
    }
  }, [retryCount]);

  // Cleanup event listeners on unmount
  useEffect(() => {
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, []);

  // Handle WebGL context loss recovery
  const handleContextLost = useCallback(() => {
    console.log('[LossSurface3D] WebGL context lost, falling back to 2D');
    setContextLost(true);
  }, []);

  const handleRetry = useCallback(() => {
    // Clean up old listeners before retry
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setContextLost(false);
    setRetryCount(c => c + 1);
  }, []);

  if (webglSupported === null) {
    return (
      <div className="w-full h-full flex items-center justify-center" style={{ background: 'radial-gradient(ellipse at center, hsla(260, 30%, 15%, 1) 0%, hsla(250, 30%, 6%, 1) 100%)' }}>
        <div className="text-primary/60 font-mono text-sm">Initializing visualization...</div>
      </div>
    );
  }

  if (!webglSupported || !ThreeComponents || contextLost) {
    return (
      <div className="relative w-full h-full">
        <FallbackVisualization {...props} />
        {contextLost && (
          <button
            onClick={handleRetry}
            className="absolute top-4 left-4 glass rounded-lg px-3 py-1.5 text-xs font-mono text-primary hover:bg-primary/10 transition-colors"
          >
            Retry 3D
          </button>
        )}
      </div>
    );
  }

  const { Canvas } = ThreeComponents.fiber;
  const { OrbitControls, Text, Grid } = ThreeComponents.drei;
  const THREE = ThreeComponents.three;

  const Surface = ({ epoch, loss, valLoss }: { epoch: number; loss: number; valLoss: number }) => {
    const geometry = useMemo(() => {
      const size = 40;
      const segments = 50;
      const geo = new THREE.PlaneGeometry(size, size, segments, segments);
      const positions = geo.attributes.position;

      const normalizedLoss = Math.max(0.01, Math.min(1.5, loss));
      const normalizedValLoss = Math.max(0.01, Math.min(1.5, valLoss));
      const avgLoss = (normalizedLoss + normalizedValLoss) / 2;
      const progressFactor = Math.min(epoch / 100, 1);

      for (let i = 0; i < positions.count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);

        const baseHeight = 8 * avgLoss;
        const minHeight = 0.5;
        const currentMinimum = baseHeight - (baseHeight - minHeight) * progressFactor;

        const dist = Math.sqrt(x * x + y * y);
        const bowl = (dist / 20) ** 2 * 5 * avgLoss;

        const valLossFactor = normalizedValLoss / normalizedLoss;
        const ridgeIntensity = Math.min(2, valLossFactor) * 0.5;
        const ridge = Math.sin(x * 0.3) * Math.cos(y * 0.3) * ridgeIntensity * avgLoss * (1 - progressFactor * 0.7);

        const noise = Math.sin(x * 0.5 + epoch * 0.1) * Math.cos(y * 0.5) * 0.3 * avgLoss;

        const localMin = -Math.exp(-((x + 5) ** 2 + (y - 3) ** 2) / 20) * 3 * progressFactor;

        const z = currentMinimum + bowl + ridge + noise + localMin;
        positions.setZ(i, z);
      }

      geo.computeVertexNormals();
      return geo;
    }, [epoch, loss, valLoss]);

    const material = useMemo(() => {
      return new THREE.ShaderMaterial({
        uniforms: {
          uMinHeight: { value: 0 },
          uMaxHeight: { value: 10 },
          uColorLow: { value: new THREE.Color('#7c3aed') },
          uColorMid: { value: new THREE.Color('#22d3ee') },
          uColorHigh: { value: new THREE.Color('#f472b6') },
        },
        vertexShader: `
          varying float vHeight;
          varying vec3 vNormal;
          void main() {
            vHeight = position.z;
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        fragmentShader: `
          uniform float uMinHeight;
          uniform float uMaxHeight;
          uniform vec3 uColorLow;
          uniform vec3 uColorMid;
          uniform vec3 uColorHigh;
          varying float vHeight;
          varying vec3 vNormal;
          
          void main() {
            float t = (vHeight - uMinHeight) / (uMaxHeight - uMinHeight);
            t = clamp(t, 0.0, 1.0);
            
            vec3 color;
            if (t < 0.5) {
              color = mix(uColorLow, uColorMid, t * 2.0);
            } else {
              color = mix(uColorMid, uColorHigh, (t - 0.5) * 2.0);
            }
            
            vec3 lightDir = normalize(vec3(1.0, 1.0, 1.0));
            float diff = max(dot(vNormal, lightDir), 0.0);
            vec3 ambient = color * 0.4;
            vec3 diffuse = color * diff * 0.6;
            
            gl_FragColor = vec4(ambient + diffuse, 0.9);
          }
        `,
        transparent: true,
        side: THREE.DoubleSide,
      });
    }, []);

    return (
      <mesh
        geometry={geometry}
        material={material}
        rotation={[-Math.PI / 2.5, 0, 0]}
        position={[0, -2, 0]}
      />
    );
  };

  return (
    <div className="w-full h-full rounded-2xl overflow-hidden relative" style={{ background: 'radial-gradient(ellipse at center, hsla(260, 30%, 15%, 1) 0%, hsla(250, 30%, 6%, 1) 100%)' }}>
      <Canvas
        camera={{ position: [30, 25, 30], fov: 45 }}
        gl={{ antialias: true, alpha: true, failIfMajorPerformanceCaveat: false }}
        onCreated={({ gl }: { gl: THREE.WebGLRenderer }) => {
          gl.setClearColor(0x000000, 0);
          // Handle WebGL context loss with proper cleanup
          const canvas = gl.domElement;
          const handleLost = (e: Event) => {
            e.preventDefault();
            handleContextLost();
          };
          const handleRestored = () => {
            handleRetry();
          };
          canvas.addEventListener('webglcontextlost', handleLost);
          canvas.addEventListener('webglcontextrestored', handleRestored);
          
          // Store cleanup function in ref for proper cleanup on unmount
          cleanupRef.current = () => {
            canvas.removeEventListener('webglcontextlost', handleLost);
            canvas.removeEventListener('webglcontextrestored', handleRestored);
          };
        }}
        fallback={<FallbackVisualization {...props} />}
      >
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 10]} intensity={0.7} />
        <pointLight position={[-10, -10, -10]} color="#7c3aed" intensity={0.5} />

        <Surface epoch={props.currentEpoch} loss={props.currentLoss} valLoss={props.currentValLoss} />

        <Grid
          position={[0, -8, 0]}
          args={[50, 50]}
          cellSize={2}
          cellThickness={0.5}
          cellColor="#4c1d95"
          sectionSize={10}
          sectionThickness={1}
          sectionColor="#7c3aed"
          fadeDistance={60}
          fadeStrength={1}
          infiniteGrid
        />

        <OrbitControls
          enablePan={true}
          enableZoom={true}
          enableRotate={true}
          minDistance={20}
          maxDistance={80}
          autoRotate
          autoRotateSpeed={0.3}
        />

        <fog attach="fog" args={['#0c0a1d', 40, 100]} />
      </Canvas>

      {/* Overlay info */}
      <div className="absolute bottom-4 left-4 glass rounded-xl p-3 text-xs font-mono space-y-1">
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Epoch:</span>
          <span className="text-primary">{props.currentEpoch} / {props.maxEpochs}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Loss:</span>
          <span className="text-accent">{props.currentLoss.toFixed(4)}</span>
        </div>
        <div className="flex justify-between gap-4">
          <span className="text-muted-foreground">Val Loss:</span>
          <span className="text-rose-400">{props.currentValLoss.toFixed(4)}</span>
        </div>
      </div>

      <div className="absolute top-4 right-4 text-xs text-muted-foreground font-mono">
        Drag to rotate • Scroll to zoom
      </div>
    </div>
  );
}
