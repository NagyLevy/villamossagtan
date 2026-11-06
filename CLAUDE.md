# Villamosságtan gyakorló

Egyenáramú hálózatok (villamosságtan, 1. félév) gyakorló webapp: véletlen (seedből reprodukálható)
feladatok, lépésenkénti, animált levezetés, napi kihívás pontozással és élő ranglista.
Élő oldal: https://nagylevy.github.io/villamossagtan/ — két diák használja a ZH-ra készülve.

A felhasználók kezdő programozók és villamosságtant tanuló diákok: a felületen és a levezetésekben
minden szöveg **magyarul**, egyszerűen, érthetően. A kód megjegyzései is magyarul vannak; ezt tartsd.

## Futtatás, tesztek, publikálás

```bash
npm install
npm run dev      # helyi fejlesztői szerver (Vite), http://localhost:5173
npm test         # Vitest, minden teszt (kb. 1 perc)
npm run build    # típusellenőrzés (tsc) + build a dist/ mappába
```

- **A `main` ágra feltöltött kód kb. 1 perc alatt élesbe megy** (GitHub Actions → GitHub Pages,
  `.github/workflows/deploy.yml`). Feltöltés előtt mindig fusson le hibátlanul a `npm test` és a
  `npm run build`.
- Ketten dolgozunk rajta: feltöltés előtt `git pull`, és ne írd felül a másik változtatásait.
- A teszteket ne kapcsold ki és ne lazítsd, hogy átmenjenek; ha egy teszt elbukik, a kódot javítsd.
  A tesztek a módszerek eredményét egy független MNA-megoldóval vetik össze.

## Felépítés

| Mappa | Mi van benne |
|---|---|
| `src/solver/` | Áramkör-modell (`model.ts`: Circuit, Netlist), MNA-megoldó (`mna.ts`), netlista (`netlist.ts`). Ez az „igazság”, ehhez mérünk mindent. |
| `src/generator/` | Feladatgenerátor: sablonok, értékek, kérdések, ellenőrzések (`validate.ts`), csillag-delta beépítés (`inject.ts`). Minden seedből determinisztikus (`rng.ts`). |
| `src/methods/` | Megoldási módszerek lépésenkénti levezetéssel: redukció, Kirchhoff, hurokáram, csomóponti potenciál, szuperpozíció, Thevenin/Norton, csillag-delta. `fit.ts`: melyik feladat melyik módszerhez való. `linsolve.ts`: egyenletrendszer levezetése. `redraw.ts`: újrarajzolt áramkörök. |
| `src/simplify/` | Soros-párhuzamos felismerés, csillag-delta átalakítás keresése. |
| `src/render/` | SVG-rajzolás (`svg.ts`, `layout.ts`), kiemelések (`overlay.ts`), áramlás-animáció (`flow.ts`). |
| `src/ui/` | A felület (sima TypeScript, keretrendszer nélkül): `app.ts` a fő vezérlő, `daily.ts` napi kihívás, `scoreFx.ts` pontozás-animáció, `leaderboardView.ts` ranglista, `login.ts` belépés. |
| `src/daily/` | Napi kihívás: menetrend (`schedule.ts`), napi feladat (`problem.ts`), haladás, pontozás, achievementek. |
| `src/online/` | Supabase: belépés és élő ranglista (`league.ts`). |
| `supabase/schema.sql` | Az adatbázis (fiókok, ranglista, belépő függvények). |
| `src/tests/` | Vitest tesztek. |

## Szabályok, amiket a felhasználók kértek (ezek felülírnak minden mást)

### Rajz és generátor
- **IEC forrásjelek:** feszültségforrás = kör, a vonal a vezeték **mentén** (kiiktatva rövidzár);
  áramforrás = kör, a vonal a vezetékre **merőleges** (kiiktatva szakadás). Az irányt jelző nyíl
  mindkettőnél a kör **mellett** van, sosem benne (feszültségforrás: vékony, nyitott hegy a nagyobb
  potenciál felé; áramforrás: tömör hegy az áram irányába). Lásd `src/render/svg.ts`.
- **Soha nincs két forrás sorosan** (sem egy ágon belül, sem egy olyan csomóponton át, ahol csak két
  forrás találkozik): `seriesSourcePairs` (`validate.ts`).
- **Egy hurokban (ablakban) legfeljebb egy forrás**, minden szinten, a ZH-n is (a közös ágon lévő
  forrás mindkét ablakba számít): `tooManySourcesInMesh` (`generate.ts`).

### Levezetések
- Minden eredmény mögött látható, érthető levezetés kell: képlet, behelyettesítés, eredmény,
  egyszerű magyarázattal („bárki megértse”).
- **Egyenletrendszert behelyettesítő módszerrel vezetünk le** (egy ismeretlen kifejezése, beírása a
  többi egyenletbe, körönként egy ismeretlen kiesik, végül visszahelyettesítés). **Gauss-elimináció,
  mátrix, Cramer-szabály, determináns nem lehet a levezetésben** — a felhasználók ezt nem tanulták.
  A gép belül számolhat bárhogy (`src/methods/linsolve.ts`).
- **Szuperpozíció: a részáramkörökben CSAK eredő ellenállás + feszültségosztás + áramosztás.**
  Nincs Kirchhoff-törvény, nincs csomóponti potenciál. Ha egy részáramkör nem bontható
  soros-párhuzamos részekre, arra a feladatra a szuperpozíció nem választható (kivétel: bekapcsolt
  csillag-delta, lásd lent). A napi szuperpozíciós feladatok mindig osztókkal megoldhatók
  (`src/daily/problem.ts`, teszt ellenőrzi).
- A φ jel a csomóponti potenciál (V), csak a csomóponti módszerben szerepel.

### Módszerfülek és feladatok
- Szabad gyakorlásnál minden módszerfül (és az „Új feladat” gomb) olyan feladatot hoz, amit
  **azzal a módszerrel a legkönnyebb** megoldani (`src/methods/fit.ts`); a feladat címe alatt ki is
  írja, miért (pl. „Csomóponti potenciállal 2 egyenlet, hurokárammal 3”).

### Kapcsolók (eszköztár)
- **Csillag-delta:** csak bekapcsolva kerül csillag-delta a feladatba, és **ugyanazt a seedű
  feladatot alakítja át** (a rajz szélére egy új ellenállás kerül, ettől híd lesz) — Eredő ellenállás,
  Feszültség- és áramosztás, Teljes hálózatanalízis, Thevenin (Rth) témakörben; szuperpozíciónál
  olyan feladatot hoz, amelynek egyik részáramkörében híd van. Kikapcsoláskor az előző feladat jön
  vissza, újra bekapcsoláskor az előző csillag-deltás (nem új véletlen). A napi kihívást nem érinti.
- **Áramkör újrarajzolása:** csak bekapcsolva; minden összevonásnál újrarajzolja az áramkört (az
  összevont ellenállások helyén az eredő, pl. „Re1 = 6 Ω”), animációval: a kamera rááll, megjelenik
  a jel (soros +, párhuzamos ×), soros összevonásnál a kieső elem elhalványul, párhuzamosnál
  odacsúszik és az ág vezetéke elhalványul. Nincs záró rugózás.

### Napi kihívás, pontozás, ranglista
- Minden nap 00:00-kor új kihívás; **ugyanazon a napon és fokozaton mindenkinek ugyanaz a feladat**
  (seed: `D{nap}-{fokozat}-{sorszám}`, `src/daily/schedule.ts`). Fokozatok: Free elo, Közepes,
  Tryhard, Kurva nehéz. 2026-11-02 és 11-08 között csak szuperpozíció, utána vegyesen. Első ZH: 2026-11-16.
- Napi feladatnál: a feladat (és a rajz) csak a **Start** után látszik, az óra akkor indul; a módszer
  kötött; nincs Gyakorló/Vizsga mód; az Ellenőrző nézet csak megoldás után érhető el (különben
  kiírná a választ).
- Pontozás szorzós (`src/daily/score.ts`, `achievements.ts`): feladatonként alappont × időbónusz ×
  levonások × sorozat × ZH-láz (×2/nap) × szorzó; minden megoldott feladat a nehézségtől függő
  szorzót ad, minden achievement szorzót ad. 10 mp alatti megoldás nem kap pontot (csalásszűrés).
  A számok tömören: 100k, 2,5M, 1,2B.
- Ranglista: a pontot mindenki gépe a naplóból újraszámolja (`sanitize` kiszűri a lehetetlen
  rekordokat). Belépés felhasználónév + jelszó, e-mail nélkül (Supabase, saját függvények a
  `schema.sql`-ben, bcrypt). A publishable kulcs nyilvános, a kódban maradhat; **secret/service_role
  kulcs és adatbázis-jelszó soha ne kerüljön a kódba vagy a chatbe.**

## Stílus
- Apple-szerű, letisztult felület, világos és sötét mód; telefonon is használható (`@media (max-width: 640px)`).
- A meglévő kód stílusát kövesd (elnevezések, magyar megjegyzések, kis tiszta függvények).
- Hardveres gyorsítás nélkül akadhat az elmosás: van „könnyített grafika” mód (`src/ui/perf.ts`).
