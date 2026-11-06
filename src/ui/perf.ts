// Könnyített grafika: az elmosás (üveghatás) és a díszítő animációk nélkül. Hardveres gyorsítás
// nélkül ezeket a processzor rajzolja, és az app akadozik. Indulás után megmérjük, milyen gyorsan
// rajzol a böngésző; ha lassú, magától bekapcsol. Kézzel is ki-be kapcsolható (a döntés megmarad).

import { toast } from './components';

const KEY = 'villamossagtan.lite';

function stored(): '1' | '0' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === '1' || v === '0' ? v : null;
  } catch {
    return null;
  }
}

export function isLite(): boolean {
  return document.documentElement.classList.contains('lite');
}

export function setLite(on: boolean, remember = true): void {
  document.documentElement.classList.toggle('lite', on);
  if (!remember) return;
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    // A tárolás nem kötelező.
  }
}

/** Képkocka-sebesség mérése (fps) a megadott ideig. */
function measureFps(ms: number): Promise<number> {
  return new Promise((done) => {
    let frames = 0;
    const t0 = performance.now();
    const step = (t: number) => {
      frames++;
      if (t - t0 < ms) requestAnimationFrame(step);
      else done((frames * 1000) / (t - t0));
    };
    requestAnimationFrame(step);
  });
}

/** Induláskor: a mentett döntés, vagy ha nincs, mérés és szükség esetén automatikus bekapcsolás. */
export function initPerf(): void {
  const s = stored();
  if (s) return setLite(s === '1', false);
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  // Kicsit várunk, hogy a betöltés ne torzítsa a mérést; rejtett lapon nem mérünk.
  setTimeout(async () => {
    if (document.visibilityState !== 'visible') return;
    const fps = await measureFps(2000);
    if (fps < 40) {
      setLite(true);
      toast('Akadozott a rajzolás, ezért könnyített grafikára váltottam (a Beállításokban visszakapcsolhatod).');
    }
  }, 2500);
}
