// Vízszintes sávdiagram a statisztikához (saját SVG): soronként a kategória, a próbálkozások száma,
// és a helyes arány sávja.

import type { Bucket } from '../ui/stats';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function renderBars(buckets: Bucket[], label: (key: string) => string, width = 440): string {
  const rowH = 30;
  const labelW = 150;
  const barW = width - labelW - 70;
  const h = Math.max(1, buckets.length) * rowH + 8;
  const rows = buckets
    .map((b, i) => {
      const y = 4 + i * rowH;
      const ratio = b.total ? b.correct / b.total : 0;
      const pct = Math.round(ratio * 100);
      return (
        `<text x="0" y="${y + 18}" font-size="12.5" fill="var(--ink)">${esc(label(b.key))}</text>` +
        `<rect x="${labelW}" y="${y + 8}" width="${barW}" height="10" rx="5" fill="var(--fill-2)"/>` +
        `<rect class="bar-fill" x="${labelW}" y="${y + 8}" width="${Math.max(ratio > 0 ? 10 : 0, barW * ratio).toFixed(1)}" height="10" rx="5" fill="${ratio >= 0.7 ? 'var(--result)' : ratio >= 0.4 ? 'var(--accent)' : 'var(--node)'}"/>` +
        `<text x="${width}" y="${y + 18}" text-anchor="end" font-size="12" fill="var(--ink-2)" style="font-variant-numeric:tabular-nums">${pct}% · ${b.correct}/${b.total}</text>`
      );
    })
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${h}" width="100%" role="img" font-family="-apple-system, 'SF Pro Text', Inter, system-ui, sans-serif">${rows || `<text x="0" y="20" font-size="13" fill="var(--ink-2)">Még nincs adat.</text>`}</svg>`;
}
