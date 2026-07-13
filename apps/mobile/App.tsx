import { StatusBar } from "expo-status-bar";
import { SafeAreaView, StyleSheet, Text, View } from "react-native";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

const surfaces = ["Web", "Android", "iOS"];

export default function App() {
  return (
    <SafeAreaView style={styles.safeArea}>
      <StatusBar style="light" />
      <View style={styles.container}>
        <Text style={styles.kicker}>VAARI TABLET</Text>
        <Text style={styles.title}>One mobile shell for Android and iOS.</Text>
        <Text style={styles.body}>
          This Expo app sits beside the Next.js web app and shares the same
          Convex backend configuration.
        </Text>

        <View style={styles.row}>
          {surfaces.map((surface) => (
            <View key={surface} style={styles.card}>
              <Text style={styles.cardLabel}>{surface}</Text>
            </View>
          ))}
        </View>

        <View style={styles.statusPanel}>
          <Text style={styles.statusTitle}>Convex status</Text>
          <Text style={styles.statusText}>
            {convexUrl
              ? "Client environment is ready for Convex."
              : "Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local to connect this app."}
          </Text>
          {convexUrl ? <Text style={styles.code}>{convexUrl}</Text> : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#111111",
  },
  container: {
    flex: 1,
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: "#111111",
    justifyContent: "center",
  },
  kicker: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 3,
    marginBottom: 16,
  },
  title: {
    color: "#fafaf9",
    fontSize: 38,
    fontWeight: "700",
    lineHeight: 44,
  },
  body: {
    color: "#d6d3d1",
    fontSize: 17,
    lineHeight: 28,
    marginTop: 16,
    maxWidth: 420,
  },
  row: {
    flexDirection: "row",
    gap: 12,
    marginTop: 28,
  },
  card: {
    backgroundColor: "#1c1917",
    borderColor: "#44403c",
    borderWidth: 1,
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 16,
  },
  cardLabel: {
    color: "#fafaf9",
    fontSize: 16,
    fontWeight: "600",
  },
  statusPanel: {
    marginTop: 32,
    backgroundColor: "#052e16",
    borderColor: "#15803d",
    borderWidth: 1,
    borderRadius: 24,
    padding: 20,
  },
  statusTitle: {
    color: "#86efac",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  statusText: {
    color: "#f0fdf4",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 12,
  },
  code: {
    color: "#dcfce7",
    fontSize: 12,
    marginTop: 14,
  },
});
