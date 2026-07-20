import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const mobileRequire = createRequire(
  path.join(repositoryRoot, "apps", "mobile", "package.json"),
);

function readPackage(packageName) {
  const packagePath = mobileRequire.resolve(`${packageName}/package.json`);
  return JSON.parse(readFileSync(packagePath, "utf8"));
}

const reactVersion = readPackage("react").version;
const reactDomVersion = readPackage("react-dom").version;
const reactNativePackagePath = mobileRequire.resolve("react-native/package.json");
const reactNativeRoot = path.dirname(reactNativePackagePath);
const rendererSource = readFileSync(
  path.join(
    reactNativeRoot,
    "Libraries",
    "Renderer",
    "implementations",
    "ReactNativeRenderer-prod.js",
  ),
  "utf8",
);
const rendererVersionMatch = rendererSource.match(
  /react-native-renderer:\s+([0-9]+\.[0-9]+\.[0-9]+)/,
);

if (!rendererVersionMatch) {
  console.error("[fail] Could not determine the React Native renderer version.");
  process.exit(1);
}

const rendererVersion = rendererVersionMatch[1];
const mismatches = [];

if (reactVersion !== rendererVersion) {
  mismatches.push(`react ${reactVersion} != react-native-renderer ${rendererVersion}`);
}
if (reactDomVersion !== reactVersion) {
  mismatches.push(`react-dom ${reactDomVersion} != react ${reactVersion}`);
}

if (mismatches.length > 0) {
  console.error(`[fail] Mobile React compatibility: ${mismatches.join("; ")}`);
  process.exit(1);
}

console.log(
  `[ok] Mobile React compatibility: react/react-dom/react-native-renderer ${reactVersion}`,
);
