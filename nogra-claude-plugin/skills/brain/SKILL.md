---
name: nogra-brain
description: "Braincheck and the sprinkler handle: measure native memory against its load window, how far brain/ is behind the ledger, the consolidation valve and the drawings registry — then offer consolidation, never run it without GO. Use when the user runs /nogra:brain (status | init | compile | consolidate) or a session start warns that consolidation is due."
---

# Nogra Brain

Alarmen er røgalarmen; write-loopet er sprinkleren. Denne skill **måler** hukommelsens og
brainens tilstand og **rækker** sprinkleren — den trækker den aldrig selv. Én tavle, aldrig
en forelæsning.

## Grænse

- Måler og tilbyder. Konsoliderer **aldrig** uden operatørens GO i chatten. Et `consolidation_due`
  i uret, en advarsel ved session-start eller en tavle over vinduet er **målinger, ikke tilladelser**.
- Rører aldrig `USER.md`, checkpointet eller lovtekst.
- Læser aldrig transcripts.
- `brain/` er **downstream** af uret: den kompilerer, den konkurrerer aldrig som autoritet.
  Uenighed mellem projektion og ur: uret vinder.

## Vinduet (dom 34, 23/08/2026 — målt mod platform-docs)

Claude Code loader kun `MEMORY.md` ved session-start, og kun de **første 200 linjer / 25 KB**.
Husets vindue er derfor `MEMORY.md ≤ 200 linjer / ≤ 25 KB`, med alarm-margin ved
**150 linjer / 15 KB**. Filantallet er frit. Checkpointet (`project_checkpoint.md`) har husets
eget vindue: **≤ 150 linjer**.

Linjetal måles med `wc -l`-semantik, så ethvert tal på tavlen kan efterprøves i hånden.

## Hvornår

- `/nogra:brain` eller `/nogra:brain status`.
- Session-start viste linjen `⚠ consolidation due since <dato>` — mål før du tilbyder.
- Før en `dayclose` (memory-trinnet), eller når nogen spørger *"hvor langt er brain bag uret?"*.
- Efter en konsolidering, for at se receipten lande.

## Verbs

### `status` (default · read-only)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" status --root "<absolute-workspace-root>"
```

Printer højst 12 linjer plus én dom-linje: memory (filer, `MEMORY.md` linjer/bytes mod vinduet,
største fil, checkpoint-linjer, `USER.md` bytes, sidste konsolidator-receipt med dato og
⚠-linjer), brain (raw uden `INGESTED`-markør, sidste `brain-compiled`-watermark mod urets, dage
bag), ventilen (seneste `consolidation_due`, besvaret eller ej, og om plugin-hooken er koblet) og
tegningsregistret (`drawings/index.md` mod nyeste tegning — halter registret?).

Skriver ét `brain-status`-event i uret med **kun tal**. `--json` giver de rå tal;
`--no-event` måler uden at kvittere.

### `line` (read-only, intet event)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" line --root "<absolute-workspace-root>"
```

Én linje til `/nogra:status`: `brain: inden for vinduet · brain-gap N dage · paper: bundet HH:MM`.
Den folder det nyeste `paper-bound`-event ind, skriver intet, og dømmer intet ud over det målte.

Præsentér tavlen som den er. Læg ikke en forelæsning ovenpå, og opfind ikke en dom
tavlen ikke har målt.

### `init`

Scaffolder `brain/`-hvælvet. Kører `/nogra:brain-init`-flowet uændret — se den skills
`SKILL.md` for previewet, GO-trinnet og idempotensen.

### `consolidate` (kræver operatørens GO i chatten)

Konsolidering er en **agent-rolle**, ikke et script. Skillen måler og tilbyder; `agents/consolidator.md`
gør arbejdet; operatøren åbner døren. Fire trin, i den rækkefølge:

**(a) Mål og vis tavlen.** Kør `status` og præsentér den. Uden en frisk måling er der ingen sag —
et tilbud om konsolidering skal bæres af tal, ikke af en fornemmelse.

**(b) Har operatøren IKKE sagt GO i chatten, så stop her** med én linje:

```text
afventer GO — konsolidering dispatches først når du siger til.
```

Ingen dispatch, ingen forberedelse, ingen "jeg går i gang imens". Et `consolidation_due` i uret er
en måling, ikke en tilladelse. Heller ikke en session-start-advarsel er GO.

**(c) På GO: dispatch `agents/consolidator.md`** (rolle-kontrakten er kilden — læs den, den vinder
ved uenighed). Modelvalg efter husets lov: **lange runs = Opus.** Dispatchen skal bære rollens
krævede input — et `nogra.memory.resolution.v1`-record med `status=resolved`, vinduet fra dom 34,
ledger-stien, brain-stien (eller "no brain"), og flag-/note-stier der skal ryddes — plus husets
standard-brief:

- **før-kopi FØR første edit:** den urørte original til `memory/archive/<navn>-<dato>.md`, også når
  en fil trimmes på plads. Komprimering må aldrig være den eneste overlevende kopi;
- **ingen sletning — kun arkivering.** `archive/` ligger uden for load-vinduet; vinduet handler om
  hvad der LOADES, ikke hvad der findes;
- **rør aldrig `USER.md`, `project_checkpoint.md` eller lovteksten** (brødteksten i `feedback-*.md`).
  De kondenseres ikke af en agent — de er operatørens ord;
- **indeks-hooks ≤ ~140 tegn** i `MEMORY.md`: én linje pr. fil, en peger, ikke et referat;
- **receipt** i `memory/archive/consolidation-run-N-<dato>.md` med FØR → EFTER-tallene og en
  **⚠-liste** over alt der blev ladt stå, flagget eller er tvivlsomt. Er en fletning tvetydig:
  lad den stå og flag den — gæt aldrig.

**(d) Når receipten findes, kvittér den:**

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" consolidated \
  --receipt "<memory>/archive/consolidation-run-N-<dato>.md" --root "<absolute-workspace-root>"
```

Den læser receipten, skriver ét `brain-consolidated`-event i uret (tal + receipt-sti + run-nummer)
og føjer ÉN fod-linje til `MEMORY.md`:

```text
*Run 42 (2026-08-23): 62 → 41 filer · indeks 8,0 KB · receipt archive/consolidation-run-42-2026-08-23.md*
```

Det er den linje der lukker alarmen: er `brain-consolidated` nyere end den åbne `consolidation_due`,
tier session-start igen. Verbet nægter (exit 2) hvis receipten ikke ligger i en `archive/`-mappe, og
er idempotent — anden kørsel med samme receipt skriver hverken event eller fod-linje.
`--memory-dir <dir>` peger på en anden memory-mappe end den resolverede (bruges af smoke-testene;
i drift er default den rigtige).

### `compile` (delvist)

Klokken er bundet; pennen er det ikke. Selve destilleringen `raw/` → `wiki/` er stadig en
læse/skrive-opgave for Manager eller en agent. Skillen binder kun regnskabet:

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" mark <raw-fil> [note]
node "${CLAUDE_PLUGIN_ROOT}/scripts/nogra-brain.mjs" stamp "<linje>"
```

`mark` sætter `INGESTED`-markøren i sidecar'en `brain/raw/.ingested.tsv` — `raw/` er
byte-immutabel og røres aldrig. `stamp` skriver `brain-compiled` i uret med `metadata.watermark`
og spejler linjen i `brain/log.md`, så *"hvor langt er brain bag uret?"* er en måling og ikke
en fornemmelse.

Dette er husets `bin/brain-run mark|stamp` flyttet ind under plugin-taget. Findes begge, er
pluginens den der gælder.

**Gap-reglen:** `status` viser gap'et (raw uden markør · sidste `brain-compiled`-watermark mod
urets · dage bag). Selve destilleringen `raw/` → `wiki/` er Manager/agent-arbejde — **skillen
binder klokken, ikke pennen.** Et stempel uden en kompilering bag sig er en løgn i uret, så
`stamp` køres FØRST når wiki-siden faktisk står.

## Ventilen (alarmen der taler igen)

Ventilen bor i pluginens SessionEnd-hook — `hooks/session-end.mjs` →
`runtime/local/brain-valve.mjs`. Den måler vinduet ved session-slut og, kun når målingen er over
margin, logger den ét `consolidation_due` i uret og skriver **én linje** til
`inbox/out/consolidation-due-<dato>.md`. Én gang pr. workspace pr. dag. Fail-open: den holder
aldrig døren på vej ud.

Ved næste session-start siger `hooks/memory-load.mjs` det **én** gang:

```text
⚠ consolidation due since <dato>: MEMORY.md <n> lines / <kb> KB — offer /nogra:brain consolidate
```

Den siger hvad den målte. Den spørger ikke. Linjen forsvinder når et `brain-consolidated`
(eller husets ældre `consolidation_done`) er nyere end den åbne `consolidation_due`.

## Events

`brain-status` · `consolidation_due` · `brain-compiled` · `brain-consolidated`.
Tal og pegere — aldrig prosa, aldrig hemmeligheder.
