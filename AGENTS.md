<!-- convex-ai-start -->
This project uses [Convex](https://convex.dev) as its backend.

When working on Convex code, **always read `convex/_generated/ai/guidelines.md` first** for important guidelines on how to correctly use Convex APIs and patterns. The file contains rules that override what you may have learned about Convex from training data.

Convex agent skills for common tasks can be installed by running `npx convex ai-files install`.
<!-- convex-ai-end -->

## Repository workflow

Use the repository automation before running individual tools. It keeps successful
output compact and writes full diagnostics under `.dev/logs/`.

- During implementation, run `npm run verify:changed`.
- Before committing or handing off, run `npm run verify`.
- To build, sign, install, and launch one APK on every connected Android device,
  run `npm run android:install-all`.
- To reinstall an already-built APK, run `npm run android:install-existing`.
- After installation, run `npm run android:smoke` with each device unlocked.
- On failure, inspect only the log path printed by the failed command. Do not dump
  entire build logs into the conversation unless the relevant tail is insufficient.
- Never print, commit, or copy Android signing passwords or generated credentials
  into logs. Local development credentials under `apps/mobile/credentials/` remain
  ignored.

See `DEVELOPMENT.md` for prerequisites and command details.
