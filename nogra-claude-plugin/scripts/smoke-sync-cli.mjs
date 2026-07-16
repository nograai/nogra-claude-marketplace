#!/usr/bin/env node
// Smoke: sync-cli.mjs — the human handle must be honest offline.
// No network: these checks cover config handling, refusals, receipts and the
// token-silence contract. The network paths are covered by smoke-sync-client.mjs.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const cli = join(dirname(fileURLToPath(import.meta.url)), "sync-cli.mjs");
let pass = 0;
let fail = 0;

function check(name, cond) {
  if (cond) {
    pass++;
    console.log(`  ok  ${name}`);
  } else {
    fail++;
    console.log(`  FAIL ${name}`);
  }
}

function run(root, args, env = {}) {
  try {
    const out = execFileSync("node", [cli, ...args], {
      cwd: root,
      env: { ...process.env, CLAUDE_PROJECT_DIR: root, NOGRA_SYNC_TOKEN: "", ...env },
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return { code: 0, out };
  } catch (err) {
    return { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` };
  }
}

const root = mkdtempSync(join(tmpdir(), "nogra-sync-cli-"));

// 1) uninitialized workspace: status reports, bind refuses
let r = run(root, ["status"]);
check("status on uninitialized workspace reports, exit 0", r.code === 0 && /not initialized/.test(r.out));
r = run(root, ["bind", "https://example.com"]);
check("bind on uninitialized workspace refuses, exit 1", r.code === 1 && /not initialized/.test(r.out));

// 2) initialized workspace
mkdirSync(join(root, ".nogra"), { recursive: true });
writeFileSync(join(root, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke", other: { keep: true } }, null, 2));

r = run(root, ["status"]);
check("status shows off-by-default", r.code === 0 && /no \(off by default\)/.test(r.out));
check("status shows token MISSING", /MISSING/.test(r.out));

// 3) bind refusals: plain http (non-loopback), garbage
r = run(root, ["bind", "http://example.com"]);
check("bind refuses plain http, exit 1", r.code === 1 && /Refused/.test(r.out));
r = run(root, ["bind"]);
check("bind refuses empty endpoint, exit 1", r.code === 1);

// 4) bind accepts https, preserves foreign config keys, writes receipt
r = run(root, ["bind", "https://sync.example.com/"]);
check("bind https ok, trailing slash stripped", r.code === 0 && /sync enabled → https:\/\/sync\.example\.com$/m.test(r.out));
check("bind warns token MISSING with own-hand instructions", /YOUR OWN hand/.test(r.out));
let cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
check("config sync block written", cfg.sync && cfg.sync.enabled === true && cfg.sync.endpoint === "https://sync.example.com");
check("foreign config keys preserved", cfg.other && cfg.other.keep === true && cfg.workspaceId === "smoke");
const logPath = join(root, ".nogra", "memory", "sync", "log.jsonl");
check("bind left a receipt", existsSync(logPath) && /"op":"bind"/.test(readFileSync(logPath, "utf8")));
const giPath = join(root, ".nogra", ".gitignore");
check(
  "bind guarantees the memory/sync/ gitignore entry",
  existsSync(giPath) && readFileSync(giPath, "utf8").split("\n").some((l) => l.trim() === "memory/sync/"),
);
r = run(root, ["bind", "https://sync.example.com/"]);
check(
  "re-bind never duplicates the gitignore entry",
  readFileSync(giPath, "utf8").split("\n").filter((l) => l.trim() === "memory/sync/").length === 1,
);

// 5) status after bind: enabled + endpoint + receipt visible
r = run(root, ["status"]);
check("status shows enabled + endpoint", /enabled: {2}yes/.test(r.out) && /sync\.example\.com/.test(r.out));
check("status lists the bind receipt", /receipts \(last/.test(r.out) && /bind/.test(r.out));

// 6) token presence reported, value NEVER echoed
writeFileSync(join(root, ".nogra", "memory", "sync", "token"), "smoke-secret-value-9911\n");
r = run(root, ["status"]);
check("status reports token file presence", /file \.nogra\/memory\/sync\/token/.test(r.out));
check("token value never appears in output", !/smoke-secret-value-9911/.test(r.out));
r = run(root, ["status"], { NOGRA_SYNC_TOKEN: "env-secret-value-7733" });
check("env token presence wins, value silent", /env NOGRA_SYNC_TOKEN/.test(r.out) && !/env-secret-value-7733/.test(r.out));

// 7) off keeps endpoint, writes receipt; unknown verb refuses
r = run(root, ["off"]);
check("off ok", r.code === 0 && /disabled/.test(r.out));
cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
check("off keeps endpoint, disables flag", cfg.sync.enabled === false && cfg.sync.endpoint === "https://sync.example.com");
check("off left a receipt", /"op":"off"/.test(readFileSync(logPath, "utf8")));
r = run(root, ["dance"]);
check("unknown verb refuses with usage, exit 1", r.code === 1 && /unknown verb/.test(r.out));

// 8) pull/push honest while disabled (no network, no crash)
r = run(root, ["pull"]);
check("pull while disabled reports, exit 0", r.code === 0 && /disabled|no changes/.test(r.out));
r = run(root, ["push"]);
check("push while disabled reports skipped", r.code === 0 && /skipped \(disabled\)/.test(r.out));

// 9) the home seat: bind --home writes the SEAT FILE (never the shared config), status names
//    it, re-bind preserves it. The config must stay mode-free — it travels to every seat via git.
r = run(root, ["bind", "https://sync.example.com", "--home"]);
check("bind --home ok and announces the home seat", r.code === 0 && /HOME seat: replace mode/.test(r.out));
cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
const seatFile = join(root, ".nogra", "memory", "sync", "mode");
check("bind --home writes the seat file", existsSync(seatFile) && readFileSync(seatFile, "utf8").trim() === "replace");
check("shared config NEVER carries mode (it travels via git)", !("mode" in cfg.sync) && cfg.sync.enabled === true);
check("bind --home receipt carries the mode", /"mode":"replace"/.test(readFileSync(logPath, "utf8")));
r = run(root, ["status"]);
check("status names the home seat via seat file", /mode: {4,5}home \(replace/.test(r.out) && /seat file/.test(r.out));
r = run(root, ["bind", "https://sync.example.com"]);
cfg = JSON.parse(readFileSync(join(root, ".nogra", "config.json"), "utf8"));
check("re-bind without --home preserves the seat file (no accidental demotion)", readFileSync(seatFile, "utf8").trim() === "replace" && !("mode" in cfg.sync));

// 10) run — the single door is honest when disabled, and the usage names it
const runRoot = mkdtempSync(join(tmpdir(), "nogra-sync-cli-run-"));
r = run(runRoot, ["run"]);
check("run on a disabled workspace: honest no-op, exit 0", r.code === 0 && /skipped \(disabled\)/.test(r.out));
r = run(runRoot, ["definitely-bogus-verb"]);
check("usage names the run verb", r.code === 1 && /status \| run \| pull \| push/.test(r.out));
rmSync(runRoot, { recursive: true, force: true });

// 11) S-A (16/07): roden findes OPAD — og UDENFOR et workspace taler vi HØJT, aldrig stille.
//     (Fælden der bed 16/07: kørsel fra ~ gav "no changes" og lignede succes.)
const saRoot = mkdtempSync(join(tmpdir(), "nogra-sync-cli-sa-"));
mkdirSync(join(saRoot, ".nogra"), { recursive: true });
writeFileSync(join(saRoot, ".nogra", "config.json"), JSON.stringify({ sync: { enabled: false } }));
const subdir = join(saRoot, "projects", "dybt", "nede");
mkdirSync(subdir, { recursive: true });
let sa = run(saRoot, ["status"], {});
// walk-up: kør fra undermappen UDEN CLAUDE_PROJECT_DIR — roden skal findes opad
try {
  const out = execFileSync("node", [cli, "status"], {
    cwd: subdir,
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", NOGRA_SYNC_TOKEN: "" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  sa = { code: 0, out };
} catch (err) { sa = { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` }; }
check("S-A: walk-up finder roden fra en undermappe", sa.code === 0 && /enabled:/.test(sa.out));
try {
  const out = execFileSync("node", [cli, "status"], {
    cwd: tmpdir(),
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", NOGRA_SYNC_TOKEN: "" },
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  sa = { code: 0, out };
} catch (err) { sa = { code: err.status ?? 1, out: `${err.stdout || ""}${err.stderr || ""}` }; }
check("S-A: udenfor et workspace = HØJ fejl + exit 1 (aldrig stille)", sa.code === 1 && /ingen \.nogra/.test(sa.out));
rmSync(saRoot, { recursive: true, force: true });

// 12) S-B (16/07): det ærlige sæde — tomme/malformede tokens får NAVN og KUR; status viser
//     metadata (aldrig værdien), you, tavlen og rolle-kohærens. 0 bytes må ALDRIG ligne succes.
const sbRoot = mkdtempSync(join(tmpdir(), "nogra-sync-cli-sb-"));
mkdirSync(join(sbRoot, ".nogra"), { recursive: true });
writeFileSync(join(sbRoot, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke-sb" }));
run(sbRoot, ["bind", "https://sync.example.com"]);
const sbDir = join(sbRoot, ".nogra", "memory", "sync");
mkdirSync(sbDir, { recursive: true });
writeFileSync(join(sbDir, "token"), "\n"); // pastens klassiker: én ensom newline
r = run(sbRoot, ["pull"]);
check("S-B: pull med TOM token-fil fejler HØJT m/ bytes + kur, exit 1", r.code === 1 && /TOM \(1 bytes\)/.test(r.out) && /mint/.test(r.out));
check("S-B: den høje fejl efterlader en receipt", /token:empty/.test(readFileSync(join(sbDir, "log.jsonl"), "utf8")));
writeFileSync(join(sbDir, "token"), "ikke-et-token-overhovedet");
r = run(sbRoot, ["run"]);
check("S-B: run med MALFORMET token fejler højt, exit 1", r.code === 1 && /MALFORMET/.test(r.out));
// et ægte-formet (usigneret) token: metadata skal kunne AFLÆSES uden at værdien printes
const payload = Buffer.from(JSON.stringify({ sub: "patti", scopes: ["memory:read", "memory:append"], aud: "https://sync.example.com", exp: Math.floor(Date.now() / 1000) + 3600, seat: "testbænk" })).toString("base64url");
writeFileSync(join(sbDir, "token"), `nst_${payload}.deadbeef`);
r = run(sbRoot, ["status"]);
check("S-B: status viser token-METADATA (seat+scopes+exp)", /seat=testbænk/.test(r.out) && /memory:read\+memory:append/.test(r.out));
check("S-B: token-VÆRDIEN printes aldrig", !r.out.includes(payload));
check("S-B: status viser you-linjen", /you: {4,6}/.test(r.out));
// rolle-kohærens: HOME-sæde med union-token = FEJL med kur
writeFileSync(join(sbDir, "mode"), "replace\n");
r = run(sbRoot, ["status"]);
check("S-B: kohærens fanger HOME-sæde uden replace-scope (403-varsel m/ kur)", /kohærens: ⚠ FEJL/.test(r.out) && /mint --home/.test(r.out));
// udløbet token siger det selv
const oldPayload = Buffer.from(JSON.stringify({ sub: "patti", scopes: ["memory:read"], aud: "x", exp: 1 })).toString("base64url");
writeFileSync(join(sbDir, "token"), `nst_${oldPayload}.deadbeef`);
r = run(sbRoot, ["pull"]);
check("S-B: udløbet token fejler højt med UDLØBET-navn", r.code === 1 && /UDLØBET/.test(r.out));
// tavlen vises fra state.json (sidste pulls sandhed)
writeFileSync(join(sbDir, "state.json"), JSON.stringify({ you: "m3", lastPullAt: "2026-07-16T10:00:00Z", seatBoard: { huset: { last_seen: "2026-07-16T10:51:50Z", last_pushed: null, dirty: true } } }));
writeFileSync(join(sbDir, "token"), `nst_${payload}.deadbeef`);
writeFileSync(join(sbDir, "mode"), "union\n");
r = run(sbRoot, ["status"]);
check("S-B: tavlen vises fra sidste pull m/ dirty-flag", /tavlen \(pr\. sidste pull/.test(r.out) && /huset: set 2026-07-16T10:51:50Z/.test(r.out) && /dirty=true/.test(r.out));
check("S-B: you aflæses fra state", /you: {4,6}m3/.test(r.out));
rmSync(sbRoot, { recursive: true, force: true });

// 13) S-C (16/07): DOKTOREN — to-timers jagter som ét kald. Offline her: proben må aldrig
//     røre nettet i en smoke; de netløse fejlklasser dækker kontrakten.
const drRoot = mkdtempSync(join(tmpdir(), "nogra-sync-cli-dr-"));
mkdirSync(join(drRoot, ".nogra"), { recursive: true });
writeFileSync(join(drRoot, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke-dr" }));
r = run(drRoot, ["doctor"]);
check("S-C: doctor på sluttet sync = 0 FEJL, probe sprunget over (off er et valg)", r.code === 0 && /sprunget over \(sync off\)/.test(r.out) && /0 FEJL/.test(r.out));
run(drRoot, ["bind", "https://sync.example.com"]);
const drDir = join(drRoot, ".nogra", "memory", "sync");
mkdirSync(drDir, { recursive: true });
writeFileSync(join(drDir, "token"), "\n");
r = run(drRoot, ["doctor"]);
check("S-C: doctor m/ enabled + TOM token = FEJL m/ inline-kur, exit 1", r.code === 1 && /TOM/.test(r.out) && /mint og placér/.test(r.out));
// velformet token på SLUKKET sæde: metadata aflæses, værdien forlader aldrig processen
run(drRoot, ["off"]);
const drPayload = Buffer.from(JSON.stringify({ sub: "patti", scopes: ["memory:read", "memory:append", "memory:replace"], aud: "https://sync.example.com", exp: Math.floor(Date.now() / 1000) + 3600, seat: "huset" })).toString("base64url");
writeFileSync(join(drDir, "token"), `nst_${drPayload}.deadbeef`);
writeFileSync(join(drDir, "mode"), "replace\n");
r = run(drRoot, ["doctor"]);
check("S-C: doctor aflæser metadata + kohærens (home+replace matcher)", /seat=huset/.test(r.out) && /kohærens: rolle \(replace\) og token matcher/.test(r.out));
check("S-C: doctor printer ALDRIG token-værdien", !r.out.includes(drPayload));
r = run(drRoot, ["helt-galt-verb"]);
check("S-C: usage nævner doctor", r.code === 1 && /doctor/.test(r.out));
rmSync(drRoot, { recursive: true, force: true });

// 14) S-D (16/07): bind bekræfter SIG SELV — de 9 manuelle tavle-bekræftelser dør her.
//     Offline: den "døde himmel" er loopback port 9 (connection refused, øjeblikkeligt).
const sdRoot = mkdtempSync(join(tmpdir(), "nogra-sync-cli-sd-"));
mkdirSync(join(sdRoot, ".nogra"), { recursive: true });
writeFileSync(join(sdRoot, ".nogra", "config.json"), JSON.stringify({ workspaceId: "smoke-sd" }));
r = run(sdRoot, ["bind", "http://127.0.0.1:9"]);
check("S-D: bind uden token instruerer + lover self-verify ved næste bind, exit 0", r.code === 0 && /MISSING/.test(r.out) && /self-verify: kør `bind` igen/.test(r.out));
const sdDir = join(sdRoot, ".nogra", "memory", "sync");
mkdirSync(sdDir, { recursive: true });
writeFileSync(join(sdDir, "token"), "\n");
r = run(sdRoot, ["bind", "http://127.0.0.1:9"]);
check("S-D: bind m/ TOM token-fil venter ærligt m/ navngivet årsag, exit 0", r.code === 0 && /TOM/.test(r.out) && /self-verify: venter/.test(r.out));
const sdPayload = Buffer.from(JSON.stringify({ sub: "patti", scopes: ["memory:read", "memory:append"], aud: "http://127.0.0.1:9", exp: Math.floor(Date.now() / 1000) + 3600, seat: "smoke-sæde" })).toString("base64url");
writeFileSync(join(sdDir, "token"), `nst_${sdPayload}.deadbeef`);
r = run(sdRoot, ["bind", "http://127.0.0.1:9"]);
check("S-D: bind m/ raskt token prøver SELV proben — død himmel = ærlig fejl + doctor-kur, exit 1", r.code === 1 && /self-verify: proben fejlede/.test(r.out) && /doctor/.test(r.out));
rmSync(sdRoot, { recursive: true, force: true });

rmSync(root, { recursive: true, force: true });
console.log(`\nsmoke-sync-cli: ${pass} ok, ${fail} failed`);
process.exit(fail ? 1 : 0);
