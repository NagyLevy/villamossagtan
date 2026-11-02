// Folyamatos áramlás-animáció: mozgó pontok minden ágon, az áram irányában, a nagyságával
// arányos sebességgel. Csökkentett mozgásnál a pontok állnak (az irányt akkor is mutatják).

import type { FlowSegment } from '../render/flow';

const SPACING = 22;
const MAX_SPEED = 150; // px/s a legnagyobb áramnál

export class FlowAnimator {
  private layer: SVGGElement | null = null;
  private dots: { seg: FlowSegment; els: SVGCircleElement[]; len: number; speed: number }[] = [];
  private raf = 0;
  private t0 = performance.now();
  private reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

  attach(svg: SVGSVGElement): void {
    this.stop();
    const ns = 'http://www.w3.org/2000/svg';
    this.layer = document.createElementNS(ns, 'g');
    this.layer.setAttribute('class', 'flow');
    this.layer.setAttribute('aria-hidden', 'true');
    // A vezetékek fölé, az elemek alá.
    svg.querySelector('.ov-under')?.after(this.layer);
  }

  set(segments: FlowSegment[]): void {
    if (!this.layer) return;
    const ns = 'http://www.w3.org/2000/svg';
    const Imax = Math.max(1e-12, ...segments.map((s) => Math.abs(s.I)));
    this.layer.replaceChildren();
    this.dots = [];
    for (const seg of segments) {
      if (Math.abs(seg.I) < 1e-9 * Imax || Math.abs(seg.I) < 1e-12) continue;
      const len = Math.hypot(seg.b.x - seg.a.x, seg.b.y - seg.a.y);
      const n = Math.max(1, Math.floor(len / SPACING));
      const els = Array.from({ length: n }, () => {
        const c = document.createElementNS(ns, 'circle');
        c.setAttribute('r', '2.4');
        c.setAttribute('class', 'flow-dot');
        this.layer!.append(c);
        return c;
      });
      // A sebesség arányos az áram nagyságával (a leggyengébb ágban is látható, lassú mozgás).
      const speed = Math.max(10, (MAX_SPEED * Math.abs(seg.I)) / Imax);
      this.dots.push({ seg, els, len, speed });
    }
    this.frame();
    if (!this.reduced) this.loop();
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
    this.layer?.remove();
    this.layer = null;
    this.dots = [];
  }

  private frame = () => {
    const t = (performance.now() - this.t0) / 1000;
    for (const d of this.dots) {
      const { a, b, I } = d.seg;
      const ux = (b.x - a.x) / d.len;
      const uy = (b.y - a.y) / d.len;
      const shift = this.reduced ? SPACING / 2 : (t * d.speed) % SPACING;
      d.els.forEach((el, k) => {
        let s = (k * SPACING + shift) % (d.els.length * SPACING);
        if (I < 0) s = d.len - s;
        if (s < 0 || s > d.len) {
          el.setAttribute('opacity', '0');
          return;
        }
        // A szakasz végein finoman elhalványul, így nincs "ugrás".
        const edge = Math.min(s, d.len - s);
        el.setAttribute('opacity', String(Math.min(1, edge / 8)));
        el.setAttribute('cx', (a.x + ux * s).toFixed(1));
        el.setAttribute('cy', (a.y + uy * s).toFixed(1));
      });
    }
  };

  private loop = () => {
    this.frame();
    this.raf = requestAnimationFrame(this.loop);
  };
}
