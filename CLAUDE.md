# Villamosságtan gyakorló

Villamosságtan gyakorló webapp egyetemi elektronikai kurzus mellé (Villamosságtan 1: egyenáramú
hálózatok; Villamosságtan 2: szinuszos hálózatok, rezgőkörök, bekapcsolási jelenségek; a tananyag
Kuczmann–Kovács: Villamosságtan, Lineáris hálózatok elmélete I.). Véletlen (seedből reprodukálható)
feladatok, lépésenkénti, animált levezetés. Négy mód: gyakorlás, időre, próbavizsga, napi feladatok.
Nincs bejelentkezés, ranglista és pontrendszer. Élő oldal: https://nagylevy.github.io/villamossagtan/

A felhasználók villamosságtant tanuló diákok: a felületen és a levezetésekben minden szöveg
**magyarul**, egyszerűen, érthetően. A kód megjegyzései is magyarul vannak; ezt tartsd.

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
| `src/ac/` | Szinuszos és bekapcsolási feladatok: komplex számok (`complex.ts`), független komplex MNA (`mna.ts`, az „igazság”), létrahálózat és osztólánc (`ladder.ts`), levezetés-építőkockák (`derive.ts`), feladatgenerátor (`problems.ts`). |
| `src/tasks/` | Közös feladatformátum (`types.ts`: Task, AnswerField), feladat-előállítás és próbavizsga-sorok (`index.ts`), válaszellenőrzés mezőnként (`check.ts`: szám, szög, kompenzáló elem). |
| `src/ui/` | A felület (sima TypeScript, keretrendszer nélkül): `app.ts` a keret és a négy mód, `viewer.ts` egy feladat nézete (rajz, lejátszó, megoldás, válaszmezők), `settings.ts` beállítások. |
| `src/daily/` | Napi feladatsor: menetrend (`schedule.ts`, egyenáram és váltóáram), napi feladat (`problem.ts`), haladás a böngészőben (`progress.ts`). |
| `src/tests/` | Vitest tesztek. |

## Szabályok, amiket a felhasználók kértek (ezek felülírnak minden mást)

### Rajz és generátor
- **IEC forrásjelek:** feszültségforrás = kör, a vonal a vezeték **mentén** (kiiktatva rövidzár);
  áramforrás = kör, a vonal a vezetékre **merőleges** (kiiktatva szakadás). Az irányt jelző nyíl
  mindkettőnél a kör **mellett** van, sosem benne (feszültségforrás: vékony, nyitott hegyű nyíl, a
  **feszültség nyila: a nagyobb potenciáltól a kisebb felé**, ugyanúgy, mint az ellenállásokon eső
  feszültségé; áramforrás: tömör hegy az áram irányába). Lásd `src/render/svg.ts`, `layout.ts`.
  Így tanítja Dr. Lilik Ferenc; az internetes „a + felé mutat” jelölést NE használd.
- **Huroktörvény / hurokáram felírása (Dr. Lilik Ferenc szerint):** minden tag a bal oldalon, „= 0”;
  amelyik feszültség nyila egyezik a körüljárással, az **+**, amelyiké szembe megy, az **−** (a
  feszültségforrásé is). Utána rendezzük át a megoldáshoz (`src/methods/loopcurrent.ts`).
- **Soha nincs két forrás sorosan** (sem egy ágon belül, sem egy olyan csomóponton át, ahol csak két
  forrás találkozik): `seriesSourcePairs` (`validate.ts`).
- **Átívelő ágak, mint a ZH-rajzokon:** a többforrásos, Thevenin-, Kirchhoff- és ZH-feladatok egy
  részében a váz fölött vagy alatt egy külön ág ível át (pl. felül a teljes szélességben egy R6),
  az eredő/osztó feladatokban néha egy sínszakasz fölött „púp” (azzal párhuzamos, így soros-párhuzamos
  marad). `addBypass`, `randomBypass` (`templates.ts`).
- **Keresztbe (átlósan, 45°-ban) kötött ellenállás** a többforrásos, Thevenin-, Kirchhoff- és ZH-feladatok
  kb. 15%-ában egy ép rácscellában (`addDiagonal`, `templates.ts`); az átívelő ág kb. 10–20%-ban. Nem
  minden feladatban, csak néhányban. A rajz (`layout.ts`, `svg.ts`) és az ellenőrzés (`validate.ts`)
  kezeli az átlós ágat.
- **Csillag-delta** külön témakörként is választható (beállítás nélkül), a napi sorban is van, és a
  próbavizsga Thevenin-feladatában is előfordul. A Beállítások kapcsolójával a többi témakörbe is
  bekerülhet, de bekapcsolva is csak a feladatok kb. harmadába.
- **A váltóáramú rész egyelőre zárva** (`AC_ENABLED = false`, `src/ui/app.ts`): a fül szürke,
  „Hamarosan” felirattal, a szinuszos és vegyes próbavizsga sem indítható. A kód kész és tesztelt
  (`ac.test.ts`, `exams.test.ts`: a feltöltött 2020-as vizsgafeladatok újraszámolva).
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

### A tanár úr (Dr. Lilik Ferenc) megoldásmenete — a levezetések ehhez igazodnak
- **Hurokáram** (`loopcurrent.ts`): először l = b − n + 1 (ágak, csomópontok). Hurokáramok neve
  J₁, J₂ …, óramutató szerint. **Minden áramforrásnak saját, ismert hurka van** (a hurokáram a
  forrás árama, a rajzon „5 A” felirattal); **nincs szuperhurok**. Minden ellenállást és
  feszültségforrást érintenie kell egy ismeretlen huroknak. Tagok: R·(saját J előre, a többi után,
  ismert hurok számmal), pl. R₃(J₂ − 5); „= 0” alak, utána rendezés.
- **Csomóponti potenciál** (`nodal.ts`): ismeretlenek száma n − 1 − nᵤ (nᵤ: feszültségforrással
  rögzített csomópontok). Egyenlet: „kifolyó áramok összege = 0”, törtekkel, a számok beírva, a
  referencia φ-je nem szerepel (φ₁/4, nem (φ₁ − φ₀)/4); utána beszorzás a nevezők legkisebb közös
  többszörösével, hogy egész együtthatók legyenek.
- **Helyettesítő generátor** (`thevenin.ts`): jelölés Rg, Uü, In (nem Rth, Uth). Rg = R_AB a források
  kiiktatásával, **mindig üresjárásban**. Uü forrásonként (szuperpozíció) eredővel és osztókkal, a
  részfeszültség iránya (A→B) vagy (B→A), a végén előjeles összeg; csomóponti módszer csak, ha egy
  részáramkör nem bontható. In = Uü / Rg (nincs külön rövidzárási számolás). Illesztés: Rt = Rg,
  Pmax = Uü² / (4 Rg). A Thevenin-témakörben a „Szuperpozíció” módszer is ezt a menetet adja.

### Módszerfülek és feladatok
- Szabad gyakorlásnál minden módszerfül (és az „Új feladat” gomb) olyan feladatot hoz, amit
  **azzal a módszerrel a legkönnyebb** megoldani (`src/methods/fit.ts`); a feladat címe alatt ki is
  írja, miért (pl. „Csomóponti potenciállal 2 egyenlet, hurokárammal 3”).

### Beállítások (egy panelen, nem az eszköztáron)
- **Csillag-delta:** csak bekapcsolva kerül csillag-delta a feladatba (akkor is csak kb. minden
  harmadikba), és ugyanazt a seedű feladatot alakítja át (a rajz szélére egy új ellenállás kerül, ettől híd lesz) — Eredő ellenállás,
  Feszültség- és áramosztás, Teljes hálózatanalízis, Thevenin (Rth) témakörben. A napi feladatokat
  nem érinti.
- **Áramkör újrarajzolása:** csak bekapcsolva; minden összevonásnál újrarajzolja az áramkört (az
  összevont ellenállások helyén az eredő, pl. „Re1 = 6 Ω”), animációval: megjelenik a jel (soros +,
  párhuzamos ×), soros összevonásnál a kieső elem elhalványul, párhuzamosnál odacsúszik és az ág
  vezetéke elhalványul. A nézet közben nem mozdul el.

### Szinuszos feladatok (Villamosságtan 2)
- Jelölés a könyv szerint: komplex csúcsérték Û, Î; impedancia Z̄ = R + jX; a szög fokban; a
  generátor u(t) = Û·cos(ωt + φ). Teljesítmény: S̄ = ½·Û·Î*, P = Re, Q = Im (induktív: Q > 0).
- A levezetés a vizsgamegoldások menetét követi: reaktanciák → eredő impedancia a túlsó végtől →
  osztók a generátortól a keresett elemig → időfüggvény. Itt sincs mátrix, determináns.
- Minden szinuszos és bekapcsolási eredményt a tesztek a független komplex MNA-val vetnek össze
  (`src/tests/ac.test.ts`). Új feladattípusnál ilyen teszt is kell.
- Bekapcsolásnál a hálózat a kapcsoló zárása előtt energiamentes; τ a Thevenin-ellenállásból.

### Módok
- **Gyakorlás:** azonnali ellenőrzés, tipp lépésenként, teljes megoldás; egyenáramnál a módszer
  egy legördülőből választható (ha a mostani feladathoz nem jó, illő feladat jön).
- **Időre:** egy feladat, visszaszámláló óra; a megoldás beadás vagy lejárat után látszik.
- **Próbavizsga:** teljes feladatsor (egyenáram 5 / szinuszos 10 / vegyes 7 feladat) közös órával,
  beadás után összesítés és feladatonkénti megoldás. Pontrendszer, ranglista nincs.
- **Napi feladatok:** naponta új sor, mindenkinek ugyanaz (seed: `D{nap}-{terület}-{fokozat}-{sorszám}`),
  csak a kész feladatok jelölése marad meg a böngészőben.
- A rajz nézete nem mozog (nincs automatikus nagyítás): a kiemelés és a feliratok mutatják a lépést.

## Stílus
- Apple-szerű, letisztult felület, világos és sötét mód; telefonon is használható (`@media (max-width: 640px)`).
- A meglévő kód stílusát kövesd (elnevezések, magyar megjegyzések, kis tiszta függvények).
- Hardveres gyorsítás nélkül akadhat az elmosás: van „könnyített grafika” mód (`src/ui/perf.ts`).
