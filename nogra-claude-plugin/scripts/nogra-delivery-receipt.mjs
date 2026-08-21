#!/usr/bin/env node

// nogra-delivery-receipt — the receipt the delivery gate requires for a house link.
// Writes ONE `delivery-receipt` ledger event for a URL, and ONLY when a fresh screenshot file
// (png/jpg/webp, < receiptWindowMinutes old) exists: the screenshot is the truth (taken in the
// operator's browser), the event is the receipt, the gate is the ritual. The screenshot is copied
// into <root>/inbox/screenshots/ when that folder exists, else <root>/.nogra/evidence/screenshots/.
//
//   node scripts/nogra-delivery-receipt.mjs <url> <screenshot-path> [note]   [--root <dir>]
// Exit: 0 ok · 64 usage · 65 screenshot missing/invalid · 66 screenshot too old · 67 loopback url.

import { copyFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import { basename, extname, join, relative, resolve } from "node:path";
import { appendReceiptEvent, findWorkspaceRoot, readGateConfig } from "../runtime/local/delivery-gate.mjs";

const args = process.argv.slice(2);
let rootArg = "";
const positional = [];
for (let i = 0; i < args.length; i += 1) {
  if (args[i] === "--root") { rootArg = args[i + 1] || ""; i += 1; } else positional.push(args[i]);
}
const [url, shot, ...noteParts] = positional;
if (!url || !shot) {
  console.error("usage: nogra-delivery-receipt <url> <screenshot-path> [note] [--root <dir>]");
  process.exit(64);
}
if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)/iu.test(url)) {
  console.error("STOP: a loopback URL is never a delivery (the operator cannot click it)");
  process.exit(67);
}
const root = findWorkspaceRoot([rootArg, process.env.CLAUDE_PROJECT_ROOT || "", process.cwd()]);
if (!root) {
  console.error("STOP: no Nogra workspace (.nogra/config.json) found");
  process.exit(64);
}
const shotPath = resolve(shot);
if (!existsSync(shotPath) || !/\.(png|jpe?g|webp)$/iu.test(shotPath)) {
  console.error(`STOP: screenshot missing or not png/jpg/webp: ${shotPath}`);
  process.exit(65);
}
const config = readGateConfig(root);
const ageMs = Date.now() - statSync(shotPath).mtimeMs;
if (ageMs > config.receiptWindowMinutes * 60 * 1000) {
  console.error(`STOP: screenshot is ${Math.round(ageMs / 1000)}s old (> ${config.receiptWindowMinutes} min) — take a fresh one in the operator's browser`);
  process.exit(66);
}
const inbox = join(root, "inbox", "screenshots");
const destDir = existsSync(join(root, "inbox")) ? inbox : join(root, ".nogra", "evidence", "screenshots");
mkdirSync(destDir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
const slug = url.replace(/^https?:\/\//iu, "").replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60);
const dest = join(destDir, `delivery-receipt-${stamp}-${slug}${extname(shotPath).toLowerCase()}`);
if (resolve(dest) !== shotPath) copyFileSync(shotPath, dest);
const event = appendReceiptEvent(root, {
  url,
  screenshot: relative(root, dest),
  note: noteParts.join(" "),
  workspaceId: config.workspaceId
});
console.log(`RECEIPT: ${url} seen in the operator's browser · ${relative(root, dest)} · ${event.createdAt} (${basename(event.eventId)})`);
