// Az egyenletrendszer megoldásának látható levezetése (nem csak a végeredmény):
//  - 1 ismeretlen: kifejezzük,
//  - 2 ismeretlen: Cramer-szabály, a determinánsokkal,
//  - 3 vagy több: Gauss-elimináció a kibővített mátrixon, majd visszahelyettesítés.

import { texNum } from './tex';
import type { Highlight, Step } from './types';

function bmatrix(rows: number[][], split?: number): string {
  const cols = rows[0]?.length ?? 0;
  const spec = split === undefined ? 'c'.repeat(cols) : `${'c'.repeat(split)}|${'c'.repeat(cols - split)}`;
  return `\\left[\\begin{array}{${spec}}${rows.map((r) => r.map((v) => texNum(Math.abs(v) < 1e-12 ? 0 : v)).join(' & ')).join(' \\\\ ')}\\end{array}\\right]`;
}

/** `names`: az ismeretlenek LaTeX-jele, `plain`: ugyanaz olvasható szövegként (pl. φ₁, I₂). */
export function solveSystemSteps(A: number[][], b: number[], names: string[], plain: string[], x: number[], unit: string, highlight: Highlight, group?: string): Step[] {
  const n = b.length;
  const res = (i: number) => `${names[i]} = ${texNum(x[i]!)}\\,\\text{${unit}}`;
  if (n === 1) {
    return [
      {
        title: 'Az egyenlet megoldása',
        text: 'Egyetlen ismeretlen van: az egyenletet elosztjuk az ismeretlen együtthatójával.',
        terms: [`${names[0]} = \\frac{${texNum(b[0]!)}}{${texNum(A[0]![0]!)}}`],
        subst: res(0),
        highlight,
        group,
      },
    ];
  }
  if (n === 2) {
    const [[a, c], [d, e]] = A as [[number, number], [number, number]];
    const [p, q] = b as [number, number];
    const D = a * e - c * d;
    const D1 = p * e - c * q;
    const D2 = a * q - p * d;
    return [
      {
        title: 'Két egyenlet, két ismeretlen',
        text: 'A két egyenletet mátrixos alakba írjuk: a bal oldalon az ismeretlenek együtthatói, a jobb oldalon a konstansok. A megoldást a Cramer-szabály adja: minden ismeretlen két determináns hányadosa.',
        terms: [`${bmatrix(A)} \\begin{bmatrix} ${names[0]} \\\\ ${names[1]} \\end{bmatrix} = \\begin{bmatrix} ${texNum(p)} \\\\ ${texNum(q)} \\end{bmatrix}`],
        highlight,
        group,
      },
      {
        title: 'Determinánsok',
        text: 'A fő determináns az együtthatókból (átlók szorzatának különbsége). Az első ismeretlenéhez az első oszlopot, a másodikéhoz a második oszlopot cseréljük a jobb oldalra.',
        terms: [
          `D = ${texNum(a)} \\cdot ${texNum(e, { paren: true })} - ${texNum(c, { paren: true })} \\cdot ${texNum(d, { paren: true })} = ${texNum(D)}`,
          `,\\quad D_1 = ${texNum(p)} \\cdot ${texNum(e, { paren: true })} - ${texNum(c, { paren: true })} \\cdot ${texNum(q, { paren: true })} = ${texNum(D1)}`,
          `,\\quad D_2 = ${texNum(a)} \\cdot ${texNum(q, { paren: true })} - ${texNum(p, { paren: true })} \\cdot ${texNum(d, { paren: true })} = ${texNum(D2)}`,
        ],
        highlight,
        group,
      },
      {
        title: 'A két ismeretlen',
        text: 'Az ismeretlen = a saját determinánsa osztva a fő determinánssal.',
        terms: [`${names[0]} = \\frac{D_1}{D} = \\frac{${texNum(D1)}}{${texNum(D)}}`, `,\\quad ${names[1]} = \\frac{D_2}{D} = \\frac{${texNum(D2)}}{${texNum(D)}}`],
        subst: `${res(0)},\\quad ${res(1)}`,
        highlight,
        group,
      },
    ];
  }
  // Gauss-elimináció a kibővített mátrixon, részleges főelemkiválasztással.
  const M = A.map((r, i) => [...r, b[i]!]);
  const start = M.map((r) => [...r]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r]![col]!) > Math.abs(M[piv]![col]!)) piv = r;
    [M[col], M[piv]] = [M[piv]!, M[col]!];
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / M[col]![col]!;
      for (let c = col; c <= n; c++) M[r]![c]! -= f * M[col]![c]!;
    }
  }
  return [
    {
      title: 'Az egyenletrendszer mátrixa',
      text: `${n} egyenlet, ${n} ismeretlen. Mátrixba írjuk: soronként egy egyenlet, a függőleges vonal előtt az ismeretlenek (${plain.join(', ')}) együtthatói, utána a jobb oldal.`,
      terms: [bmatrix(start, n)],
      highlight,
      group,
    },
    {
      title: 'Gauss-elimináció',
      text: 'Soronként kiejtjük az ismeretleneket: egy sor megfelelő többszörösét kivonjuk az alatta lévőkből, amíg a főátló alatt csupa nulla nem lesz. Az utolsó sorban így egyetlen ismeretlen marad.',
      terms: [bmatrix(M, n)],
      highlight,
      group,
    },
    {
      title: 'Visszahelyettesítés',
      text: 'Az utolsó sorból kijön az utolsó ismeretlen; ezt visszaírva a fölötte lévő sorba a következő, és így tovább felfelé.',
      terms: x.map((_, i) => `${res(i)}${i < n - 1 ? ',\\quad' : ''}`),
      highlight,
      group,
    },
  ];
}
