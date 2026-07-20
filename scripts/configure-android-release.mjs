import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "..");
const buildFile = path.join(
  repositoryRoot,
  "apps",
  "mobile",
  "android",
  "app",
  "build.gradle",
);
const markerPattern = /\/\/ rinnalla\.app (?:local )?development release configuration/;

if (!existsSync(buildFile)) {
  console.error(`Android build file does not exist: ${buildFile}`);
  process.exit(1);
}

const contents = readFileSync(buildFile, "utf8");
if (markerPattern.test(contents)) {
  console.log("[ok] Android development release signing is configured.");
  process.exit(0);
}

const releaseConfiguration = `

// rinnalla.app development release configuration
android {
    defaultConfig {
        versionCode Integer.parseInt(System.getenv("ANDROID_VERSION_CODE"))
    }
    signingConfigs {
        development {
            storeFile file(System.getenv("ANDROID_DEV_KEYSTORE_PATH"))
            storePassword System.getenv("ANDROID_DEV_KEYSTORE_PASSWORD")
            keyAlias System.getenv("ANDROID_DEV_KEY_ALIAS")
            keyPassword System.getenv("ANDROID_DEV_KEY_PASSWORD")
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.development
        }
    }
}
`;

writeFileSync(buildFile, contents + releaseConfiguration, "utf8");
console.log("[ok] Added Android development release signing configuration.");
