/**
 * Launcher plumbing is drawn with diagonal hatching and runtime as a solid
 * fill, so the two roles never rest on colour alone.
 */

export function HatchPattern({ id, color }: { id: string; color: string }) {
  return (
    <defs>
      <pattern id={id} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill={color} fillOpacity="0.55" />
        <line x1="0" y1="0" x2="0" y2="6" stroke={color} strokeWidth="3" />
      </pattern>
    </defs>
  );
}

/** A legend swatch: hatched or solid, in the same colour the bars use. */
export function Swatch({ color, hatched, label }: { color: string; hatched: boolean; label: string }) {
  const id = `swatch-${label.replace(/[^a-z0-9]+/gi, "-")}`;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-300">
      <svg width="14" height="14" aria-hidden="true" className="shrink-0">
        {hatched ? <HatchPattern id={id} color={color} /> : null}
        <rect width="14" height="14" rx="2" fill={hatched ? `url(#${id})` : color} stroke={color} strokeWidth="1" />
      </svg>
      {label}
    </span>
  );
}
