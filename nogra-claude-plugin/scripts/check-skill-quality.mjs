#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const pluginRoot = path.resolve(path.dirname(__filename), "..");
const skillsRoot = path.join(pluginRoot, "skills");

function fail(message) {
  console.error(`skill-quality: FAIL: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`skill-quality: ok: ${message}`);
}

function read(relativePath) {
  return fs.readFileSync(path.join(pluginRoot, relativePath), "utf8");
}

function parseFrontmatter(text, relativePath) {
  const lines = text.split(/\r?\n/);
  if (lines[0] !== "---") {
    fail(`${relativePath} missing YAML frontmatter`);
  }
  const end = lines.indexOf("---", 1);
  if (end === -1) {
    fail(`${relativePath} frontmatter is not closed`);
  }
  const frontmatter = {};
  for (const line of lines.slice(1, end)) {
    if (!line.trim()) continue;
    const match = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!match) {
      fail(`${relativePath} has unsupported frontmatter line: ${line}`);
    }
    frontmatter[match[1]] = match[2].trim();
  }
  return { frontmatter, body: lines.slice(end + 1).join("\n") };
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function referencedMarkdown(text) {
  const refs = new Set();
  const patterns = [
    /`(references\/[^`]+?\.md)`/g,
    /\((references\/[^)]+?\.md)\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      refs.add(match[1]);
    }
  }
  return [...refs].sort();
}

function validateSkillDirectory(skillName) {
  const relativePath = path.join("skills", skillName, "SKILL.md");
  const text = read(relativePath);
  const { frontmatter, body } = parseFrontmatter(text, relativePath);
  const keys = Object.keys(frontmatter).sort();
  const expectedKeys = skillName === "transcript-diagnostic"
    ? ["description", "disable-model-invocation", "name"]
    : ["description", "name"];

  assert(JSON.stringify(keys) === JSON.stringify(expectedKeys), `${relativePath} frontmatter contains an unsupported field set`);
  assert(frontmatter.name === `nogra-${skillName}`, `${relativePath} name must be nogra-${skillName}`);
  if (skillName === "transcript-diagnostic") {
    assert(frontmatter["disable-model-invocation"] === "true", `${relativePath} must be user-only`);
  }
  assert(/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(frontmatter.name), `${relativePath} name must be lowercase hyphen-case`);
  assert(/\bUse (when|after|only when)\b/.test(frontmatter.description), `${relativePath} description must describe trigger conditions`);
  assert(frontmatter.description.length <= 360, `${relativePath} description is too long for trigger metadata`);
  assert(body.split(/\r?\n/).length <= 500, `${relativePath} body should stay under 500 lines and use references for details`);

  for (const ref of referencedMarkdown(text)) {
    assert(fs.existsSync(path.join(pluginRoot, "skills", skillName, ref)), `${relativePath} references missing file: ${ref}`);
  }
}

function requireText(relativePath, needle, message) {
  const text = read(relativePath);
  assert(text.includes(needle), message || `${relativePath} missing required text: ${needle}`);
}

const skillNames = fs.readdirSync(skillsRoot)
  .filter((entry) => fs.existsSync(path.join(skillsRoot, entry, "SKILL.md")))
  .sort();

assert(skillNames.length >= 8, "expected public Nogra skill set");
for (const skillName of skillNames) {
  validateSkillDirectory(skillName);
}
ok(`validated ${skillNames.length} skill entrypoints`);

for (const [skillName, ref] of [
  ["setup", "references/gotchas.md"],
  ["brief", "references/gotchas.md"],
  ["dispatch", "references/dispatch-gotchas.md"],
  ["verify", "references/evidence-gotchas.md"],
]) {
  assert(fs.existsSync(path.join(skillsRoot, skillName, ref)), `${skillName} must keep a gotchas reference at ${ref}`);
}
ok("risky skills keep gotchas references");

requireText("skills/setup/SKILL.md", "references/gotchas.md", "setup skill should point to setup gotchas");
requireText("skills/brief/SKILL.md", "references/gotchas.md", "brief skill should point to brief gotchas");
requireText("skills/dispatch/SKILL.md", "references/dispatch-gotchas.md", "dispatch skill should point to dispatch gotchas");
requireText("skills/verify/SKILL.md", "references/evidence-gotchas.md", "verify skill should point to evidence gotchas");
requireText("skills/help/SKILL.md", "references/router.md", "help skill should use the router reference");
ok("progressive disclosure references are discoverable");

requireText("skills/setup/SKILL.md", "Ask for explicit GO before writing files", "setup must require explicit GO before writes");
requireText("skills/brief/SKILL.md", "Nogra is pull-first", "brief must preserve pull-first boundary");
requireText("skills/brief/SKILL.md", "do not call the Nogra runtime", "brief must not call runtime before explicit Nogra intent");
requireText("skills/dispatch/SKILL.md", "Executor self-report is never verdict evidence", "dispatch must keep independent evidence rule");
requireText("skills/verify/SKILL.md", "Executor self-report is never verdict evidence", "verify must keep independent evidence rule");
requireText("hooks/hooks.json", "\"SessionStart\"", "hook config must keep lifecycle hooks explicit");
requireText("hooks/hooks.json", "\"PreToolUse\"", "hook config must keep action guard explicit");
requireText("runtime/local/convergence-guard.mjs", "git", "convergence guard should preserve hard risk boundaries");
requireText("skills/transcript-diagnostic/SKILL.md", "authority: none", "transcript diagnostic must stay non-authoritative");
requireText("skills/transcript-diagnostic/SKILL.md", "Never invoke this skill automatically", "transcript diagnostic must stay explicit");
ok("critical Nogra boundaries are present");

console.log("skill-quality: PASS");
