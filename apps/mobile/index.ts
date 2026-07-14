import { registerRootComponent } from 'expo';
import { installBackgroundCallNotificationHandler } from "./call-notifications";

import App from './App';

if (process.env.EXPO_PUBLIC_DIRECT_FCM_ENABLED === "true") {
  installBackgroundCallNotificationHandler();
}

// registerRootComponent calls AppRegistry.registerComponent('main', () => App);
// It also ensures that whether you load the app in Expo Go or in a native build,
// the environment is set up appropriately
registerRootComponent(App);
