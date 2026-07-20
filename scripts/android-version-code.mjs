const maximumAndroidVersionCode = 2_100_000_000;
const minimumArgument = process.argv.find((argument) => argument.startsWith("--minimum="));
const minimum = minimumArgument
  ? Number.parseInt(minimumArgument.slice("--minimum=".length), 10)
  : 0;
const explicit = process.env.ANDROID_VERSION_CODE
  ? Number.parseInt(process.env.ANDROID_VERSION_CODE, 10)
  : 0;
const epochSeconds = Math.floor(Date.now() / 1_000);
const versionCode = Math.max(epochSeconds, minimum, explicit);

if (!Number.isSafeInteger(versionCode) || versionCode <= 0) {
  console.error("Could not compute a positive integer Android version code.");
  process.exit(1);
}
if (versionCode > maximumAndroidVersionCode) {
  console.error(`Android version code ${versionCode} exceeds ${maximumAndroidVersionCode}.`);
  process.exit(1);
}

process.stdout.write(String(versionCode));
