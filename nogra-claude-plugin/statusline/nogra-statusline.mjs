#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function asNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function readJsonFile(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return null;
  }
}

function findNograConfig(startDir) {
  let current = path.resolve(startDir || process.cwd());

  while (true) {
    const candidate = path.join(current, ".nogra", "config.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function formatTokens(value) {
  const number = Math.max(0, Math.round(asNumber(value, 0)));

  if (number >= 1_000_000) {
    return `${(number / 1_000_000).toFixed(1)}M`;
  }
  if (number >= 100_000) {
    return `${Math.round(number / 1_000)}k`;
  }
  if (number >= 10_000) {
    return `${Math.round(number / 1_000)}k`;
  }
  if (number >= 1_000) {
    const rounded = number / 1_000;
    return `${rounded < 10 ? rounded.toFixed(1) : Math.round(rounded)}k`;
  }

  return String(number);
}

function buildBar(percentage, width = 20) {
  const bounded = Math.max(0, Math.min(100, Math.round(asNumber(percentage, 0))));
  const filled = Math.max(0, Math.min(width, Math.round((bounded / 100) * width)));
  return `${"█".repeat(filled)}${" ".repeat(width - filled)}`;
}

function boundedPercent(value, fallback = 50, step = 1) {
  const bounded = Math.max(0, Math.min(100, asNumber(value, fallback)));
  const safeStep = Math.max(1, Math.min(100, Math.round(asNumber(step, 1))));
  return Math.max(0, Math.min(100, Math.round(bounded / safeStep) * safeStep));
}

function sensitivityStep(policy) {
  return Math.max(1, Math.min(100, Math.round(asNumber(policy?.sensitivityStepPercent, 5))));
}

function sensitivityFromAutoThreshold(value, step = 5) {
  return boundedPercent((95 - asNumber(value, 60)) / 0.7, 50, step);
}

function sensitivityPercent(policy) {
  const step = sensitivityStep(policy);
  if (Number.isFinite(policy?.sensitivityPercent)) {
    return boundedPercent(policy.sensitivityPercent, 50, step);
  }
  return sensitivityFromAutoThreshold(policy?.autoOfferThreshold, step);
}

function sensitivityBar(percentage, width = 12) {
  const bounded = boundedPercent(percentage);
  const filled = Math.max(0, Math.min(width, Math.round((bounded / 100) * width)));
  return `${"+".repeat(filled)}${"-".repeat(width - filled)}`;
}

function cleanLabel(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }
  const cleaned = value.trim().replace(/\s+/g, " ");
  return cleaned || fallback;
}

const TERMINAL_TRANSPORT_STATUSES = new Set(["ok", "partial", "blocked", "failed", "cancelled"]);

function workspaceRootFromConfig(configPath) {
  return path.dirname(path.dirname(configPath));
}

function readTransportRuns(root) {
  const runsDir = path.join(root, ".nogra", "transport", "runs");
  try {
    return fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => {
        const file = path.join(runsDir, entry.name);
        const record = readJsonFile(file);
        if (!record || typeof record !== "object") {
          return null;
        }
        let mtimeMs = 0;
        try {
          mtimeMs = fs.statSync(file).mtimeMs;
        } catch {
          mtimeMs = 0;
        }
        return { ...record, __mtimeMs: mtimeMs };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function dateMs(value) {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function runSortMs(record) {
  return Math.max(dateMs(record.updatedAt), dateMs(record.completedAt), dateMs(record.createdAt), asNumber(record.__mtimeMs, 0));
}

function runStatus(record) {
  return cleanLabel(record?.status, "").toLowerCase();
}

function isActiveTransportRun(record) {
  const status = runStatus(record);
  return Boolean(status) && !TERMINAL_TRANSPORT_STATUSES.has(status);
}

function shortRunId(runId) {
  const cleaned = cleanLabel(runId, "");
  const parts = cleaned.split("-").filter(Boolean);
  const suffix = parts[parts.length - 1] || cleaned;
  return suffix.length <= 12 ? suffix : suffix.slice(-8);
}

function formatElapsed(seconds) {
  const safeSeconds = Math.max(0, Math.floor(asNumber(seconds, 0)));
  if (safeSeconds < 60) {
    return `${safeSeconds}s`;
  }
  const minutes = Math.floor(safeSeconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return remainingMinutes ? `${hours}h${remainingMinutes}m` : `${hours}h`;
}

function activeRunSegment(root) {
  const activeRuns = readTransportRuns(root)
    .filter(isActiveTransportRun)
    .sort((a, b) => runSortMs(b) - runSortMs(a));

  if (!activeRuns.length) {
    return "";
  }

  const run = activeRuns[0];
  const status = runStatus(run);
  const phase = cleanLabel(run.phase, "").toLowerCase();
  const state = phase && phase !== status ? `${status}/${phase}` : status;
  const startMs = dateMs(run.createdAt) || dateMs(run.updatedAt) || runSortMs(run);
  const elapsed = startMs ? formatElapsed((Date.now() - startMs) / 1000) : "";
  const extra = activeRuns.length > 1 ? ` +${activeRuns.length - 1}` : "";

  return [`Run ${shortRunId(run.runId)}`, state, elapsed].filter(Boolean).join(" ") + extra;
}

function runtimeLabel(config) {
  const runtime = config?.runtimePolicy && typeof config.runtimePolicy === "object" ? config.runtimePolicy : {};
  const roles = runtime.roles && typeof runtime.roles === "object" ? runtime.roles : {};
  const agent = roles.agent && typeof roles.agent === "object" ? roles.agent : {};
  const budget = runtime.budget && typeof runtime.budget === "object" ? runtime.budget : {};
  const profile = cleanLabel(runtime.profile, "");
  const agentModel = cleanLabel(agent.model, "");
  const agentEffort = cleanLabel(agent.effort, "");
  const budgetMode = cleanLabel(budget.mode, "");

  const parts = [];
  if (profile) parts.push(`Profile ${profile}`);
  if (agentModel || agentEffort) parts.push(`Agent ${[agentModel, agentEffort].filter(Boolean).join("/")}`);
  if (budgetMode) parts.push(`Budget ${budgetMode}`);
  return parts.join(" | ");
}

function contextUsage(contextWindow) {
  const size = Math.max(1, asNumber(contextWindow?.context_window_size, 200_000));
  const usedPercentage = Math.max(0, Math.min(100, asNumber(contextWindow?.used_percentage, 0)));

  let used = asNumber(contextWindow?.total_input_tokens, 0) + asNumber(contextWindow?.total_output_tokens, 0);

  if (used <= 0 && contextWindow?.current_usage) {
    used =
      asNumber(contextWindow.current_usage.input_tokens, 0) +
      asNumber(contextWindow.current_usage.cache_creation_input_tokens, 0) +
      asNumber(contextWindow.current_usage.cache_read_input_tokens, 0) +
      asNumber(contextWindow.current_usage.output_tokens, 0);
  }

  if (used <= 0 && usedPercentage > 0) {
    used = Math.round((usedPercentage / 100) * size);
  }

  return {
    size,
    used,
    usedPercentage,
  };
}

function nograSegment(session) {
  const startDir = session?.workspace?.current_dir || session?.cwd || process.cwd();
  const configPath = findNograConfig(startDir);
  if (!configPath) {
    return "";
  }

  const config = readJsonFile(configPath);
  if (!config) {
    return "Nogra ?";
  }

  const policy = config.routingPolicy && typeof config.routingPolicy === "object" ? config.routingPolicy : {};
  const enabled = policy.autoOfferEnabled !== false && policy.enabled !== false;
  const sensitivity = sensitivityPercent(policy);
  const runtime = runtimeLabel(config);
  const activeRun = activeRunSegment(workspaceRootFromConfig(configPath));
  const base = `Nogra Auto ${enabled ? "ON" : "OFF"} | Nogra Sensitivity ${sensitivity}% 0% ${sensitivityBar(sensitivity)} 100%`;

  return [base, activeRun, runtime].filter(Boolean).join(" | ");
}

function main() {
  const input = fs.readFileSync(0, "utf8");
  const session = input.trim() ? JSON.parse(input) : {};
  const model = session?.model?.display_name || "Claude";
  const { size, used, usedPercentage } = contextUsage(session?.context_window || {});
  const bar = buildBar(usedPercentage);
  const nogra = nograSegment(session);

  const segments = [
    model,
    nogra,
    `[${bar}] ${Math.round(usedPercentage)}%`,
    `${formatTokens(used)}/${formatTokens(size)} tokens`,
  ].filter(Boolean);

  process.stdout.write(`${segments.join(" | ")}\n`);
}

try {
  main();
} catch (error) {
  process.stdout.write(`Claude | statusline error: ${error instanceof Error ? error.message : "unknown"}\n`);
}
