const fs = require("fs");
const path = require("path");

const config = require("./app.json");
const googleServicesFile = path.join(__dirname, "google-services.json");

if (fs.existsSync(googleServicesFile)) {
  config.expo.android.googleServicesFile = "./google-services.json";
} else {
  delete config.expo.android.googleServicesFile;
  config.expo.plugins = config.expo.plugins.filter(
    (plugin) => plugin !== "@react-native-firebase/app" && plugin !== "@react-native-firebase/messaging",
  );
}

module.exports = config;
