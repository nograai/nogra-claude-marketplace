---
name: nogra-paper
description: "The Paper as a projection of the ledger: bind the decision log and the matching ledger lines into the paper as one collapsible block, never handwritten. Use when the user runs /nogra:paper (bind | now | publish), after a decision is recorded, or when the paper must be refreshed before it is republished as an artifact."
---

# Nogra Paper

Papiret er husets opslag — det tavlerne viser mennesker. Denne skill gør det til en
**projektion af uret + DECISIONS.md**, aldrig en håndskrevet side. Skrives det i hånden, er det
en påstand; bindes det, er det en måling.

## Grænse

- **Projektion, aldrig kilde.** Skillen ændrer aldrig `DECISIONS.md` og aldrig uret.
- Ingen hemmeligheder i papiret — kun navne, tal og ids.
- Ét papir pr. workspace. Papiret peges ud i config, ikke gættet.
- Skillen skriver **aldrig** `.nogra/config.json` for operatøren. Mangler nøglen, siger den
  præcis hvad der skal tilføjes, og stopper.

## Konfiguration

`.nogra/config.json` → `paper`:

```json
{
  "paper": {
    "file": "<path to the paper html — relative to the workspace root, or absolute>",
    "artifactUrl": "https://claude.ai/code/artifact/<artifact-id>",
    "decisions": ".nogra/state/DECISIONS.md",
    "ledger": ".nogra/ledger/events.jsonl"
  }
}
```

`decisions` og `ledger` har disse defaults; `file` har ingen. Mangler `paper`, printer `bind`
blokken ovenfor og afslutter med exit 2 — operatøren tilføjer den selv.

## Hvornår

- `/nogra:paper bind` — efter en ny dom, eller når papiret skal være i sync før en republicering.
- Når nogen spørger *"står papiret rigtigt?"* — bind det, og se antallet af domme.
- Aldrig som en stille baggrundsvane: bind når sandheden har flyttet sig.

## Verbs

### `bind` (implementeret)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-bind.mjs" --root "<absolute-workspace-root>"
```

Parser `DECISIONS.md` i **begge** former (`## N · titel` og `- Date: …` + `**N · titel:**`),
finder de uret-linjer der nævner hver dom (`dom/brief/pkt/punkt N`, `"N GO"`), og skriver ét
`<details>`-fold pr. dom — nyeste først — mellem markørerne:

```html
<!-- PAPER-BIND:DECISIONS START -->  …  <!-- PAPER-BIND:DECISIONS END -->
```

Findes markørerne ikke, indsættes blokken efter `<p class="lead">` under papirets
"Til dig"-overskrift. Et papir der stadig bærer husets gamle `PAPIR-BIND`-markører bliver
**migreret på stedet** — aldrig dobbelt-indsat.

**Idempotent:** blokken erstattes, aldrig tilføjes. To kørsler i samme minut giver samme fil,
byte for byte.

Flag: `--markers papir` skriver de gamle markørnavne (kompatibilitet med `bin/papir-bind`),
`--generator <tekst>` sætter linjen "Genereres af …", `--now "<dd/mm/åååå TT:MM>"` fastfryser
stemplet, `--no-event` binder uden kvittering, `--json` giver tal i stedet for prosa.

Skriver ét `paper-bound`-event i uret: antal domme, papirets sti, `sha256`, artifact-URL.

`--last` binder ikke — den læser det nyeste `paper-bound`-event og printer én linje
(`paper: bundet HH:MM · N domme`). Det er formen `/nogra:status` bruger.

Dette er husets `bin/papir-bind` flyttet ind under plugin-taget. Porten er verificeret mod
originalen: samme input → **diff 0** på begge grene (markør-erstatning og anker-indsættelse).

### `now` (implementeret)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/paper-now.mjs" --root "<absolute-workspace-root>"
```

Papirets "Lige nu"-side **måler**, den husker ikke. Alt på siden læses i samme øjeblik:

- **uret** — antal linjer, antal events, de nyeste tre linjer med stempel og type;
- **dørene** — URL'erne i `paper.doors` måles med `curl` og et loft på 10 sekunder. Koden
  farves med papirets egne klasser (2xx grøn · 3xx/4xx gul · alt andet rød). Ingen døre i
  config → linjen siger `ingen døre i config`, og der gættes aldrig en status;
- **åbne domme** — heuristikken er eksplicit: en dom er åben når dens **overskrift** nævner
  `GO?`, `afventer` eller `udestår`. Listen kan skiftes pr. workspace med
  `paper.openMarkers`. Siden skriver heuristikken ud, så et nul kan læses som *"ingen
  overskrift matcher"* og ikke som *"ingen åbne domme"*;
- **fund** — de nyeste 5 linjer fra `.nogra/state/FUND-INDEKS.md` (nyeste nederst i filen);
- **valgfri kommando** — er `paper.sql` sat i config, køres den i workspacets rod (20 s loft)
  og dens stdout kommer med. Teksten **escapes** før den lægges ind: ordret tekst, aldrig
  markup injiceret i operatørens papir;
- **stempel** — `date` i samme greb.

Siden skrives mellem `<!-- PAPER-NOW START -->` og `<!-- PAPER-NOW END -->`, sidst i papirets
krop. Findes markørerne, **erstattes** blokken — idempotent. Højst ~25 linjer HTML, og kun
papirets egne klasser (`.page .ed .lead .k .g .y .r .recv .pn`) — der opfindes ingen styling.

Skriver ét `paper-now`-event med tal: urets linjer/events, døre målt og døre OK, domme og
åbne domme, antal fund, om kommando-hooken kørte, antal HTML-linjer.

### `publish` (ikke implementeret endnu)

Artifact-værktøjet er **sessionens**, ikke skillens. `publish` bliver derfor en instruks: den
siger præcis hvilket kald Manager skal lave for at republicere `paper.file` til `paper.artifactUrl`,
og kvitterer bagefter med URL'en i uret som `paper-published`. Byggetrin i tegningen.

Indtil da: efter `bind` siger du til operatøren at papiret er opdateret (N domme) og skal
republiceres — du republicerer det ikke stiltiende.

## Bindinger (aktive)

Papiret er ikke et sted man husker at gå hen — det følger med:

- **`decide`** kalder `scripts/nogra-decide-hook.mjs` umiddelbart efter append. Projektionen
  følger sandheden i samme greb, og operatøren får linjen
  `Papiret opdateret (N domme) — republicér.` Trinnet blokerer aldrig en dom.
- **`dayclose`** måler memory-vinduet med `nogra-brain.mjs status` (trin 4) og kører
  `paper now` som den sidste projektion før den målte slutkontrol (trin 7).
- **`status`** printer én linje:
  `brain: inden for vinduet · brain-gap N dage · paper: bundet HH:MM`.

`publish` er stadig Managers kald — intet af ovenstående republicerer noget.

## Events

`paper-bound` · (senere) `paper-now` · `paper-published`. Tal, stier, sha — aldrig prosa.
