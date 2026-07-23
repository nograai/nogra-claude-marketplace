// Resolve Claude Code's native Auto Memory without mutating it.
//
// Resolution order mirrors observable Claude Code configuration:
// managed settings -> explicit runtime bridge -> local settings -> project
// settings -> user settings -> SessionStart transcript identity -> Git
// repository identity -> project root. A runtime bridge is necessary for
// `--settings` and remotely delivered managed values because hook input does
// not expose the effective settings object.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  MEMORY_RESOLUTION_SCHEMA_V1,
  assertMemoryResolutionSemantics
} from "./contract-spine.mjs";

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function readJson(file) {
  try {
    const value = JSON.parse(fs.readFileSync(file, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function isInside(child, parent) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function expandConfiguredPath(value, home) {
  const configured = clean(value);
  if (!configured) return "";
  if (configured === "~") return path.resolve(home);
  if (configured.startsWith("~/")) return path.resolve(home, configured.slice(2));
  if (!path.isAbsolute(configured)) return "";
  return path.resolve(configured);
}

function uniqueFiles(entries) {
  const seen = new Set();
  return entries.filter((entry) => {
    const key = path.resolve(entry.file);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function managedSettingsPath(platform, options) {
  if (options.managedSettingsPath) return path.resolve(options.managedSettingsPath);
  if (platform === "darwin") return "/Library/Application Support/ClaudeCode/managed-settings.json";
  if (platform === "linux") return "/etc/claude-code/managed-settings.json";
  return "";
}

function gitIdentityRoot(projectDir, options) {
  if (options.identityRoot) return path.resolve(options.identityRoot);
  try {
    const common = execFileSync(
      "git",
      ["-C", projectDir, "rev-parse", "--path-format=absolute", "--git-common-dir"],
      { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }
    ).trim();
    if (common) {
      const absolute = path.resolve(common);
      if (path.basename(absolute) === ".git") return path.dirname(absolute);
      const topLevel = execFileSync(
        "git",
        ["-C", projectDir, "rev-parse", "--show-toplevel"],
        { encoding: "utf8", timeout: 1500, stdio: ["ignore", "pipe", "ignore"] }
      ).trim();
      if (topLevel) return path.resolve(topLevel);
    }
  } catch {
    // Outside Git, Claude Code uses the project root.
  }
  return path.resolve(projectDir);
}

function defaultProjectSlug(identityRoot) {
  return path.resolve(identityRoot).replace(/[\\/]/gu, "-");
}

function settingsFiles(projectDir, identityRoot, configRoot, options) {
  if (Array.isArray(options.settingsFiles)) {
    return options.settingsFiles.map((entry) => ({
      source: String(entry.source || "user-settings"),
      file: path.resolve(entry.file)
    }));
  }
  const projectSettings = path.join(projectDir, ".claude", "settings.json");
  const rootProjectSettings = path.join(identityRoot, ".claude", "settings.json");
  const projectLocal = path.join(projectDir, ".claude", "settings.local.json");
  const rootLocal = path.join(identityRoot, ".claude", "settings.local.json");
  const managed = managedSettingsPath(options.platform || process.platform, options);
  return uniqueFiles([
    { source: "user-settings", file: path.join(configRoot, "settings.json") },
    { source: "project-settings", file: projectSettings },
    ...(rootProjectSettings === projectSettings ? [] : [{ source: "project-settings", file: rootProjectSettings }]),
    { source: "local-settings", file: projectLocal },
    ...(rootLocal === projectLocal ? [] : [{ source: "local-settings", file: rootLocal }]),
    ...(managed ? [{ source: "managed-settings", file: managed }] : [])
  ]);
}

function effectiveSetting(sources, key) {
  let selected = null;
  for (const source of sources) {
    if (!source.settings || !Object.hasOwn(source.settings, key)) continue;
    selected = { source: source.source, file: source.file, value: source.settings[key] };
  }
  return selected;
}

function finish(value) {
  return assertMemoryResolutionSemantics({
    schema: MEMORY_RESOLUTION_SCHEMA_V1,
    projectDir: "",
    identityRoot: "",
    configRoot: "",
    directory: "",
    resolvedDirectory: "",
    settingsSource: "",
    autoMemoryEnabled: true,
    readOnlyResolution: true,
    warnings: [],
    ...value
  });
}

function validateResolvedDirectory(base, options = {}) {
  const directory = path.resolve(base.directory);
  let resolvedDirectory = directory;
  try {
    const stat = fs.statSync(directory);
    if (!stat.isDirectory()) {
      return finish({
        ...base,
        status: "unresolved",
        source: "invalid-settings",
        confidence: "none",
        directory,
        resolvedDirectory: "",
        warnings: [...base.warnings, "resolved native memory path exists but is not a directory"]
      });
    }
    resolvedDirectory = fs.realpathSync.native(directory);
  } catch {
    // A missing native memory directory is still a valid resolved destination.
  }

  if (options.boundaryRoot) {
    const boundary = path.resolve(options.boundaryRoot);
    let resolvedBoundary = boundary;
    try {
      resolvedBoundary = fs.realpathSync.native(boundary);
    } catch {}
    if (!isInside(resolvedDirectory, resolvedBoundary)) {
      return finish({
        ...base,
        status: "unresolved",
        source: "unsafe-symlink",
        confidence: "none",
        directory,
        resolvedDirectory: "",
        warnings: [...base.warnings, "default native memory path resolves outside its Claude-owned project boundary"]
      });
    }
  }

  return finish({
    ...base,
    status: "resolved",
    directory,
    resolvedDirectory
  });
}

export function resolveNativeMemory(options = {}) {
  const env = options.env || process.env;
  const home = path.resolve(options.home || clean(env.HOME || env.USERPROFILE) || os.homedir());
  const projectDir = path.resolve(options.projectDir || env.CLAUDE_PROJECT_DIR || process.cwd());
  const identityRoot = gitIdentityRoot(projectDir, options);
  const configRoot = path.resolve(
    expandConfiguredPath(options.configRoot || env.CLAUDE_CONFIG_DIR || path.join(home, ".claude"), home)
      || path.join(home, ".claude")
  );
  const loadedSources = settingsFiles(projectDir, identityRoot, configRoot, options).map((entry) => ({
    ...entry,
    settings: readJson(entry.file)
  }));
  const enabledSetting = effectiveSetting(loadedSources, "autoMemoryEnabled");
  const directorySetting = effectiveSetting(loadedSources, "autoMemoryDirectory");
  const disabledByEnvironment = String(env.CLAUDE_CODE_DISABLE_AUTO_MEMORY || "") === "1";
  const disabledBySettings = enabledSetting?.value === false;
  const common = {
    projectDir,
    identityRoot,
    configRoot,
    directory: "",
    resolvedDirectory: "",
    settingsSource: enabledSetting?.file || "",
    autoMemoryEnabled: !(disabledByEnvironment || disabledBySettings),
    readOnlyResolution: true,
    warnings: []
  };

  if (disabledByEnvironment || disabledBySettings) {
    return finish({
      ...common,
      status: "disabled",
      source: disabledByEnvironment ? "disabled-environment" : "disabled-settings",
      confidence: "exact",
      autoMemoryEnabled: false
    });
  }

  const managedDirectory = directorySetting?.source === "managed-settings" ? directorySetting : null;
  const runtimeOverride = clean(options.memoryDir || env.NOGRA_NATIVE_MEMORY_DIR || "");
  const selectedDirectory = managedDirectory || (
    runtimeOverride
      ? { source: "runtime-override", file: "env:NOGRA_NATIVE_MEMORY_DIR", value: runtimeOverride }
      : directorySetting
  );

  if (selectedDirectory) {
    const directory = expandConfiguredPath(selectedDirectory.value, home);
    if (!directory) {
      return finish({
        ...common,
        status: "unresolved",
        source: "invalid-settings",
        confidence: "none",
        settingsSource: selectedDirectory.file,
        warnings: ["autoMemoryDirectory must be an absolute path or begin with ~/"]
      });
    }
    return validateResolvedDirectory({
      ...common,
      directory,
      source: selectedDirectory.source,
      confidence: "configured",
      settingsSource: selectedDirectory.file
    });
  }

  const transcriptPath = clean(options.transcriptPath || options.hookInput?.transcript_path || "");
  if (transcriptPath && path.isAbsolute(transcriptPath) && path.extname(transcriptPath) === ".jsonl") {
    const transcriptProject = path.dirname(path.resolve(transcriptPath));
    return validateResolvedDirectory(
      {
        ...common,
        directory: path.join(transcriptProject, "memory"),
        source: "transcript-project",
        confidence: "exact",
        settingsSource: ""
      },
      { boundaryRoot: transcriptProject }
    );
  }

  const gitBacked = identityRoot !== projectDir || fs.existsSync(path.join(identityRoot, ".git"));
  const projectsRoot = path.join(configRoot, "projects");
  return validateResolvedDirectory(
    {
      ...common,
      directory: path.join(projectsRoot, defaultProjectSlug(identityRoot), "memory"),
      source: gitBacked ? "git-repository" : "project-root",
      confidence: "derived",
      settingsSource: ""
    },
    { boundaryRoot: projectsRoot }
  );
}

export function readNativeMemory(resolution = resolveNativeMemory()) {
  const dir = typeof resolution === "string" ? path.resolve(resolution) : resolution.resolvedDirectory;
  if (!dir || (typeof resolution === "object" && resolution.status !== "resolved") || !fs.existsSync(dir)) {
    return { dir: dir || "", exists: false, files: [], totalChars: 0, byType: {} };
  }
  const types = ["user", "feedback", "project", "reference"];
  const typeOf = (name) => {
    if (name === "MEMORY.md") return "index";
    const match = name.match(/^([a-z]+)[-_]/u);
    return match && types.includes(match[1]) ? match[1] : "other";
  };
  const files = fs.readdirSync(dir)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const content = fs.readFileSync(path.join(dir, file), "utf8");
      return { name: file, type: typeOf(file), chars: content.length };
    })
    .sort((left, right) => right.chars - left.chars);
  const totalChars = files.reduce((sum, file) => sum + file.chars, 0);
  const byType = {};
  for (const file of files) byType[file.type] = (byType[file.type] || 0) + file.chars;
  return { dir, exists: true, files, totalChars, byType };
}
