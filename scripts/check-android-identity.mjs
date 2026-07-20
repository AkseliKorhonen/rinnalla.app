import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");

function read(relativePath) {
  return readFileSync(path.join(repositoryRoot, relativePath), "utf8");
}

function capture(relativePath, pattern, description) {
  const match = pattern.exec(read(relativePath));
  if (!match) {
    throw new Error(`Could not read ${description} from ${relativePath}.`);
  }
  return match[1];
}

const appConfig = JSON.parse(read("apps/mobile/app.json"));
const packageName = appConfig.expo?.android?.package;
if (typeof packageName !== "string" || !packageName.includes(".")) {
  throw new Error("apps/mobile/app.json does not define a valid Android package.");
}

const configuredPackages = new Map([
  [
    ".github/workflows/publish-development-apk.yml",
    capture(
      ".github/workflows/publish-development-apk.yml",
      /^\s*ANDROID_PACKAGE_NAME:\s*([^\s]+)\s*$/m,
      "workflow Android package",
    ),
  ],
  [
    "scripts/android-local.ps1",
    capture(
      "scripts/android-local.ps1",
      /^\$PackageName\s*=\s*"([^"]+)"\s*$/m,
      "local Android package",
    ),
  ],
  [
    "scripts/android-smoke.ps1",
    capture(
      "scripts/android-smoke.ps1",
      /\[string\]\$PackageName\s*=\s*"([^"]+)"/,
      "smoke-test Android package",
    ),
  ],
]);

for (const [relativePath, configuredPackage] of configuredPackages) {
  if (configuredPackage !== packageName) {
    throw new Error(
      `${relativePath} uses ${configuredPackage}; expected ${packageName}.`,
    );
  }
}

const callLaunchExtra = `${packageName}.extra.CALL_LAUNCH_TOKEN`;
for (const relativePath of [
  "apps/mobile/plugins/with-call-lock-screen.js",
  "patches/react-native-callkeep+4.3.16.patch",
]) {
  if (!read(relativePath).includes(callLaunchExtra)) {
    throw new Error(`${relativePath} does not use ${callLaunchExtra}.`);
  }
}

const googleServicesPath = path.join(
  repositoryRoot,
  "apps",
  "mobile",
  "google-services.json",
);
if (existsSync(googleServicesPath)) {
  const googleServices = JSON.parse(readFileSync(googleServicesPath, "utf8"));
  const firebasePackages = (googleServices.client ?? []).map(
    (client) => client.client_info?.android_client_info?.package_name,
  );
  if (!firebasePackages.includes(packageName)) {
    throw new Error(
      `apps/mobile/google-services.json has no client for ${packageName}.`,
    );
  }
}

console.log(`Android identity is consistent: ${packageName}`);
