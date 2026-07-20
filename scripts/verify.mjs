import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const mode = process.argv.includes("--changed") ? "changed" : "all";
const timestamp = new Date().toISOString().replaceAll(":", "-");
const logDirectory = path.join(repositoryRoot, ".dev", "logs", "verify", timestamp);
mkdirSync(logDirectory, { recursive: true });

const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const npmCli = process.env.npm_execpath;

function npmInvocation(args) {
  return npmCli
    ? { command: process.execPath, args: [npmCli, ...args] }
    : { command: npm, args };
}

function npxInvocation(args) {
  return npmCli
    ? { command: process.execPath, args: [npmCli, "exec", "--", ...args] }
    : { command: npx, args };
}

function changedFiles() {
  const tracked = spawnSync("git", ["diff", "--name-only", "HEAD"], {
    cwd: repositoryRoot,
    encoding: "utf8",
  });
  const untracked = spawnSync(
    "git",
    ["ls-files", "--others", "--exclude-standard"],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  if (tracked.status !== 0 || untracked.status !== 0) {
    throw new Error("Could not determine changed files with Git.");
  }
  return [...tracked.stdout.split(/\r?\n/), ...untracked.stdout.split(/\r?\n/)]
    .map((file) => file.trim().replaceAll("\\", "/"))
    .filter(Boolean);
}

const allTasks = {
  androidIdentity: {
    command: process.execPath,
    args: [path.join("scripts", "check-android-identity.mjs")],
    label: "Android identity",
  },
  compatibility: {
    command: process.execPath,
    args: [path.join("scripts", "check-react-native-versions.mjs")],
    label: "React compatibility",
  },
  tests: { ...npmInvocation(["test"]), label: "Tests" },
  mobileTypecheck: {
    ...npxInvocation(["tsc", "--noEmit", "-p", "apps/mobile/tsconfig.json"]),
    label: "Mobile typecheck",
  },
  mobileDoctor: {
    ...npmInvocation(["run", "doctor:mobile"]),
    label: "Expo Doctor",
  },
  webTypecheck: {
    ...npxInvocation(["tsc", "--noEmit", "-p", "apps/web/tsconfig.json"]),
    label: "Web typecheck",
  },
  codeLint: { ...npmInvocation(["run", "lint:code"]), label: "Code lint" },
  webLint: { ...npmInvocation(["run", "lint:web"]), label: "Web lint" },
  webBuild: { ...npmInvocation(["run", "build:web"]), label: "Web build" },
};

function selectTasks() {
  if (mode === "all") return Object.values(allTasks);

  const files = changedFiles();
  const selected = new Set(["androidIdentity", "compatibility"]);
  const affectsEverything = files.some(
    (file) =>
      file === "package.json"
      || file === "package-lock.json"
      || file === "eslint.config.mjs"
      || file === "vitest.config.ts"
      || file.startsWith("scripts/"),
  );

  if (affectsEverything || files.some((file) => file.startsWith("convex/"))) {
    selected.add("tests");
    selected.add("codeLint");
  }
  if (affectsEverything || files.some((file) => file.startsWith("apps/mobile/"))) {
    selected.add("mobileTypecheck");
    selected.add("mobileDoctor");
    selected.add("codeLint");
  }
  if (affectsEverything || files.some((file) => file.startsWith("apps/web/"))) {
    selected.add("webTypecheck");
    selected.add("webLint");
    selected.add("webBuild");
  }

  return [...selected].map((taskName) => allTasks[taskName]);
}

function runTask(task) {
  const slug = task.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-");
  const logPath = path.join(logDirectory, `${slug}.log`);
  const log = createWriteStream(logPath, { flags: "w" });
  const startedAt = Date.now();

  return new Promise((resolve) => {
    const child = spawn(task.command, task.args, {
      cwd: repositoryRoot,
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
      shell: process.platform === "win32" && /\.(?:cmd|bat)$/i.test(task.command),
      windowsHide: true,
    });
    child.stdout.pipe(log, { end: false });
    child.stderr.pipe(log, { end: false });
    child.on("error", (error) => {
      log.write(`${error.stack ?? error.message}\n`);
    });
    child.on("close", (code) => {
      log.end();
      resolve({
        ...task,
        code: code ?? 1,
        durationSeconds: ((Date.now() - startedAt) / 1_000).toFixed(1),
        logPath,
      });
    });
  });
}

const tasks = selectTasks();
console.log(`[run] ${mode} verification (${tasks.length} checks)`);
const results = await Promise.all(tasks.map(runTask));
let failed = false;

for (const result of results) {
  const status = result.code === 0 ? "ok" : "fail";
  console.log(`[${status}] ${result.label} (${result.durationSeconds}s)`);
  if (result.code !== 0) {
    failed = true;
    const lines = readFileSync(result.logPath, "utf8").trimEnd().split(/\r?\n/);
    console.error(lines.slice(-35).join("\n"));
    console.error(`[log] ${path.relative(repositoryRoot, result.logPath)}`);
  }
}

console.log(`[logs] ${path.relative(repositoryRoot, logDirectory)}`);
if (failed) process.exit(1);
