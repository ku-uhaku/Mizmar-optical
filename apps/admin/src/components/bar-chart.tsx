'use client';

/** A small accessible bar chart (SVG, no dependency). Each bar has a title for hover and the whole chart a text summary for screen readers. */
export function BarChart({ data, label, format, height = 140 }: { data: { label: string; value: number }[]; label: string; format: (n: number) => string; height?: number }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  const w = 100 / Math.max(1, data.length);
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <figure>
      <svg role="img" aria-label={`${label}: ${format(total)}`} viewBox={`0 0 100 ${height / 4}`} preserveAspectRatio="none" className="h-36 w-full text-primary">
        {data.map((d, i) => {
          const h = (d.value / max) * (height / 4 - 2);
          return <rect key={i} x={i * w + w * 0.12} y={height / 4 - h} width={w * 0.76} height={Math.max(h, d.value > 0 ? 0.5 : 0)} rx={0.4} fill="currentColor" opacity={0.85}><title>{`${d.label}: ${format(d.value)}`}</title></rect>;
        })}
      </svg>
      <figcaption className="mt-1 flex justify-between text-xs text-muted-foreground"><span>{data[0]?.label}</span><span>{data[data.length - 1]?.label}</span></figcaption>
    </figure>
  );
}
