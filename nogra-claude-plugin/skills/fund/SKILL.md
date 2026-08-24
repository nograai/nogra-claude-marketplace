---
name: nogra-fund
description: "Index one finding as one line in the ledger (truth) and FUND-INDEKS.md (projection). Use when a red-proof catches a real instrument error, when one surface turns out to be two, when a rule flips sign at a transition, or when the user runs /nogra:fund."
---

# Nogra Fund

Chatten glemmer, committen skjuler. Et fund der ikke indekseres skal findes
igen — af den næste, til fuld pris. Fund-indekset er metodens råstof: klynger
i indekset bliver til love (memory) eller hegn (kode) ved operatørens dom,
aldrig ved værktøjets.

## Hvornår

- En rød-prøve fanger en ægte fejl i et instrument FØR det tros.
- En "én flade" viser sig at være to (en rolle, et hegn, en måling der kun
  dækker halvdelen af virkeligheden).
- En regel skifter fortegn ved en overgang (sand før, falsk efter — eller
  omvendt).
- Et hegn viser sig at måle sig selv i stedet for verden.

Ét fund = én linje. Er det længere, er det en tegning (drawings-registret).

## Form

- **Uret er sandheden:** hvert fund er et `fund`-event i ledgeren
  (`.nogra/ledger/events.jsonl`) med klasse, én linje og kilde.
- **`FUND-INDEKS.md`** (i `.nogra/state/`) er projektionen — skrives KUN af
  værktøjet, aldrig i hånden. Uret vinder ved uenighed.
- **Klasser** (frie, men genbrug før opfindelse):
  `instrument` · `flade` · `hegn` · `hegn-der-lyver` · `binding` · `blindplet`.
  `hegn-der-lyver` er et hegn der ALDRIG kan blive rødt — ikke et hegn der
  mangler, men et hegn der lyver; dyrere, fordi det køber tillid det ikke kan
  indfri. Skelnen gør morgenbakken lettere at prioritere.
- **Kilde er en peger** — sti, commit, event-id. Aldrig indhold, aldrig
  hemmeligheder.

## Brug

Workspacet stiller et håndtag til rådighed (i Y26-hubben: `bin/nogra-fund`):

    nogra-fund <klasse> "<én linje>" [kilde]

Findes håndtaget ikke i et adopteret workspace, er formen stadig loven:
append ét `fund`-event til ledgeren og én linje til projektionen — begge, i
den rækkefølge, ellers lyver projektionen om uret.

## Grænse

Fund-indekset dømmer ikke og rydder ikke op. Ophøjelse til lov, hegn eller
tegning — og sletning af forældede fund — er operatørens dom (morgenbakken).
Et fund uden kilde er et rygte: navngiv hvor det blev målt.
