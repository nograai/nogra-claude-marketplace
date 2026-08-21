---
name: nogra-grade
description: "Judge a data source with the five-step GRADE method (anchor tasting, field statistics, eye on hole-class and typical representative, red/yellow/green verdict that gates the decision). Use when the user runs /nogra:grade or asks for a source-quality verdict before a revival or promotion. Internal skill, never shipped."
internal: true
---

> **INTERN — SHIPPES ALDRIG (CEO-hegn 20/08: "den grade du lavede er KUN til
> os selv - ikke til folk").** Denne skill er husets egen kvalitetsmetode.
> Release-cuttet SKAL ekskludere `skills/grade/` — den står på backloggens
> release-tjekliste, og `internal: true` i frontmatter er det mekaniske flag.

# Nogra Grade

En kilde dømmes aldrig mod nul, og aldrig kun på sine pæne eksempler. GRADE
giver dommen tre ben: et ANKER (husets bedste, set med øjet), et OMFANG
(mekanisk statistik over hele bestanden) og en ÅRSAG (øjet på repræsentanter).
Metoden blev CEO-døbt 20/08/2026 efter den i første kørsel fangede 234
slug-lovbrud FØR en genoplivning satte dem i drift.

## De fem trin, i rækkefølge

1. **ANKER-SMAGNING (trin 0, altid).** Udvælg 3 tilfældige blandt de RIGESTE
   live-enheder på produktet: rigdoms-score i SQL (indholdslængde +
   billedantal×vægt + udfyldte nøglefelter×vægt), top-pulje (~30), seedet
   `random()` pr. pas så udvælgelsen kan GENAFSPILLES. Åbn dem i browseren.
   De er sigtelinjen — der måles mod husets bedste, aldrig mod nul.
2. **MEKANISK FELT-STATISTIK** over HELE kildens bestand i én forespørgsel:
   null-rater pr. nøglefelt, indholdslængder (snit + andel tynde),
   billed-tælling — OG lov-tjek direkte i data (fx forbudte mønstre i
   offentlige identifikatorer). Tallene giver hullerne NAVNE og OMFANG før
   øjet åbnes.
3. **ØJE PÅ KLASSE-REPRÆSENTANTER.** Seedet udvælgelse af én fra HUL-KLASSEN
   (felterne mangler) og én TYPISK (felterne findes) — aldrig kun pæne
   eksempler. Døm dem felt-for-felt mod ankrene. Kun øjet afslører
   template-indhold ("en taloplæsning er ikke en beskrivelse").
4. **GRADES med konsekvens:**
   - 🔴 HÅRDT = lovbrud eller kundeløfte-brud → **GATER beslutningen**
     (ingen genoplivning/promotion før kuren står).
   - 🟡 TAB = kvalitet kilden HAR men adapteren/vejen taber → runde 2-
     kandidater; blokerer ikke, men rid med hvis billigt.
   - 🟢 SUNDT = navngives OGSÅ — så runde 2 ved hvad der ikke skal røres.
5. **VERDICT TIL BUILDER** (QA-loopets form): fund → kur → runde 2 → FØRST DA
   fyres beslutningen. Porten står før døren.

## Bindinger

- Hvert 🔴- og 🟡-fund indekseres i samme øjeblik det falder — brug
  `fund`-skillen (uret er sandheden, indekset projektionen).
- Verdictet er intent-bærende: det GATER en navngiven beslutning og siger
  hvad der åbner den ("tilbagerul venter på slug-kuren"), aldrig kun "rød".
- Trin 1-2 genbruges 1:1 mellem kilder — kun kilde-navnet skifter. Gem
  udvælger-forespørgslen i workspacet første gang den skrives.
- Stikprøver MÆRKES ("N sete", "seedet pr. kilde+dato") — en umærket
  stikprøve bliver en måling i modtagerens hånd.

## Hvornår

Ved HVER kilde-genoplivning, hver promotion, hvert runde 2-pas — og når
operatøren beder om en kvalitetsdom over noget der allerede er i drift.
