import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  ConvexReactClient,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { useEffect, useState } from "react";
import { FamilyCallPanel } from "./family-call-panel";
import { registerIncomingCallNotifications } from "./call-notifications";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

const tokenStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

type AuthScreen = "signIn" | "signUp" | "resetRequest" | "resetVerify";

function getErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function Button({
  label,
  onPress,
  secondary = false,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  secondary?: boolean;
  disabled?: boolean;
}) {
  return (
    <Pressable
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondaryButton : styles.primaryButton,
        pressed && !disabled ? styles.buttonPressed : null,
        disabled ? styles.buttonDisabled : null,
      ]}
    >
      <Text style={secondary ? styles.secondaryButtonText : styles.primaryButtonText}>
        {label}
      </Text>
    </Pressable>
  );
}

function AuthPanel() {
  const { signIn } = useAuthActions();
  const [screen, setScreen] = useState<AuthScreen>("signIn");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === null) return;
    const timeout = setTimeout(() => setStatus(null), 4_000);
    return () => clearTimeout(timeout);
  }, [status]);

  const submitCredentials = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await signIn("password", {
        email,
        flow: screen === "signUp" ? "signUp" : "signIn",
        password,
        ...(screen === "signUp" ? { name: displayName } : {}),
      });
      if (result.signingIn) {
        setStatus(screen === "signUp" ? "Account created." : "Signed in.");
      }
    } catch (error) {
      setStatus(getErrorMessage(error, "Authentication failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const requestReset = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      await signIn("password", { email, flow: "reset" });
      setScreen("resetVerify");
      setStatus("If an account matches that email, we sent a reset code.");
    } catch {
      setStatus("We could not start the password reset. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyReset = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await signIn("password", {
        code: resetCode,
        email,
        flow: "reset-verification",
        newPassword: password,
      });
      setPassword("");
      setResetCode("");
      setScreen("signIn");
      setStatus(result.signingIn ? "Password reset. You are signed in." : "Password reset. Please sign in.");
    } catch (error) {
      setStatus(getErrorMessage(error, "That reset code could not be verified."));
    } finally {
      setSubmitting(false);
    }
  };

  const isReset = screen === "resetRequest" || screen === "resetVerify";
  const submit =
    screen === "resetRequest"
      ? requestReset
      : screen === "resetVerify"
        ? verifyReset
        : submitCredentials;

  return (
    <ScrollView contentContainerStyle={styles.authContent} keyboardShouldPersistTaps="handled">
      <Text style={styles.kicker}>RINNALLA.APP</Text>
      <Text style={styles.title}>
        {isReset ? "Reset your password" : "Stay close, even from afar."}
      </Text>
      <Text style={styles.body}>
        {screen === "resetVerify"
          ? "Enter the code from your email and choose a new password."
          : isReset
            ? "Enter your email and we will send a reset code."
            : "A simple place for families to see who is available and connect face to face."}
      </Text>

      {!isReset ? (
        <View style={styles.segmentedControl}>
          <Pressable onPress={() => setScreen("signIn")} style={[styles.segment, screen === "signIn" && styles.segmentSelected]}>
            <Text style={screen === "signIn" ? styles.segmentSelectedText : styles.segmentText}>Sign in</Text>
          </Pressable>
          <Pressable onPress={() => setScreen("signUp")} style={[styles.segment, screen === "signUp" && styles.segmentSelected]}>
            <Text style={screen === "signUp" ? styles.segmentSelectedText : styles.segmentText}>Create account</Text>
          </Pressable>
        </View>
      ) : null}

      <View style={styles.form}>
        {screen === "signUp" ? <>
          <Text style={styles.label}>Your name</Text>
          <TextInput autoComplete="name" onChangeText={setDisplayName} placeholder="How should your family see you?" placeholderTextColor="#78716c" style={styles.input} value={displayName} />
        </> : null}
        <Text style={styles.label}>Email</Text>
        <TextInput
          autoCapitalize="none"
          autoComplete="email"
          keyboardType="email-address"
          onChangeText={setEmail}
          placeholder="you@example.com"
          placeholderTextColor="#78716c"
          style={styles.input}
          value={email}
        />

        {screen === "resetVerify" ? (
          <>
            <Text style={styles.label}>Reset code</Text>
            <TextInput
              autoComplete="one-time-code"
              keyboardType="number-pad"
              onChangeText={setResetCode}
              placeholder="12345678"
              placeholderTextColor="#78716c"
              style={styles.input}
              value={resetCode}
            />
          </>
        ) : null}

        {screen !== "resetRequest" ? (
          <>
            <Text style={styles.label}>{screen === "resetVerify" ? "New password" : "Password"}</Text>
            <TextInput
              autoComplete={screen === "signIn" ? "current-password" : "new-password"}
              onChangeText={setPassword}
              placeholder="At least 8 characters"
              placeholderTextColor="#78716c"
              secureTextEntry
              style={styles.input}
              value={password}
            />
          </>
        ) : null}

        <Button
          disabled={submitting || !email || (screen === "signUp" && displayName.trim().length < 2) || (screen !== "resetRequest" && !password) || (screen === "resetVerify" && !resetCode)}
          label={submitting ? "Working..." : screen === "signUp" ? "Create account" : screen === "resetRequest" ? "Send reset code" : screen === "resetVerify" ? "Reset password" : "Sign in"}
          onPress={() => void submit()}
        />

        {screen === "signIn" ? <Button label="Forgot password?" onPress={() => setScreen("resetRequest")} secondary /> : null}
        {isReset ? <Button label="Back to sign in" onPress={() => setScreen("signIn")} secondary /> : null}
      </View>
      {status ? <View style={styles.toast}><Text style={styles.toastText}>{status}</Text></View> : null}
    </ScrollView>
  );
}

function FamilyHome() {
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const families = useQuery(api.families.listMy, isAuthenticated ? {} : "skip");
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const [selectedFamilyId, setSelectedFamilyId] = useState<Id<"families"> | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === null) return;
    const timeout = setTimeout(() => setStatus(null), 4_000);
    return () => clearTimeout(timeout);
  }, [status]);
  const createFamily = useMutation(api.families.create);
  const joinFamily = useMutation(api.families.join);
  const regenerateInviteCode = useMutation(api.families.regenerateInviteCode);
  const removeMember = useMutation(api.families.removeMember);
  const leaveFamily = useMutation(api.families.leave);
  const updateName = useMutation(api.users.updateName);
  const registerPushToken = useMutation(api.pushTokens.register);

  const activeFamilyId = families?.some((family) => family._id === selectedFamilyId)
    ? selectedFamilyId
    : families?.[0]?._id ?? null;
  const dashboard = useQuery(api.families.dashboard, activeFamilyId ? { familyId: activeFamilyId } : "skip");

  useEffect(() => {
    if (process.env.EXPO_PUBLIC_DIRECT_FCM_ENABLED !== "true") return;
    let cleanup: (() => void) | undefined;
    void registerIncomingCallNotifications(registerPushToken).then((unsubscribe) => { cleanup = unsubscribe; }).catch(() => undefined);
    return () => cleanup?.();
  }, [registerPushToken]);

  const perform = async (operation: () => Promise<void>, success: string) => {
    setSubmitting(true);
    setStatus(null);
    try {
      await operation();
      setStatus(success);
    } catch (error) {
      setStatus(getErrorMessage(error, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  };

  const currentMember = dashboard?.members.find((member) => member.userId === dashboard.currentUserId);

  return (
    <ScrollView contentContainerStyle={styles.homeContent}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.kicker}>RINNALLA.APP</Text>
          <Text style={styles.homeTitle}>{dashboard?.family.name ?? "Your families"}</Text>
          <Text style={styles.panelText}>{user?.name ?? user?.email ?? ""}</Text>
        </View>
        <Pressable onPress={() => void signOut()}><Text style={styles.link}>Sign out</Text></Pressable>
      </View>

      {families === undefined ? <ActivityIndicator color="#fbbf24" size="large" /> : families.length === 0 ? (
        <View style={styles.panel}>
          <Text style={styles.label}>Your name</Text>
          <TextInput onChangeText={setDisplayName} placeholder={user?.name ?? "How should your family see you?"} placeholderTextColor="#78716c" style={styles.input} value={displayName} />
          <Button disabled={submitting || displayName.trim().length < 2} label="Save your name" onPress={() => void perform(() => updateName({ name: displayName }).then(() => { setDisplayName(""); }), "Your name has been updated.")} secondary />
          <Text style={styles.panelTitle}>Connect your family</Text>
          <Text style={styles.panelText}>Create a household or join one with an invite code.</Text>
          <Text style={styles.label}>Family name</Text>
          <TextInput onChangeText={setFamilyName} placeholder="Korhonen family" placeholderTextColor="#78716c" style={styles.input} value={familyName} />
          <Button disabled={submitting || !familyName.trim()} label="Create family" onPress={() => void perform(async () => { await createFamily({ name: familyName }); setFamilyName(""); }, "Family created.")} />
          <Text style={styles.or}>or</Text>
          <Text style={styles.label}>Invite code</Text>
          <TextInput autoCapitalize="characters" onChangeText={setInviteCode} placeholder="ABC123" placeholderTextColor="#78716c" style={styles.input} value={inviteCode} />
          <Button disabled={submitting || !inviteCode.trim()} label="Join family" onPress={() => void perform(async () => { await joinFamily({ inviteCode }); setInviteCode(""); }, "Joined family.")} secondary />
        </View>
      ) : (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.familyTabs}>
            {families.map((family) => (
              <Pressable key={family._id} onPress={() => setSelectedFamilyId(family._id)} style={[styles.familyTab, family._id === activeFamilyId && styles.familyTabSelected]}>
                <Text style={family._id === activeFamilyId ? styles.familyTabSelectedText : styles.familyTabText}>{family.name}</Text>
              </Pressable>
            ))}
          </ScrollView>

          {dashboard ? <>
            <FamilyCallPanel
              currentUserId={dashboard.currentUserId}
              familyId={dashboard.family._id}
              members={dashboard.members}
            />
            <View style={styles.panel}>
              <View style={styles.panelHeader}>
                <View>
                  <Text style={styles.panelTitle}>Family members</Text>
                  <Text style={styles.panelText}>Everyone in this household can be called.</Text>
                </View>
                <Text style={styles.inviteCode}>{dashboard.family.inviteCode}</Text>
              </View>
              {dashboard.members.map((member) => (
                <View key={member.userId} style={styles.member}>
                  <View style={styles.memberIdentity}>
                    <View>
                      <Text style={styles.memberName}>{member.name ?? member.email ?? "Family member"}</Text>
                      <Text style={styles.memberDetail}>{member.email ?? "No email available"}</Text>
                    </View>
                  </View>
                  <Text style={styles.role}>{member.role}</Text>
                  {currentMember?.role === "owner" && member.userId !== dashboard.currentUserId ? <Pressable disabled={submitting} onPress={() => void perform(() => removeMember({ familyId: dashboard.family._id, userId: member.userId }).then(() => undefined), "Family member removed.")}><Text style={styles.remove}>Remove</Text></Pressable> : null}
                </View>
              ))}
              {currentMember?.role === "owner" ? <Button disabled={submitting} label="Generate new invite code" onPress={() => void perform(async () => { const code = await regenerateInviteCode({ familyId: dashboard.family._id }); setStatus(`New invite code: ${code}`); }, "Invite code updated.")} secondary /> : <Button disabled={submitting} label="Leave family" onPress={() => void perform(() => leaveFamily({ familyId: dashboard.family._id }).then(() => undefined), "You left the family.")} secondary />}
            </View>
          </> : <ActivityIndicator color="#fbbf24" size="large" />}
        </>
      )}
      {status ? <View style={styles.toast}><Text style={styles.toastText}>{status}</Text></View> : null}
    </ScrollView>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <View style={styles.loading}><ActivityIndicator color="#fbbf24" size="large" /></View>;
  return isAuthenticated ? <FamilyHome /> : <AuthPanel />;
}

export default function App() {
  if (!convex) {
    return <SafeAreaView style={styles.safeArea}><StatusBar style="light" /><View style={styles.loading}><Text style={styles.title}>Connect rinnalla.app</Text><Text style={styles.body}>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local.</Text></View></SafeAreaView>;
  }
  return <SafeAreaView style={styles.safeArea}><StatusBar style="light" /><ConvexAuthProvider client={convex} storage={tokenStorage}><AppContent /></ConvexAuthProvider></SafeAreaView>;
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: "#111111" },
  loading: { flex: 1, justifyContent: "center", padding: 24, backgroundColor: "#111111" },
  authContent: { flexGrow: 1, justifyContent: "center", padding: 24, backgroundColor: "#111111" },
  homeContent: { gap: 16, padding: 20, paddingBottom: 40, backgroundColor: "#111111" },
  kicker: { color: "#fbbf24", fontSize: 12, fontWeight: "700", letterSpacing: 3, marginBottom: 12 },
  title: { color: "#fafaf9", fontSize: 36, fontWeight: "700", lineHeight: 42 },
  homeTitle: { color: "#fafaf9", fontSize: 28, fontWeight: "700", maxWidth: 260 },
  body: { color: "#d6d3d1", fontSize: 16, lineHeight: 24, marginTop: 14 },
  segmentedControl: { flexDirection: "row", gap: 8, marginTop: 28 },
  segment: { borderColor: "#44403c", borderRadius: 18, borderWidth: 1, paddingHorizontal: 16, paddingVertical: 10 },
  segmentSelected: { backgroundColor: "#fbbf24", borderColor: "#fbbf24" },
  segmentText: { color: "#d6d3d1", fontWeight: "600" },
  segmentSelectedText: { color: "#1c1917", fontWeight: "700" },
  form: { gap: 10, marginTop: 24 },
  label: { color: "#d6d3d1", fontSize: 14, fontWeight: "600", marginTop: 8 },
  input: { backgroundColor: "#0c0a09", borderColor: "#44403c", borderRadius: 16, borderWidth: 1, color: "#fafaf9", fontSize: 16, paddingHorizontal: 16, paddingVertical: 14 },
  button: { alignItems: "center", borderRadius: 16, marginTop: 10, paddingHorizontal: 16, paddingVertical: 15 },
  primaryButton: { backgroundColor: "#fbbf24" }, secondaryButton: { borderColor: "#57534e", borderWidth: 1 },
  primaryButtonText: { color: "#1c1917", fontSize: 16, fontWeight: "700" }, secondaryButtonText: { color: "#f5f5f4", fontSize: 16, fontWeight: "600" },
  buttonPressed: { opacity: 0.82 }, buttonDisabled: { opacity: 0.5 }, toast: { alignSelf: "center", backgroundColor: "#292524", borderColor: "#fbbf24", borderRadius: 16, borderWidth: 1, bottom: 18, left: 20, paddingHorizontal: 16, paddingVertical: 12, position: "absolute", right: 20, shadowColor: "#000", shadowOpacity: 0.35, shadowRadius: 12, zIndex: 10 }, toastText: { color: "#fef3c7", fontSize: 14, lineHeight: 20, textAlign: "center" },
  headerRow: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between" }, link: { color: "#fcd34d", fontWeight: "600", paddingTop: 18 },
  panel: { backgroundColor: "#1c1917", borderColor: "#44403c", borderRadius: 24, borderWidth: 1, padding: 18 },
  panelTitle: { color: "#fafaf9", fontSize: 20, fontWeight: "700" }, panelText: { color: "#d6d3d1", fontSize: 14, lineHeight: 20, marginTop: 6 },
  or: { color: "#a8a29e", marginTop: 12, textAlign: "center" }, familyTabs: { flexGrow: 0 }, familyTab: { borderColor: "#44403c", borderRadius: 18, borderWidth: 1, marginRight: 8, paddingHorizontal: 14, paddingVertical: 10 }, familyTabSelected: { backgroundColor: "#fbbf24", borderColor: "#fbbf24" }, familyTabText: { color: "#d6d3d1", fontWeight: "600" }, familyTabSelectedText: { color: "#1c1917", fontWeight: "700" },
  panelHeader: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", marginBottom: 12 }, inviteCode: { color: "#fcd34d", fontFamily: "monospace", fontSize: 16, fontWeight: "700" },
  member: { borderTopColor: "#44403c", borderTopWidth: 1, gap: 8, paddingVertical: 14 }, memberIdentity: { flexDirection: "row", gap: 10 }, memberName: { color: "#fafaf9", fontSize: 16, fontWeight: "600" }, memberDetail: { color: "#a8a29e", fontSize: 13, marginTop: 2 }, role: { color: "#d6d3d1", fontSize: 12, textTransform: "uppercase" }, remove: { color: "#fda4af", fontSize: 13, fontWeight: "700" },
});
