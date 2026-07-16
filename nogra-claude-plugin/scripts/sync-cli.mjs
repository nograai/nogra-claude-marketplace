#!/usr/bin/env node
// Nogra Sync CLI — the human handle on the sync edges (backs the /nogra:sync skill).
//
// Verbs: status (default) · run · pull · push · bind <endpoint> · off
//
// Contract (binding):
// - The token NEVER passes through this tool: not as an argument, not in output. Status
//   reports token PRESENCE (env / file / missing), never a value. Storing the token is the
//   operator's own hand — env NOGRA_SYNC_TOKEN or the gitignored .nogra/memory/sync/token.
// - bind/off touch ONLY the `sync` block of .nogra/config.json; the rest of the file is
//   preserved byte-for-byte in spirit (parsed, updated, re-serialized).
// - Every verb leaves a receipt in .nogra/memory/sync/log.jsonl (pull/push write their own
//   inside the client; bind/off write theirs here). Silent state changes are a lie.
// - Fail-open, informative: a missing config is a report, not a crash.

import { readFileSync, writeFileSync, mkdirSync, appendFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { syncPull, syncPush, syncDir } from "../runtime/local/sync-client.mjs";

// S-A (16/07, cwd-fælden): roden findes OPAD — nærmeste .nogra/ fra cwd og op. Kørt fra en
// undermappe virker alt; kørt UDENFOR workspacet siger vi det HØJT i stedet for det stille
// "no changes" der kostede operatøren en runde i dag. CLAUDE_PROJECT_DIR vinder altid.
function findRoot(start) {
  let d = start;
  while (true) {
    if (existsSync(join(d, ".nogra"))) return d;
    const parent = dirname(d);
    if (parent === d) return null; // nåede filsystemets rod uden fund
    d = parent;
  }
}
const root = process.env.CLAUDE_PROJECT_DIR || findRoot(process.cwd());
if (!root) {
  console.error(
    `sync: ingen .nogra/ fundet fra ${process.cwd()} og opad — stå i workspacet (fx cd ~/y26dev) eller sæt CLAUDE_PROJECT_DIR.`,
  );
  process.exit(1);
}
const rawArgs = process.argv.slice(2);
const homeFlag = rawArgs.includes("--home");
const [verb = "status", arg] = rawArgs.filter((a) => a !== "--home");
const configPath = join(root, ".nogra", "config.json");
const dir = syncDir(root);

function readConfig() {
  try {
    return JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    return null;
  }
}

function receipt(entry) {
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "log.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function tokenPresence() {
  if (process.env.NOGRA_SYNC_TOKEN) return "env NOGRA_SYNC_TOKEN";
  if (existsSync(join(dir, "token"))) return "file .nogra/memory/sync/token";
  return "MISSING";
}

// S-B (16/07, den stille tomme fil): tokenet INSPICERES — metadata, aldrig værdien. En tom eller
// malformet token-fil får et NAVN og en KUR i stedet for at ligne succes; det stille "no changes"
// kostede operatøren to runder i dag. Værdien printes ALDRIG (hegnet: tokens rører aldrig modellen).
function b64urlJson(s) {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  return JSON.parse(Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf8"));
}
function tokenInspect() {
  let raw = "";
  let source = "";
  let bytes = 0;
  if (process.env.NOGRA_SYNC_TOKEN) {
    source = "env NOGRA_SYNC_TOKEN";
    raw = process.env.NOGRA_SYNC_TOKEN.trim();
    bytes = Buffer.byteLength(process.env.NOGRA_SYNC_TOKEN);
  } else if (existsSync(join(dir, "token"))) {
    source = "file .nogra/memory/sync/token";
    try {
      const fileRaw = readFileSync(join(dir, "token"), "utf8");
      bytes = Buffer.byteLength(fileRaw);
      raw = fileRaw.trim();
    } catch {
      return { ok: false, problem: "unreadable", line: `${source} kan ikke læses — tjek rettigheder (chmod 600)` };
    }
  } else {
    return { ok: false, problem: "missing", line: "MISSING — mint (operatørens hånd) og placér i .nogra/memory/sync/token" };
  }
  if (!raw) return { ok: false, problem: "empty", line: `${source} er TOM (${bytes} bytes) — placeringen fejlede; mint og placér igen (scp slår clipboard)` };
  const m = /^nst_([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(raw);
  if (!m) return { ok: false, problem: "malformed", line: `${source} er MALFORMET (${bytes} bytes, ligner ikke nst_…) — placér et ægte token` };
  try {
    const p = b64urlJson(m[1]);
    const expired = typeof p.exp === "number" && p.exp * 1000 < Date.now();
    return {
      ok: !expired,
      problem: expired ? "expired" : null,
      meta: p,
      line: `${source} · seat=${p.seat ?? "(intet — stempler 'ukendt')"} · scopes=${(p.scopes || []).join("+")} · exp=${typeof p.exp === "number" ? new Date(p.exp * 1000).toISOString() : "?"}${expired ? " ⚠ UDLØBET — mint nyt" : ""}`,
    };
  } catch {
    return { ok: false, problem: "malformed", line: `${source}: payload kan ikke afkodes — placér et ægte token` };
  }
}

function readJson(path, fallback) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function tailReceipts(n) {
  try {
    const lines = readFileSync(join(dir, "log.jsonl"), "utf8").trim().split("\n");
    return lines
      .slice(-n)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return null; // a corrupt receipt line must not hide the healthy ones
        }
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function inboxCount() {
  try {
    return readFileSync(join(dir, "inbox.jsonl"), "utf8").trim().split("\n").filter(Boolean).length;
  } catch {
    return 0;
  }
}

function fmtReceipt(r) {
  const bits = [r.ts, r.op, r.ok === false ? `FAIL ${r.error || ""}`.trim() : "ok"];
  if (r.skipped) bits.push(`skipped:${r.skipped}`);
  if (r.changed && r.changed.length) bits.push(`merged:${r.changed.join("+")}`);
  if (r.newTurns) bits.push(`turns:+${r.newTurns}`);
  if (typeof r.cursor === "number") bits.push(`cursor:${r.cursor}`);
  if (r.overBudget && r.overBudget.length) bits.push(`OVER-BUDGET:${r.overBudget.join("+")}`);
  if (r.endpoint) bits.push(r.endpoint);
  if (typeof r.ms === "number") bits.push(`${r.ms}ms`);
  return bits.join(" · ");
}

async function main() {
  const config = readConfig();

  // S-B: kaldte verber fejler HØJT på et brudt token — CLI'en er operatørens hånd, og hånden skal
  // have sandheden med kur, aldrig et stille "no changes" (16/07-læren: 0 bytes lignede succes).
  // Hookenes/tickens edges forbliver fail-open — en session må aldrig blokeres af sync.
  if (["run", "pull", "push"].includes(verb) && config && config.sync && config.sync.enabled === true) {
    const ti = tokenInspect();
    if (!ti.ok) {
      console.error(`sync ${verb}: ${ti.line}`);
      receipt({ op: verb, ok: false, error: `token:${ti.problem}` });
      return 1;
    }
  }

  if (verb === "status") {
    if (!config) {
      console.log(`sync: Nogra is not initialized here (no .nogra/config.json at ${root})`);
      return 0;
    }
    const sync = config.sync || null;
    const state = readJson(join(dir, "state.json"), {});
    console.log(`enabled:  ${sync && sync.enabled === true ? "yes" : "no (off by default)"}`);
    console.log(`endpoint: ${sync && sync.endpoint ? sync.endpoint : "(not set)"}`);
    let seatMode = "";
    try { seatMode = readFileSync(join(dir, "mode"), "utf8").trim(); } catch {}
    const effectiveMode = seatMode ? seatMode : (sync && sync.mode === "replace" ? "replace" : "union");
    console.log(`mode:     ${effectiveMode === "replace" ? "home (replace — this seat's push hands the cloud its consolidated state)" : "remote (union — append-safe)"}${seatMode ? " · seat file" : sync && sync.mode ? " · LEGACY config (move to seat file: bind --home)" : ""}`);
    const ti = tokenInspect();
    console.log(`token:    ${ti.line}`);
    // S-B: sædet ved selv HVEM det er og HVEM de andre er — bekræftelsen operatøren lavede i
    // hånden hele 16/07 (rå himmel-kald ×9) bor nu i status. Tavlen er fra SIDSTE pull (ærligt dateret).
    console.log(`you:      ${state.you || "(ukendt endnu — første pull stempler)"}`);
    const board = state.seatBoard || {};
    const seats = Object.entries(board);
    if (seats.length) {
      console.log(`tavlen (pr. sidste pull ${state.lastPullAt || "?"}):`);
      for (const [n, s] of seats) console.log(`  ${n}: set ${s.last_seen || "?"} · pushed ${s.last_pushed || "aldrig"} · dirty=${!!s.dirty}`);
    }
    if (ti.meta) {
      const hasReplace = (ti.meta.scopes || []).includes("memory:replace");
      if (effectiveMode === "replace" && !hasReplace)
        console.log(`kohærens: ⚠ FEJL — sædet er HOME (replace-mode) men tokenet MANGLER memory:replace; replace-push får 403. Kur: mint --home, eller sæt sædet til union`);
      else if (effectiveMode !== "replace" && hasReplace)
        console.log(`kohærens: ⚠ tokenet bærer replace-magt men sædet er union — én krone pr. bruger: flyt kronen eller mint et union-token`);
      else console.log(`kohærens: rolle og token matcher ✓`);
    }
    console.log(`lastPull: ${state.lastPullAt || "never"}${typeof state.lastCursor === "number" ? ` · cursor ${state.lastCursor}` : ""}`);
    console.log(`lastPush: ${state.lastPushAt || "never"}`);
    console.log(`inbox:    ${inboxCount()} remote turn(s) awaiting consolidation`);
    const receipts = tailReceipts(5);
    if (receipts.length) {
      console.log(`receipts (last ${receipts.length}):`);
      for (const r of receipts) console.log(`  ${fmtReceipt(r)}`);
    } else {
      console.log("receipts: none yet");
    }
    return 0;
  }

  if (verb === "doctor") {
    // S-C (16/07): DOKTOREN — dagens to-timers jagter som ÉT kald. Otte falsificérbare tjek,
    // hver med sin kur; læser alt, ændrer intet; token-VÆRDIEN forlader aldrig processen.
    // Født af 401-jagten (svaret lå i authz.ts hele tiden) og tavle-bekræftelserne i hånden.
    const lines = [];
    let fejl = 0;
    const ok = (t) => lines.push(`  ✓ ${t}`);
    const warn = (t) => lines.push(`  ⚠ ${t}`);
    const bad = (t, kur) => { fejl++; lines.push(`  ✗ ${t}${kur ? `\n    kur: ${kur}` : ""}`); };

    // 1 · roden (cwd-fælden var dagens første runde)
    ok(`rod: ${root}${process.env.CLAUDE_PROJECT_DIR ? " (CLAUDE_PROJECT_DIR)" : " (fundet opad fra cwd)"}`);
    // 2 · enabled
    const sync = config && config.sync;
    if (!config) bad("ingen .nogra/config.json ved roden", "kør /nogra:setup, eller stå i det rigtige workspace");
    else if (!sync || sync.enabled !== true) warn("sync er OFF (et valg, ikke en fejl) — `bind <endpoint>` tænder");
    else ok("sync: enabled");
    // 3 · endpoint
    const endpoint = sync && sync.endpoint ? String(sync.endpoint).replace(/\/+$/, "") : "";
    if (sync && sync.enabled === true) {
      if (!endpoint) bad("endpoint mangler", "bind <endpoint>");
      else ok(`endpoint: ${endpoint}`);
    }
    // 4 · token (metadata, aldrig værdien)
    const ti = tokenInspect();
    if (ti.ok) ok(`token: ${ti.line}`);
    else if (sync && sync.enabled === true) bad(`token: ${ti.line}`);
    else warn(`token: ${ti.line}`);
    // 5 · aud-bindingen (lokal aflæsning — 403-klassen fanget FØR himlen)
    if (ti.meta && endpoint) {
      if (ti.meta.aud && String(ti.meta.aud).replace(/\/+$/, "") !== endpoint)
        bad(`aud-mismatch: tokenet er bundet til ${ti.meta.aud}`, "mint mod DETTE endpoint, eller ret bind");
      else ok("aud: tokenet er bundet til dette endpoint");
    }
    // 6 · rolle-kohærens (D5: én krone pr. bruger)
    let dSeatMode = "";
    try { dSeatMode = readFileSync(join(dir, "mode"), "utf8").trim(); } catch {}
    const dMode = dSeatMode || (sync && sync.mode === "replace" ? "replace" : "union");
    if (ti.meta) {
      const hasReplace = (ti.meta.scopes || []).includes("memory:replace");
      if (dMode === "replace" && !hasReplace) bad("kohærens: HOME-sæde uden memory:replace-scope — replace-push får 403", "mint --home, eller sæt sædet til union");
      else if (dMode !== "replace" && hasReplace) warn("kohærens: union-sæde med replace-magt — én krone pr. bruger; flyt kronen eller mint et union-token");
      else ok(`kohærens: rolle (${dMode}) og token matcher`);
    }
    // 7 · LIVE-proben (svarer himlen DENNE hånd? 401=signatur, 403=aud/scope — authz.ts' egen lov)
    if (sync && sync.enabled === true && endpoint && ti.ok) {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 6000);
        const t0 = Date.now();
        const rawToken = process.env.NOGRA_SYNC_TOKEN ? process.env.NOGRA_SYNC_TOKEN.trim() : readFileSync(join(dir, "token"), "utf8").trim();
        const res = await fetch(`${endpoint}/sync/status`, { headers: { authorization: `Bearer ${rawToken}` }, signal: ctrl.signal });
        clearTimeout(timer);
        if (res.status === 200) {
          const d = await res.json().catch(() => ({}));
          const seats = d.seat_board ? Object.keys(d.seat_board) : [];
          ok(`himlen svarer: wm=${d.wm} · turns=${d.turns} · tavle: ${seats.length ? seats.join(", ") : "(tom)"} · ${Date.now() - t0}ms`);
        } else if (res.status === 401) bad("himlen afviser: 401 invalid_token = SIGNATUREN (eller udløb)", "mint med den rigtige signing-secret — 401 KAN kun være signatur/udløb (aud/scope giver 403)");
        else if (res.status === 403) bad("himlen afviser: 403 = aud eller scope", "se aud- og kohærens-linjerne ovenfor");
        else bad(`himlen svarer uventet: HTTP ${res.status}`);
      } catch (e) {
        bad(`himlen kan ikke nås: ${e && e.name === "AbortError" ? "timeout (6s)" : (e && e.message) || e}`, "tjek net og endpoint");
      }
    } else if (sync && sync.enabled === true) warn("live-probe sprunget over — løs token-linjen først");
    else warn("live-probe sprunget over (sync off)");
    // 8 · bounds (serverens egen måling: streng-length) + receipts-halen
    const slug = "-" + root.replace(/^\/+/, "").replace(/\//g, "-");
    const memHome = join(process.env.HOME || "", ".claude", "projects", slug, "memory");
    if (existsSync(join(memHome, "MEMORY.md"))) {
      let mb = "";
      let ub = "";
      try { mb = readFileSync(join(memHome, "MEMORY.md"), "utf8"); } catch {}
      try { ub = readFileSync(join(memHome, "USER.md"), "utf8"); } catch {}
      const over = mb.length > 3000 || ub.length > 1375;
      (over ? warn : ok)(`bounds: MEMORY ${mb.length}/3000 · USER ${ub.length}/1375${over ? " — OVER: himlen gemmer IKKE et over-budget replace; konsolidér først" : ""}`);
    } else warn("bounds: native memory ikke fundet for denne rod (ok på et tomt sæde)");
    const rec = tailReceipts(5);
    const recFails = rec.filter((r) => r.ok === false);
    if (rec.length) (recFails.length ? warn : ok)(`receipts: ${rec.length} seneste · ${recFails.length} FAIL${recFails.length ? " — " + recFails.map((r) => `${r.op}:${r.error || "?"}`).join(", ") : ""}`);
    else warn("receipts: ingen endnu");

    console.log(`doctor · ${root}`);
    for (const l of lines) console.log(l);
    console.log(fejl ? `\ndiagnose: ${fejl} FEJL — kuren står ved hver linje` : "\ndiagnose: 0 FEJL — sædet er rask (⚠ er observationer, ikke fejl)");
    receipt({ op: "doctor", ok: !fejl, fejl });
    return fejl ? 1 : 0;
  }

  if (verb === "run") {
    // The single door: pull → push in ONE call — the function you CALL. Same engine as the
    // hooks and the tick; one aggregate receipt on top of the client's own.
    const note = await syncPull(root);
    console.log(note || "pull: no changes (or sync disabled — run status)");
    const res = await syncPush(root);
    if (res.skipped) console.log(`push: skipped (${res.skipped})`);
    else if (res.error) console.log(`push: FAILED — ${res.error} (receipt logged; session state untouched)`);
    else
      console.log(
        `push: ok${res.overBudget && res.overBudget.length ? ` · OVER BUDGET: ${res.overBudget.join(" + ")} — the home should consolidate` : ""}`,
      );
    receipt({ op: "run", ok: !res.error, push: res.skipped ? `skipped:${res.skipped}` : res.error ? "FAIL" : "ok" });
    return res.error ? 1 : 0;
  }

  if (verb === "pull") {
    const note = await syncPull(root);
    console.log(note || "pull: no changes (or sync disabled — run status)");
    return 0;
  }

  if (verb === "push") {
    const res = await syncPush(root);
    if (res.skipped) console.log(`push: skipped (${res.skipped})`);
    else if (res.error) console.log(`push: FAILED — ${res.error} (receipt logged; session state untouched)`);
    else
      console.log(
        `push: ok${res.overBudget && res.overBudget.length ? ` · OVER BUDGET: ${res.overBudget.join(" + ")} — the home should consolidate` : ""}`,
      );
    return 0;
  }

  if (verb === "bind") {
    if (!config) {
      console.error("bind: Nogra is not initialized here — run /nogra:setup first.");
      return 1;
    }
    const endpoint = String(arg || "").replace(/\/+$/, "");
    if (!/^https:\/\//.test(endpoint) && !/^http:\/\/(127\.0\.0\.1|localhost)/.test(endpoint)) {
      console.error("bind: endpoint must be https:// (or loopback http for tests). Refused.");
      return 1;
    }
    config.sync = { ...(config.sync || {}), enabled: true, endpoint };
    delete config.sync.mode; // mode is seat-local (gitignored seat file), never in the shared config
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    mkdirSync(dir, { recursive: true });
    // The law "home never travels via git": token and seat file live under .nogra/memory/sync/,
    // so bind GUARANTEES the ignore entry instead of assuming the init bundle wrote it
    // (retrofit for workspaces initialized before sync existed).
    const giPath = join(root, ".nogra", ".gitignore");
    let gi = "";
    try { gi = readFileSync(giPath, "utf8"); } catch {}
    let gitignored = false;
    if (!gi.split("\n").some((l) => l.trim() === "memory/sync/")) {
      writeFileSync(giPath, gi + (gi && !gi.endsWith("\n") ? "\n" : "") + "memory/sync/\n");
      gitignored = true;
    }
    if (homeFlag) writeFileSync(join(dir, "mode"), "replace\n");
    receipt({ op: "bind", ok: true, endpoint, ...(gitignored ? { gitignored: true } : {}), ...(homeFlag ? { mode: "replace" } : {}) });
    console.log(`bind: sync enabled → ${endpoint}${homeFlag ? " [HOME seat: replace mode via seat file — requires a memory:replace token]" : ""}`);
    // S-D (16/07): bind bekræfter SIG SELV. Dagen krævede 9 manuelle tavle-bekræftelser af
    // operatøren og Fable — nu er beviset indbygget: er tokenet raskt, kører bind selv den
    // første pull (som STEMPLER tavlen) og siger sort på hvidt om sædet står i himlen.
    const ti = tokenInspect();
    if (ti.problem === "missing") {
      console.log(
        "token: MISSING — store it with YOUR OWN hand (never through the assistant):\n" +
          "  either export NOGRA_SYNC_TOKEN in your shell profile,\n" +
          "  or write it to .nogra/memory/sync/token (chmod 600; the directory is gitignored).\n" +
          "self-verify: kør `bind` igen når tokenet er placeret — så beviser sædet sig selv.",
      );
      return 0;
    }
    if (!ti.ok) {
      console.log(`token: ${ti.line}`);
      console.log("self-verify: venter — løs token-linjen og kør `bind` igen.");
      return 0;
    }
    console.log(`token: ${ti.line}`);
    const note = await syncPull(root);
    const st = readJson(join(dir, "state.json"), {});
    const you = st.you;
    const board = st.seatBoard || {};
    if (you && board[you]) {
      console.log(`self-verify: sædet '${you}' står på tavlen ✓ (set ${board[you].last_seen})`);
    } else if (note && /failed|FAIL/i.test(note)) {
      console.log(`self-verify: proben fejlede — ${note.replace(/<[^>]+>/g, "").trim()}`);
      console.log("kur: kør `doctor` for fuld diagnose (401=signatur · 403=aud/scope · tom fil=placering)");
      return 1;
    } else {
      console.log("self-verify: pull ok, men tavlen bærer ikke sædet endnu — er himlen ældre end sæde-bevidsthed? Kør `doctor`.");
    }
    return 0;
  }

  if (verb === "off") {
    if (!config) {
      console.error("off: Nogra is not initialized here — nothing to disable.");
      return 1;
    }
    config.sync = { ...(config.sync || {}), enabled: false };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    receipt({ op: "off", ok: true });
    console.log("off: sync disabled (endpoint kept; re-enable with bind)");
    return 0;
  }

  console.error(`unknown verb: ${verb} — use status | run | pull | push | doctor | bind <endpoint> | off`);
  return 1;
}

process.exit(await main());
