/**
 * The eigenvalues of the state matrix in the complex plane, with the unit
 * circle. Every eigenvalue inside the circle means a shock decays; one outside
 * means it compounds. The largest modulus, the spectral radius, is the ring.
 */

import { OKABE } from "@/studies/kit";
import type { ComplexNumber } from "@shared/studies/hwma-stability";

const SIZE = 240;
const RANGE = 1.3;
const scale = (value: number) => (SIZE / 2) * (value / RANGE);

export function EigenPlane({ eigenvalues, radius }: { eigenvalues: readonly ComplexNumber[]; radius: number }) {
  const unstable = radius >= 1;
  const color = unstable ? OKABE.orange : OKABE.blue;
  const centre = SIZE / 2;
  const ringRadius = Math.min(scale(radius), SIZE / 2 - 2);
  return (
    <svg viewBox={`0 0 ${SIZE} ${SIZE}`} className="w-full max-w-[260px]" role="img" aria-label={`Eigenvalues in the complex plane, spectral radius ${radius.toFixed(4)}`}>
      <line x1="0" x2={SIZE} y1={centre} y2={centre} stroke="#525252" strokeWidth="1" />
      <line x1={centre} x2={centre} y1="0" y2={SIZE} stroke="#525252" strokeWidth="1" />
      <circle cx={centre} cy={centre} r={scale(1)} fill="none" stroke="#d4d4d4" strokeWidth="1.5" strokeDasharray="5 3" />
      <circle cx={centre} cy={centre} r={ringRadius} fill={color} fillOpacity="0.08" stroke={color} strokeWidth="1.5" />
      <text x={centre + scale(1) - 3} y={centre - 4} fontSize="9" textAnchor="end" className="fill-neutral-300">|z| = 1</text>
      <text x={SIZE - 4} y={centre + 11} fontSize="9" textAnchor="end" className="fill-neutral-500">real</text>
      <text x={centre + 4} y="10" fontSize="9" className="fill-neutral-500">imaginary</text>
      {eigenvalues.map((value, index) => {
        const x = centre + scale(value.real);
        const y = centre - scale(value.imaginary);
        const modulus = Math.hypot(value.real, value.imaginary);
        return (
          <g key={index}>
            <path d={`M${x} ${y - 6}L${x + 6} ${y}L${x} ${y + 6}L${x - 6} ${y}Z`} fill={modulus >= 1 ? OKABE.orange : OKABE.blue} stroke="#0a0a0a" strokeWidth="1" />
            <title>{`${value.real.toFixed(4)} ${value.imaginary < 0 ? "-" : "+"} ${Math.abs(value.imaginary).toFixed(4)}i, modulus ${modulus.toFixed(4)}`}</title>
          </g>
        );
      })}
    </svg>
  );
}
