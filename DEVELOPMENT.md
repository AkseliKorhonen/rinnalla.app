# rinnalla.app development workflow

The root scripts are the canonical way to verify and install the project. They
print a short result summary and keep complete output under `.dev/logs/`, reducing
the amount of terminal output that needs to be reviewed or shared.

## Verify changes

Run the smallest relevant verification set while working:

```powershell
npm run verify:changed
```

Run the full suite before a commit or handoff:

```powershell
npm run verify
```

The full suite checks React/React Native renderer compatibility, Expo Doctor,
tests, both TypeScript projects, repository and web lint, and the production web
build. Checks run in parallel. If a check fails, the command prints its final
diagnostic lines and the path to its full log.

## Build and install Android

Prerequisites:

- Android Studio, its bundled JDK, and the Android SDK are installed.
- USB debugging is authorized on every target device.
- Each target device is listed by `adb devices -l`.
- The ignored local development keystore and DPAPI-encrypted password are present
  under `apps/mobile/credentials/`, or the equivalent `ANDROID_DEV_*` environment
  variables are set.
- `apps/mobile/google-services.json` is present locally.

Build one signed ARM64 release APK, verify it, install it sequentially on every
connected compatible device, launch it, and verify the installed version:

```powershell
npm run android:install-all
```

The build uses a monotonically increasing Android version code so it can update an
existing development installation. It validates the package name, embedded
JavaScript bundle, and signing certificate before installation.

For faster iteration when the existing APK has not changed:

```powershell
npm run android:install-existing
npm run android:launch-all
```

To target selected devices, call the wrapper directly:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/android-local.ps1 `
  -Action BuildInstall -DeviceSerial SERIAL_ONE,SERIAL_TWO
```

## Device smoke test

Unlock each connected device, leave rinnalla.app signed in, then run:

```powershell
npm run android:smoke
```

The smoke test launches the installed app, opens the household settings drawer,
checks the expected controls, confirms the app remains focused, and checks the
Android crash buffer. A secure PIN cannot be entered through the test; when a
device is locked, the command reports that it must be unlocked and exits without
guessing credentials.

## Continuous integration

Pull requests run the same `npm run verify` command in GitHub Actions. The Android
development release workflow reuses the repository's React compatibility,
version-code, and generated Gradle configuration scripts so local and hosted APK
builds follow the same rules.

## Logs and secrets

Generated orchestration logs live in `.dev/logs/` and are ignored by Git. Start
with the compact console summary, then open only the named failure log. Never add
keystores, signing passwords, `google-services.json`, or other credentials to a
commit.
