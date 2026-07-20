const fs = require("fs");
const path = require("path");

const googleServicesFile = path.join(__dirname, "google-services.json");

module.exports = ({ config }) => {
  const hasGoogleServices = fs.existsSync(googleServicesFile);
  const plugins = hasGoogleServices
    ? config.plugins
    : config.plugins.filter(
        (plugin) =>
          plugin !== "@react-native-firebase/app" &&
          plugin !== "@react-native-firebase/messaging",
      );
  const android = { ...config.android };

  if (hasGoogleServices) {
    android.googleServicesFile = "./google-services.json";
  } else {
    delete android.googleServicesFile;
  }

  return { ...config, android, plugins };
};
