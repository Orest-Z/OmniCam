/** The OmniCam mark — same geometry as build/icons.mjs, as an inline SVG. */
export function Mark({ size = 18, color = 'currentColor' }: { size?: number; color?: string }) {
  // arcs from -66° to -20° around (44,56)
  const arc = (r: number) => {
    const p = (a: number) => [44 + r * Math.cos((a * Math.PI) / 180), 56 + r * Math.sin((a * Math.PI) / 180)];
    const [x0, y0] = p(-66);
    const [x1, y1] = p(-20);
    return `M ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 1 ${x1.toFixed(2)} ${y1.toFixed(2)}`;
  };
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" aria-hidden="true">
      <g fill="none" stroke={color} strokeLinecap="round">
        <circle cx="44" cy="56" r="26" strokeWidth="8.6" />
        <path d={arc(38.5)} strokeWidth="6" />
        <path d={arc(50.5)} strokeWidth="6" />
      </g>
      <circle cx="44" cy="56" r="7.2" fill={color} />
    </svg>
  );
}
