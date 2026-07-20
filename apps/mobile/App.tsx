import { ConvexAuthProvider, useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { File, UploadType } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as SecureStore from "expo-secure-store";
import { StatusBar } from "expo-status-bar";
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Keyboard,
  KeyboardAvoidingView,
  Pressable,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import {
  ConvexReactClient,
  useAction,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { FamilyCallPanel } from "./family-call-panel";
import { MemberAvatar } from "./member-avatar";
import { ResponsiveDrawer } from "./responsive-drawer";
import { useResponsiveLayout } from "./responsive-layout";
import { uploadProfileImageFile } from "./profile-image-upload";
import { registerIncomingCallNotifications } from "./call-notifications";
import {
  getAutoAnswerCallsEnabled,
  getDeviceId,
  setAutoAnswerCallsEnabled,
  setCallNotificationsEnabled,
} from "./device-identity";
import {
  forceClearCallAppLockScreenVisibility,
  getCallAppLockScreenVisibility,
  initializeNativeCallService,
  subscribeToCallAppLockScreenVisibility,
} from "./native-call-service";
import {
  DEFAULT_SENIOR_MODE_SETTINGS,
  availableSeniorModeMembers,
  toggleSeniorModeMember,
  type SeniorModeSettings,
} from "./senior-mode-settings";
import {
  getSeniorModeSettings,
  setSeniorModeSettings,
} from "./senior-mode-storage";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
const REGISTRATION_CLEANUP_TIMEOUT_MS = 3_000;
const REGISTRATION_RETRY_MAX_MS = 60_000;

async function waitForPromisesWithTimeout(
  promises: Promise<unknown>[],
  timeoutMs: number,
) {
  if (promises.length === 0) return true;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<false>((resolve) => {
    timeout = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    return await Promise.race([
      Promise.allSettled(promises).then(() => true as const),
      timedOut,
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

const tokenStorage = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  removeItem: (key: string) => SecureStore.deleteItemAsync(key),
  setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
};

const convex = convexUrl ? new ConvexReactClient(convexUrl) : null;

type AuthScreen = "signIn" | "signUp" | "verifyEmail" | "resetRequest" | "resetVerify";

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
      accessibilityRole="button"
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
  const insets = useSafeAreaInsets();
  const { isCompactLandscape, isLandscape, isTablet } = useResponsiveLayout();
  const [screen, setScreen] = useState<AuthScreen>("signIn");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [resetCode, setResetCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (status === null) return;
    const timeout = setTimeout(() => setStatus(null), 4_000);
    return () => clearTimeout(timeout);
  }, [status]);

  const submitCredentials = async () => {
    Keyboard.dismiss();
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
      } else {
        setPassword("");
        setEmailVerificationCode("");
        setScreen("verifyEmail");
        setStatus(
          screen === "signUp"
            ? "Account created. Enter the verification code from your email."
            : "Enter the verification code we sent to your email.",
        );
      }
    } catch (error) {
      setStatus(getErrorMessage(error, "Authentication failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const verifyEmail = async () => {
    Keyboard.dismiss();
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await signIn("password", {
        code: emailVerificationCode,
        email,
        flow: "email-verification",
      });
      if (!result.signingIn) {
        throw new Error("That verification code could not be verified.");
      }
      setEmailVerificationCode("");
      setStatus("Email verified. You are signed in.");
    } catch (error) {
      setStatus(getErrorMessage(error, "That verification code could not be verified."));
    } finally {
      setSubmitting(false);
    }
  };

  const resendEmailVerification = async () => {
    Keyboard.dismiss();
    setSubmitting(true);
    setStatus(null);
    try {
      await signIn("password", { email, flow: "email-verification" });
      setEmailVerificationCode("");
      setStatus("We sent a new verification code to your email.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Could not send a new verification code."));
    } finally {
      setSubmitting(false);
    }
  };

  const requestReset = async () => {
    Keyboard.dismiss();
    setSubmitting(true);
    setStatus(null);
    try {
      await signIn("password", { email, flow: "reset" });
      setPassword("");
      setScreen("resetVerify");
      setStatus("If an account matches that email, we sent a reset code.");
    } catch {
      setStatus("We could not start the password reset. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const verifyReset = async () => {
    Keyboard.dismiss();
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
  const isVerifyingEmail = screen === "verifyEmail";
  const submit =
    isVerifyingEmail
      ? verifyEmail
      : screen === "resetRequest"
      ? requestReset
      : screen === "resetVerify"
        ? verifyReset
        : submitCredentials;
  const requiresPassword = screen === "signIn" || screen === "signUp" || screen === "resetVerify";
  const submitDisabled =
    submitting
    || !email
    || (screen === "signUp" && displayName.trim().length < 2)
    || (requiresPassword && !password)
    || (screen === "resetVerify" && !resetCode)
    || (isVerifyingEmail && emailVerificationCode.length !== 8);

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={[
            styles.authContent,
            isTablet && styles.authContentTablet,
            isCompactLandscape && styles.authContentCompactLandscape,
            {
              paddingBottom: Math.max(insets.bottom + 24, 32),
              paddingTop: isCompactLandscape ? 16 : 28,
            },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View
            style={[
              styles.authCard,
              isTablet && isLandscape && styles.authCardWide,
            ]}
          >
            <View style={styles.authIntro}>
              <Text style={styles.kicker}>RINNALLA.APP</Text>
              <Text
                accessibilityRole="header"
                style={[styles.title, isCompactLandscape && styles.titleCompact]}
              >
                {isVerifyingEmail ? "Verify your email" : isReset ? "Reset your password" : "Stay close, even from afar."}
              </Text>
              <Text style={styles.body}>
                {isVerifyingEmail
                  ? `Enter the eight-digit code sent to ${email}. The code expires in 15 minutes.`
                  : screen === "resetVerify"
                  ? "Enter the code from your email and choose a new password."
                  : isReset
                    ? "Enter your email and we will send a reset code."
                    : "A simple place for families to see who is available and connect face to face."}
              </Text>
            </View>

            <View style={styles.authControls}>
              {!isReset && !isVerifyingEmail ? (
                <View style={styles.segmentedControl}>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: screen === "signIn" }}
                    onPress={() => setScreen("signIn")}
                    style={[styles.segment, screen === "signIn" && styles.segmentSelected]}
                  >
                    <Text style={screen === "signIn" ? styles.segmentSelectedText : styles.segmentText}>Sign in</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="tab"
                    accessibilityState={{ selected: screen === "signUp" }}
                    onPress={() => setScreen("signUp")}
                    style={[styles.segment, screen === "signUp" && styles.segmentSelected]}
                  >
                    <Text style={screen === "signUp" ? styles.segmentSelectedText : styles.segmentText}>Create account</Text>
                  </Pressable>
                </View>
              ) : null}

              <View style={styles.form}>
                {screen === "signUp" ? <>
                  <Text style={styles.label}>Your name</Text>
                  <TextInput accessibilityLabel="Your name" autoComplete="name" onChangeText={setDisplayName} placeholder="How should your family see you?" placeholderTextColor="#78716c" style={styles.input} value={displayName} />
                </> : null}
                <Text style={styles.label}>Email</Text>
                <TextInput
                  accessibilityLabel="Email"
                  autoCapitalize="none"
                  autoComplete="email"
                  editable={!isVerifyingEmail}
                  keyboardType="email-address"
                  onChangeText={setEmail}
                  placeholder="you@example.com"
                  placeholderTextColor="#78716c"
                  style={styles.input}
                  value={email}
                />

                {screen === "resetVerify" || isVerifyingEmail ? (
                  <>
                    <Text style={styles.label}>{isVerifyingEmail ? "Verification code" : "Reset code"}</Text>
                    <TextInput
                      accessibilityLabel={isVerifyingEmail ? "Verification code" : "Reset code"}
                      autoComplete="one-time-code"
                      keyboardType="number-pad"
                      maxLength={8}
                      onChangeText={(value) => {
                        const code = value.replace(/\D/g, "");
                        if (isVerifyingEmail) setEmailVerificationCode(code);
                        else setResetCode(code);
                      }}
                      placeholder="12345678"
                      placeholderTextColor="#78716c"
                      style={styles.input}
                      value={isVerifyingEmail ? emailVerificationCode : resetCode}
                    />
                  </>
                ) : null}

                {screen !== "resetRequest" && !isVerifyingEmail ? (
                  <>
                    <Text style={styles.label}>{screen === "resetVerify" ? "New password" : "Password"}</Text>
                    <TextInput
                      accessibilityLabel={screen === "resetVerify" ? "New password" : "Password"}
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
                  disabled={submitDisabled}
                  label={submitting ? "Working..." : screen === "signUp" ? "Create account" : isVerifyingEmail ? "Verify email" : screen === "resetRequest" ? "Send reset code" : screen === "resetVerify" ? "Reset password" : "Sign in"}
                  onPress={() => void submit()}
                />

                {screen === "signIn" ? <Button label="Forgot password?" onPress={() => { setPassword(""); setScreen("resetRequest"); }} secondary /> : null}
                {isVerifyingEmail ? <Button disabled={submitting} label="Send a new code" onPress={() => void resendEmailVerification()} secondary /> : null}
                {isReset || isVerifyingEmail ? <Button label="Back to sign in" onPress={() => { setEmailVerificationCode(""); setResetCode(""); setScreen("signIn"); }} secondary /> : null}
              </View>
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
      {status ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[styles.toast, { bottom: Math.max(insets.bottom + 12, 18) }]}
        >
          <Text style={styles.toastText}>{status}</Text>
        </View>
      ) : null}
    </View>
  );
}

function FamilyHome() {
  const { signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const insets = useSafeAreaInsets();
  const { isCompactLandscape, isWide } = useResponsiveLayout();
  const families = useQuery(api.families.listMy, isAuthenticated ? {} : "skip");
  const user = useQuery(api.users.current, isAuthenticated ? {} : "skip");
  const [selectedFamilyId, setSelectedFamilyId] = useState<Id<"families"> | null>(null);
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pendingIncomingFamilyId, setPendingIncomingFamilyId] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [householdMenuOpen, setHouseholdMenuOpen] = useState(false);
  const [callSurfaceVisible, setCallSurfaceVisible] = useState(false);
  const [autoAnswerCalls, setAutoAnswerCalls] = useState(false);
  const [autoAnswerCallsLoaded, setAutoAnswerCallsLoaded] = useState(false);
  const [autoAnswerCallsSaving, setAutoAnswerCallsSaving] = useState(false);
  const [seniorModeSettings, setSeniorModeSettingsState] =
    useState<SeniorModeSettings>({ ...DEFAULT_SENIOR_MODE_SETTINGS });
  const [seniorModeLoaded, setSeniorModeLoaded] = useState(false);
  const [seniorModeSaving, setSeniorModeSaving] = useState(false);
  const [callFamilyId, setCallFamilyId] = useState<Id<"families"> | null>(null);
  const [notificationRegistrationEpoch, setNotificationRegistrationEpoch] = useState(0);
  const activeNotificationListenersRef = useRef(new Set<() => void>());
  const notificationRegistrationsRef = useRef(new Set<Promise<() => void>>());
  const pushTokenRegistrationsRef = useRef(new Set<Promise<unknown>>());
  const callSurfaceVisibleRef = useRef(false);
  const callFamilyResetTimeoutRef =
    useRef<ReturnType<typeof setTimeout> | null>(null);
  const signingOutRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (callFamilyResetTimeoutRef.current) {
        clearTimeout(callFamilyResetTimeoutRef.current);
      }
    };
  }, []);

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
  const generateProfileImageUploadUrl = useMutation(
    api.users.generateProfileImageUploadUrl,
  );
  const updateProfileImage = useAction(
    api.profileImageActions.updateProfileImage,
  );
  const removeProfileImage = useMutation(api.users.removeProfileImage);
  const registerPushToken = useMutation(api.pushTokens.register);
  const unregisterPushDevice = useMutation(api.pushTokens.unregisterDevice);
  const registerPushTokenForDevice = useCallback((args: {
    deviceId: string;
    platform: "android" | "ios";
    token: string;
  }) => {
    if (signingOutRef.current) return Promise.resolve(null);
    const operation = registerPushToken(args);
    pushTokenRegistrationsRef.current.add(operation);
    void operation.then(
      () => { pushTokenRegistrationsRef.current.delete(operation); },
      () => { pushTokenRegistrationsRef.current.delete(operation); },
    );
    return operation;
  }, [registerPushToken]);

  useEffect(() => {
    let cancelled = false;
    void getDeviceId()
      .then((nextDeviceId) => {
        if (!cancelled) setDeviceId(nextDeviceId);
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(getErrorMessage(error, "Could not prepare this device for calls."));
        }
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const userId = user?._id;
    let cancelled = false;
    setAutoAnswerCalls(false);
    setAutoAnswerCallsLoaded(false);
    if (!userId) return () => { cancelled = true; };

    void getAutoAnswerCallsEnabled(userId)
      .then((enabled) => {
        if (!cancelled) {
          setAutoAnswerCalls(enabled);
          setAutoAnswerCallsLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setAutoAnswerCallsLoaded(true);
          setStatus(getErrorMessage(error, "Could not load call settings."));
        }
      });
    return () => { cancelled = true; };
  }, [user?._id]);

  useEffect(() => {
    const userId = user?._id;
    let cancelled = false;
    setSeniorModeSettingsState({ ...DEFAULT_SENIOR_MODE_SETTINGS });
    setSeniorModeLoaded(false);
    if (!userId) return () => { cancelled = true; };

    void getSeniorModeSettings(userId)
      .then((settings) => {
        if (!cancelled) {
          setSeniorModeSettingsState(settings);
          if (settings.familyId) {
            setSelectedFamilyId(settings.familyId as Id<"families">);
          }
          setSeniorModeLoaded(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSeniorModeLoaded(true);
          setStatus(getErrorMessage(error, "Could not load Senior mode settings."));
        }
      });
    return () => { cancelled = true; };
  }, [user?._id]);

  const configuredSeniorFamilyId =
    seniorModeSettings.enabled
    && families?.some((family) => family._id === seniorModeSettings.familyId)
      ? seniorModeSettings.familyId as Id<"families">
      : null;
  const activeFamilyId = families?.some((family) => family._id === callFamilyId)
    ? callFamilyId
    : configuredSeniorFamilyId
      ?? (families?.some((family) => family._id === selectedFamilyId)
        ? selectedFamilyId
        : families?.[0]?._id ?? null);
  const selectFamilyForIncomingCall = useCallback((familyId?: string) => {
    if (!familyId) return;
    if (callFamilyResetTimeoutRef.current) {
      clearTimeout(callFamilyResetTimeoutRef.current);
    }
    callFamilyResetTimeoutRef.current = setTimeout(() => {
      callFamilyResetTimeoutRef.current = null;
      if (!callSurfaceVisibleRef.current) setCallFamilyId(null);
    }, 15_000);
    const family = families?.find((candidate) => candidate._id === familyId);
    if (family) {
      setPendingIncomingFamilyId(null);
      setCallFamilyId(family._id);
    } else {
      setPendingIncomingFamilyId(familyId);
    }
  }, [families]);

  useEffect(() => {
    if (!pendingIncomingFamilyId || families === undefined) return;
    const family = families.find((candidate) => candidate._id === pendingIncomingFamilyId);
    setPendingIncomingFamilyId(null);
    if (family) setCallFamilyId(family._id);
  }, [families, pendingIncomingFamilyId]);
  const dashboard = useQuery(api.families.dashboard, activeFamilyId ? { familyId: activeFamilyId } : "skip");

  useEffect(() => {
    if (
      process.env.EXPO_PUBLIC_DIRECT_FCM_ENABLED !== "true" ||
      deviceId === null ||
      signingOutRef.current
    ) return;
    const notificationDeviceId = deviceId;
    let cancelled = false;
    let cleanup: (() => void) | undefined;
    let failedAttempts = 0;
    let retryTimeout: ReturnType<typeof setTimeout> | undefined;

    function scheduleRetry() {
      if (cancelled || signingOutRef.current || retryTimeout) return;
      const delay = Math.min(
        REGISTRATION_RETRY_MAX_MS,
        1_000 * (2 ** Math.min(failedAttempts, 6)),
      );
      failedAttempts += 1;
      retryTimeout = setTimeout(() => {
        retryTimeout = undefined;
        attemptRegistration();
      }, delay);
    }

    function attemptRegistration() {
      if (cancelled || signingOutRef.current) return;
      const registration = registerIncomingCallNotifications(
        registerPushTokenForDevice,
        selectFamilyForIncomingCall,
        notificationDeviceId,
        () => !cancelled && !signingOutRef.current,
      );
      notificationRegistrationsRef.current.add(registration);
      void registration
        .then((unsubscribe) => {
          failedAttempts = 0;
          if (cancelled || signingOutRef.current) {
            unsubscribe();
          } else {
            let stopped = false;
            const stop = () => {
              if (stopped) return;
              stopped = true;
              activeNotificationListenersRef.current.delete(stop);
              unsubscribe();
            };
            cleanup = stop;
            activeNotificationListenersRef.current.add(stop);
          }
        })
        .catch(() => {
          scheduleRetry();
        })
        .finally(() => {
          notificationRegistrationsRef.current.delete(registration);
        });
    }

    attemptRegistration();
    return () => {
      cancelled = true;
      if (retryTimeout) clearTimeout(retryTimeout);
      if (cleanup) {
        cleanup();
      }
    };
  }, [
    deviceId,
    notificationRegistrationEpoch,
    registerPushTokenForDevice,
    selectFamilyForIncomingCall,
  ]);

  const signOutFromDevice = async () => {
    if (signingOutRef.current) return;
    Keyboard.dismiss();
    signingOutRef.current = true;
    setSubmitting(true);
    const cleanupDeadline = Date.now() + REGISTRATION_CLEANUP_TIMEOUT_MS;
    const waitForCleanup = (promises: Promise<unknown>[]) =>
      waitForPromisesWithTimeout(
        promises,
        Math.max(0, cleanupDeadline - Date.now()),
      );
    let unregisterOperation: Promise<unknown> | null = null;
    let unregisterSettled = true;

    try {
      // Disable delivery locally first so already-queued pushes cannot open a
      // call surface after the user has chosen to sign out.
      await waitForCleanup([setCallNotificationsEnabled(false)]);
      for (const unsubscribe of [...activeNotificationListenersRef.current]) {
        activeNotificationListenersRef.current.delete(unsubscribe);
        try { unsubscribe(); } catch { /* Best effort. */ }
      }
      await waitForCleanup([
        ...notificationRegistrationsRef.current,
        ...pushTokenRegistrationsRef.current,
      ]);
      unregisterOperation = (async () => {
        const currentDeviceId = deviceId ?? await getDeviceId();
        return await unregisterPushDevice({ deviceId: currentDeviceId });
      })();
      unregisterSettled = await waitForCleanup([unregisterOperation]);
      await waitForCleanup([setCallNotificationsEnabled(false)]);
    } finally {
      let signedOut = false;
      try {
        await signOut();
        signedOut = true;
      } catch (error) {
        setStatus(getErrorMessage(error, "Could not sign out."));
      } finally {
        // A successful sign-out unmounts this authenticated view. If it fails,
        // allow the user to retry instead of leaving the button disabled.
        if (!signedOut) {
          signingOutRef.current = false;
          setSubmitting(false);
          setNotificationRegistrationEpoch((epoch) => epoch + 1);
          if (!unregisterSettled && unregisterOperation) {
            void unregisterOperation.then(
              () => {
                if (mountedRef.current && !signingOutRef.current) {
                  setNotificationRegistrationEpoch((epoch) => epoch + 1);
                }
              },
              () => {
                if (mountedRef.current && !signingOutRef.current) {
                  setNotificationRegistrationEpoch((epoch) => epoch + 1);
                }
              },
            );
          }
        }
      }
    }
  };

  const perform = async (operation: () => Promise<void>, success?: string) => {
    Keyboard.dismiss();
    setSubmitting(true);
    setStatus(null);
    try {
      await operation();
      if (success) setStatus(success);
    } catch (error) {
      setStatus(getErrorMessage(error, "Something went wrong."));
    } finally {
      setSubmitting(false);
    }
  };

  const closeHouseholdMenu = useCallback(() => {
    Keyboard.dismiss();
    setHouseholdMenuOpen(false);
  }, []);

  const handleCallSurfaceChange = useCallback((visible: boolean) => {
    if (visible && callFamilyResetTimeoutRef.current) {
      clearTimeout(callFamilyResetTimeoutRef.current);
      callFamilyResetTimeoutRef.current = null;
    }
    if (!visible && callSurfaceVisibleRef.current) {
      setCallFamilyId(null);
    }
    callSurfaceVisibleRef.current = visible;
    setCallSurfaceVisible(visible);
    if (visible) closeHouseholdMenu();
  }, [closeHouseholdMenu]);

  useEffect(() => {
    if (!seniorModeSettings.enabled) return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => true,
    );
    return () => subscription.remove();
  }, [seniorModeSettings.enabled]);

  const changeAutoAnswerCalls = async (enabled: boolean) => {
    if (!user?._id || autoAnswerCallsSaving) return;
    const previous = autoAnswerCalls;
    setAutoAnswerCalls(enabled);
    setAutoAnswerCallsSaving(true);
    setStatus(null);
    try {
      await setAutoAnswerCallsEnabled(user._id, enabled);
      setStatus(
        enabled
          ? "After 10 seconds of ringing, callers can choose automatic answering while rinnalla.app is open."
          : "Automatic call answering is off.",
      );
    } catch (error) {
      setAutoAnswerCalls(previous);
      setStatus(getErrorMessage(error, "Could not update call settings."));
    } finally {
      setAutoAnswerCallsSaving(false);
    }
  };

  const changeSeniorModeMember = async (memberId: Id<"users">) => {
    if (!user?._id || !activeFamilyId || seniorModeSaving) return;
    const previous = seniorModeSettings;
    const currentMemberIds = previous.familyId === activeFamilyId
      ? previous.memberIds
      : [];
    const next: SeniorModeSettings = {
      enabled: false,
      familyId: activeFamilyId,
      memberIds: toggleSeniorModeMember(currentMemberIds, memberId),
    };
    setSeniorModeSettingsState(next);
    setSeniorModeSaving(true);
    setStatus(null);
    try {
      await setSeniorModeSettings(user._id, next);
    } catch (error) {
      setSeniorModeSettingsState(previous);
      setStatus(getErrorMessage(error, "Could not save Senior mode settings."));
    } finally {
      setSeniorModeSaving(false);
    }
  };

  const startSeniorMode = async () => {
    if (!user?._id || !activeFamilyId || !dashboard || seniorModeSaving) return;
    const selectedMemberIds = availableSeniorModeMembers(
      seniorModeSettings,
      activeFamilyId,
      dashboard.members
        .filter((member) => member.userId !== dashboard.currentUserId)
        .map((member) => member.userId),
    );
    if (selectedMemberIds.length === 0) return;

    const previous = seniorModeSettings;
    const next: SeniorModeSettings = {
      enabled: true,
      familyId: activeFamilyId,
      memberIds: selectedMemberIds,
    };
    setSeniorModeSettingsState(next);
    setSelectedFamilyId(activeFamilyId);
    setHouseholdMenuOpen(false);
    setSeniorModeSaving(true);
    setStatus(null);
    try {
      await setSeniorModeSettings(user._id, next);
    } catch (error) {
      setSeniorModeSettingsState(previous);
      setStatus(getErrorMessage(error, "Could not start Senior mode."));
    } finally {
      setSeniorModeSaving(false);
    }
  };

  const exitSeniorMode = async () => {
    if (!user?._id || seniorModeSaving) return;
    const previous = seniorModeSettings;
    const next = { ...previous, enabled: false };
    setSeniorModeSettingsState(next);
    setSeniorModeSaving(true);
    try {
      await setSeniorModeSettings(user._id, next);
    } catch (error) {
      setSeniorModeSettingsState(previous);
      Alert.alert(
        "Could not exit Senior mode",
        getErrorMessage(error, "Please try again."),
      );
    } finally {
      setSeniorModeSaving(false);
    }
  };

  const requestSeniorModeExit = useCallback(() => {
    Alert.alert(
      "Exit Senior mode?",
      "This will return to all app controls on this device.",
      [
        { style: "cancel", text: "Keep Senior mode" },
        {
          onPress: () => { void exitSeniorMode(); },
          style: "destructive",
          text: "Exit",
        },
      ],
    );
  }, [seniorModeSaving, seniorModeSettings, user?._id]);

  const selectProfileImage = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        mediaTypes: ["images"],
        quality: 0.8,
      });
      if (result.canceled) return;

      const asset = result.assets[0];
      const image = new File(asset.uri);
      await uploadProfileImageFile<Id<"_storage">>({
        asset,
        file: image,
        generateUploadUrl: async () => await generateProfileImageUploadUrl({}),
        updateProfileImage,
        uploadType: UploadType.BINARY_CONTENT,
      });
      setStatus("Your picture has been updated.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Could not update your picture."));
    } finally {
      setSubmitting(false);
    }
  };

  const removeCurrentProfileImage = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      await removeProfileImage({});
      setStatus("Your picture has been removed.");
    } catch (error) {
      setStatus(getErrorMessage(error, "Could not remove your picture."));
    } finally {
      setSubmitting(false);
    }
  };

  const currentMember = dashboard?.members.find((member) => member.userId === dashboard.currentUserId);
  const selectableSeniorMembers = dashboard?.members.filter(
    (member) => member.userId !== dashboard.currentUserId,
  ) ?? [];
  const selectedSeniorMemberIds = dashboard && activeFamilyId
    ? availableSeniorModeMembers(
        seniorModeSettings,
        activeFamilyId,
        selectableSeniorMembers.map((member) => member.userId),
      ) as Id<"users">[]
    : [];
  const seniorModeActive =
    seniorModeLoaded
    && seniorModeSettings.enabled
    && seniorModeSettings.familyId === activeFamilyId
    && selectedSeniorMemberIds.length > 0;

  useEffect(() => {
    if (
      !seniorModeLoaded
      || !seniorModeSettings.enabled
      || !user?._id
      || families === undefined
    ) return;

    const familyExists = families.some(
      (family) => family._id === seniorModeSettings.familyId,
    );
    const isConfiguredDashboard =
      dashboard?.family._id === seniorModeSettings.familyId;
    if (familyExists && (!isConfiguredDashboard || selectedSeniorMemberIds.length > 0)) {
      return;
    }

    const next = { ...seniorModeSettings, enabled: false };
    setSeniorModeSettingsState(next);
    setStatus(
      familyExists
        ? "Senior mode was stopped because none of its selected family members are available."
        : "Senior mode was stopped because its household is no longer available.",
    );
    void setSeniorModeSettings(user._id, next).catch(() => undefined);
  }, [
    dashboard?.family._id,
    families,
    selectedSeniorMemberIds.length,
    seniorModeLoaded,
    seniorModeSettings,
    user?._id,
  ]);

  if (!seniorModeLoaded) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#fbbf24" size="large" />
      </View>
    );
  }

  if (seniorModeSettings.enabled) {
    return (
      <View style={styles.screen}>
        <StatusBar hidden style="light" />
        {deviceId !== null && dashboard ? (
          <FamilyCallPanel
            autoAnswerCalls={autoAnswerCallsLoaded && autoAnswerCalls}
            currentUserId={dashboard.currentUserId}
            deviceId={deviceId}
            familyId={dashboard.family._id}
            members={dashboard.members}
            onCallSurfaceChange={handleCallSurfaceChange}
            onSelectFamily={selectFamilyForIncomingCall}
            seniorMode={{
              memberIds: seniorModeActive ? selectedSeniorMemberIds : [],
              onExitRequest: requestSeniorModeExit,
            }}
          />
        ) : (
          <View style={styles.loading}>
            <ActivityIndicator color="#fbbf24" size="large" />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.screen}
      >
        <ScrollView
          contentContainerStyle={[
            styles.homeContent,
            isCompactLandscape && styles.homeContentCompact,
            { paddingBottom: Math.max(insets.bottom + 40, 48) },
          ]}
          contentInsetAdjustmentBehavior="automatic"
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.homeFrame}>
            <View style={styles.headerRow}>
              <View style={styles.headerCopy}>
                <Text style={styles.kicker}>RINNALLA.APP</Text>
                <Text accessibilityRole="header" style={styles.homeTitle}>
                  {dashboard?.family.name ?? "Your household"}
                </Text>
                <View style={styles.userMenuRow}>
                  <MemberAvatar
                    image={user?.image}
                    label={user?.name ?? user?.email ?? "Authenticated user"}
                    size={46}
                  />
                  <Text numberOfLines={2} style={styles.userName}>
                    {user?.name ?? user?.email ?? "Authenticated user"}
                  </Text>
                  <Pressable
                    accessibilityLabel="Open household settings"
                    accessibilityRole="button"
                    hitSlop={10}
                    onPress={() => setHouseholdMenuOpen(true)}
                    style={({ pressed }) => [styles.menuButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.menuButtonText}>⚙</Text>
                  </Pressable>
                </View>
              </View>
            </View>

            {families === undefined ? (
              <View style={styles.centeredPanel}>
                <ActivityIndicator color="#fbbf24" size="large" />
                <Text style={styles.panelText}>Loading your households…</Text>
              </View>
            ) : families.length === 0 ? (
              <View style={styles.emptyHouseholdPanel}>
                <Text style={styles.panelTitle}>No household connected yet</Text>
                <Text style={styles.panelText}>
                  Open household settings to create a family or join one with an invite code.
                </Text>
                <Button label="Open household settings" onPress={() => setHouseholdMenuOpen(true)} />
              </View>
            ) : dashboard ? (
              <View style={[styles.dashboardGrid, isWide && styles.dashboardGridWide]}>
                <View style={[styles.dashboardPrimary, isWide && styles.dashboardPrimaryWide]}>
                  {deviceId === null ? (
                    <View style={styles.centeredPanel}>
                      <ActivityIndicator color="#fbbf24" size="large" />
                      <Text style={styles.panelText}>Preparing secure calling on this device…</Text>
                    </View>
                  ) : (
                    <FamilyCallPanel
                      autoAnswerCalls={autoAnswerCallsLoaded && autoAnswerCalls}
                      currentUserId={dashboard.currentUserId}
                      deviceId={deviceId}
                      familyId={dashboard.family._id}
                      members={dashboard.members}
                      onCallSurfaceChange={handleCallSurfaceChange}
                      onSelectFamily={selectFamilyForIncomingCall}
                    />
                  )}
                </View>

                <View style={[styles.panel, styles.membersPanel, isWide && styles.dashboardSecondary]}>
                  <View style={styles.panelHeader}>
                    <View style={styles.panelHeaderCopy}>
                      <Text style={styles.panelTitle}>Family members</Text>
                      <Text style={styles.panelText}>Everyone in this household can be called.</Text>
                    </View>
                    <View style={styles.inviteBadge}>
                      <Text style={styles.inviteLabel}>INVITE</Text>
                      <Text selectable style={styles.inviteCode}>{dashboard.family.inviteCode}</Text>
                    </View>
                  </View>
                  <View style={styles.memberList}>
                    {dashboard.members.map((member) => (
                      <View key={member.userId} style={styles.member}>
                        <MemberAvatar
                          image={member.image}
                          label={member.name ?? member.email ?? "Family member"}
                          size={50}
                        />
                        <View style={styles.memberIdentity}>
                          <Text style={styles.memberName}>{member.name ?? member.email ?? "Family member"}</Text>
                          <Text style={styles.memberDetail}>{member.email ?? "No email available"}</Text>
                        </View>
                        <Text style={styles.role}>{member.role}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              </View>
            ) : (
              <View style={styles.centeredPanel}>
                <ActivityIndicator color="#fbbf24" size="large" />
                <Text style={styles.panelText}>Loading this household…</Text>
              </View>
            )}
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ResponsiveDrawer
        forceHidden={callSurfaceVisible}
        onClose={closeHouseholdMenu}
        open={householdMenuOpen}
        status={householdMenuOpen ? status : null}
        title="Household settings"
      >
        <View style={styles.drawerSection}>
          <Text style={styles.drawerKicker}>HOUSEHOLDS</Text>
          {families === undefined ? (
            <ActivityIndicator color="#fbbf24" />
          ) : families.length === 0 ? (
            <Text style={styles.drawerMuted}>Create or join a household below.</Text>
          ) : (
            <View style={styles.householdList}>
              {families.map((family) => {
                const isSelected = family._id === activeFamilyId;
                return (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityState={{ selected: isSelected }}
                    key={family._id}
                    onPress={() => {
                      setSelectedFamilyId(family._id);
                      closeHouseholdMenu();
                    }}
                    style={({ pressed }) => [
                      styles.householdItem,
                      isSelected && styles.householdItemSelected,
                      pressed && styles.buttonPressed,
                    ]}
                  >
                    <View style={styles.householdItemCopy}>
                      <Text style={styles.householdName}>{family.name}</Text>
                      <Text style={styles.drawerMuted}>Role: {family.role}</Text>
                    </View>
                    <Text style={styles.householdInvite}>{family.inviteCode}</Text>
                  </Pressable>
                );
              })}
            </View>
          )}
        </View>

        {dashboard ? (
          <View style={styles.drawerSection}>
            <Text style={styles.drawerKicker}>MANAGE FAMILY ACCESS</Text>
            <View style={styles.drawerInviteRow}>
              <Text style={styles.drawerMuted}>Invite code</Text>
              <Text selectable style={styles.inviteCode}>{dashboard.family.inviteCode}</Text>
            </View>
            {dashboard.members.map((member) => (
              <View key={member.userId} style={styles.drawerMember}>
                <MemberAvatar
                  image={member.image}
                  label={member.name ?? member.email ?? "Family member"}
                  size={42}
                />
                <View style={styles.drawerMemberCopy}>
                  <Text style={styles.drawerMemberName}>{member.name ?? member.email ?? "Family member"}</Text>
                  <Text style={styles.drawerMuted}>{member.role}</Text>
                </View>
                {currentMember?.role === "owner" && member.userId !== dashboard.currentUserId ? (
                  <Pressable
                    accessibilityRole="button"
                    disabled={submitting}
                    onPress={() => void perform(
                      () => removeMember({ familyId: dashboard.family._id, userId: member.userId }).then(() => undefined),
                      "Family member removed.",
                    )}
                    style={({ pressed }) => [styles.removeButton, pressed && styles.buttonPressed]}
                  >
                    <Text style={styles.remove}>Remove</Text>
                  </Pressable>
                ) : null}
              </View>
            ))}
            {currentMember?.role === "owner" ? (
              <Button
                disabled={submitting}
                label="Generate new invite code"
                onPress={() => void perform(async () => {
                  const code = await regenerateInviteCode({ familyId: dashboard.family._id });
                  setStatus(`New invite code: ${code}`);
                })}
                secondary
              />
            ) : (
              <Button
                disabled={submitting}
                label="Leave family"
                onPress={() => void perform(
                  () => leaveFamily({ familyId: dashboard.family._id }).then(() => undefined),
                  "You left the family.",
                )}
                secondary
              />
            )}
          </View>
        ) : null}

        {dashboard ? (
          <View style={styles.drawerSection}>
            <Text style={styles.drawerKicker}>SENIOR MODE</Text>
            <Text style={styles.settingTitle}>Picture-only calling</Text>
            <Text style={styles.drawerMuted}>
              Choose who appears on this device. Senior mode hides every other control, and tapping a picture starts a video call.
            </Text>
            {selectableSeniorMembers.length === 0 ? (
              <Text style={styles.drawerMuted}>
                Add another person to this household before starting Senior mode.
              </Text>
            ) : (
              <View style={styles.seniorSelectionList}>
                {selectableSeniorMembers.map((member) => {
                  const selected =
                    seniorModeSettings.familyId === activeFamilyId
                    && seniorModeSettings.memberIds.includes(member.userId);
                  const label = member.name ?? member.email ?? "Family member";
                  return (
                    <Pressable
                      accessibilityLabel={`${selected ? "Remove" : "Add"} ${label} ${selected ? "from" : "to"} Senior mode`}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: selected }}
                      disabled={seniorModeSaving}
                      key={member.userId}
                      onPress={() => void changeSeniorModeMember(member.userId)}
                      style={({ pressed }) => [
                        styles.seniorSelection,
                        selected && styles.seniorSelectionSelected,
                        pressed && styles.buttonPressed,
                      ]}
                    >
                      <MemberAvatar image={member.image} label={label} size={52} />
                      <Text numberOfLines={2} style={styles.seniorSelectionName}>{label}</Text>
                      <View style={[
                        styles.seniorCheckbox,
                        selected && styles.seniorCheckboxSelected,
                      ]}>
                        <Text style={styles.seniorCheckboxText}>{selected ? "✓" : ""}</Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            )}
            <Button
              disabled={
                seniorModeSaving
                || seniorModeSettings.familyId !== activeFamilyId
                || selectedSeniorMemberIds.length === 0
              }
              label={seniorModeSaving ? "Saving…" : "Start Senior mode"}
              onPress={() => void startSeniorMode()}
            />
            <Text style={styles.seniorExitHelp}>
              To exit later, press and hold the upper-right corner for 5 seconds, then confirm. For a stronger lock, also pin the app using the device settings.
            </Text>
          </View>
        ) : null}

        <View style={styles.drawerSection}>
          <Text style={styles.drawerKicker}>CALL SETTINGS</Text>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>Answer calls automatically</Text>
              <Text style={styles.drawerMuted}>
                Ring normally for 10 seconds, then let the caller choose whether to connect automatically. This is available only while rinnalla.app is open and visible; background or locked calls still require you to answer.
              </Text>
            </View>
            <Switch
              accessibilityLabel="Answer calls automatically while the app is open"
              disabled={!autoAnswerCallsLoaded || autoAnswerCallsSaving}
              onValueChange={(enabled) => void changeAutoAnswerCalls(enabled)}
              thumbColor={autoAnswerCalls ? "#fef3c7" : "#d6d3d1"}
              trackColor={{ false: "#57534e", true: "#b45309" }}
              value={autoAnswerCalls}
            />
          </View>
        </View>

        <View style={styles.drawerSection}>
          <Text style={styles.drawerKicker}>PROFILE & SETUP</Text>
          <View style={styles.profileImageRow}>
            <MemberAvatar
              image={user?.image}
              label={user?.name ?? user?.email ?? "Authenticated user"}
              size={76}
            />
            <View style={styles.profileImageControls}>
              <Text style={styles.settingTitle}>Your picture</Text>
              <Text style={styles.drawerMuted}>JPEG, PNG, or WebP, up to 5 MB.</Text>
              <Button
                disabled={submitting}
                label={user?.image ? "Update picture" : "Add picture"}
                onPress={() => void selectProfileImage()}
                secondary
              />
              {user?.image ? (
                <Button
                  disabled={submitting}
                  label="Remove picture"
                  onPress={() => void removeCurrentProfileImage()}
                  secondary
                />
              ) : null}
            </View>
          </View>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            accessibilityLabel="Your name"
            autoComplete="name"
            onChangeText={setDisplayName}
            placeholder={user?.name ?? "How should your family see you?"}
            placeholderTextColor="#78716c"
            style={styles.input}
            value={displayName}
          />
          <Button
            disabled={submitting || displayName.trim().length < 2}
            label="Save your name"
            onPress={() => void perform(
              () => updateName({ name: displayName.trim() }).then(() => { setDisplayName(""); }),
              "Your name has been updated.",
            )}
            secondary
          />

          <Text style={styles.label}>Create a family</Text>
          <TextInput
            accessibilityLabel="Create a family"
            autoComplete="organization"
            onChangeText={setFamilyName}
            placeholder="Korhonen family"
            placeholderTextColor="#78716c"
            style={styles.input}
            value={familyName}
          />
          <Button
            disabled={submitting || !familyName.trim()}
            label="Create family"
            onPress={() => void perform(async () => {
              await createFamily({ name: familyName.trim() });
              setFamilyName("");
            }, "Family created.")}
          />

          <Text style={styles.label}>Join with invite code</Text>
          <TextInput
            accessibilityLabel="Join with invite code"
            autoCapitalize="characters"
            autoComplete="off"
            onChangeText={(value) => setInviteCode(value.toUpperCase())}
            placeholder="ABC123"
            placeholderTextColor="#78716c"
            style={styles.input}
            value={inviteCode}
          />
          <Button
            disabled={submitting || !inviteCode.trim()}
            label="Join family"
            onPress={() => void perform(async () => {
              await joinFamily({ inviteCode: inviteCode.trim() });
              setInviteCode("");
            }, "Joined family.")}
            secondary
          />
        </View>

        <Pressable
          accessibilityRole="button"
          disabled={submitting}
          onPress={() => void signOutFromDevice()}
          style={({ pressed }) => [styles.signOutButton, pressed && styles.buttonPressed]}
        >
          <Text style={styles.signOutText}>{submitting ? "Working…" : "Sign out"}</Text>
        </Pressable>
      </ResponsiveDrawer>

      {status && !householdMenuOpen ? (
        <View
          accessibilityLiveRegion="polite"
          pointerEvents="none"
          style={[styles.toast, { bottom: Math.max(insets.bottom + 12, 18) }]}
        >
          <Text style={styles.toastText}>{status}</Text>
        </View>
      ) : null}
    </View>
  );
}

function AppContent() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  if (isLoading) return <View style={styles.loading}><ActivityIndicator color="#fbbf24" size="large" /></View>;
  return isAuthenticated ? <FamilyHome /> : <AuthPanel />;
}

function CallLaunchPrivacyGuard() {
  const insets = useSafeAreaInsets();
  const shouldInitializeNativeCalling =
    Platform.OS === "android" && process.env.EXPO_PUBLIC_DIRECT_FCM_ENABLED === "true";
  const [isNativeCallStateReady, setIsNativeCallStateReady] = useState(
    !shouldInitializeNativeCalling,
  );
  const isCallLaunchVisible = useSyncExternalStore(
    subscribeToCallAppLockScreenVisibility,
    getCallAppLockScreenVisibility,
    getCallAppLockScreenVisibility,
  );

  useEffect(() => {
    if (!shouldInitializeNativeCalling) return;
    let mounted = true;
    void initializeNativeCallService()
      .then(() => {
        if (mounted) setIsNativeCallStateReady(true);
      })
      .catch(() => {
        forceClearCallAppLockScreenVisibility();
        if (mounted) setIsNativeCallStateReady(true);
      });
    return () => { mounted = false; };
  }, [shouldInitializeNativeCalling]);

  if (isNativeCallStateReady && !isCallLaunchVisible) return null;
  return (
    <View
      accessibilityViewIsModal
      style={[
        styles.callLaunchPrivacyGuard,
        {
          paddingBottom: Math.max(insets.bottom, 24),
          paddingTop: Math.max(insets.top, 24),
        },
      ]}
    >
      <ActivityIndicator color="#bae6fd" size="large" />
      <Text style={styles.callLaunchPrivacyText}>
        {isCallLaunchVisible ? "Opening your call…" : "Starting rinnalla.app…"}
      </Text>
    </View>
  );
}

export default function App() {
  if (!convex) {
    return (
      <SafeAreaProvider>
        <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
          <StatusBar style="light" />
          <View style={styles.loading}>
            <Text accessibilityRole="header" style={styles.title}>Connect rinnalla.app</Text>
            <Text style={styles.body}>Set EXPO_PUBLIC_CONVEX_URL in apps/mobile/.env.local.</Text>
          </View>
          <CallLaunchPrivacyGuard />
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }
  return (
    <SafeAreaProvider>
      <SafeAreaView edges={["top", "left", "right"]} style={styles.safeArea}>
        <StatusBar style="light" />
        <ConvexAuthProvider client={convex} storage={tokenStorage}>
          <AppContent />
        </ConvexAuthProvider>
        <CallLaunchPrivacyGuard />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    backgroundColor: "#111111",
    flex: 1,
  },
  screen: {
    backgroundColor: "#111111",
    flex: 1,
  },
  loading: {
    backgroundColor: "#111111",
    flex: 1,
    justifyContent: "center",
    padding: 24,
  },
  callLaunchPrivacyGuard: {
    alignItems: "center",
    backgroundColor: "#020617",
    bottom: 0,
    elevation: 100,
    gap: 14,
    justifyContent: "center",
    left: 0,
    paddingHorizontal: 24,
    position: "absolute",
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  callLaunchPrivacyText: {
    color: "#e2e8f0",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  authContent: {
    backgroundColor: "#111111",
    flexGrow: 1,
    justifyContent: "center",
    paddingHorizontal: 20,
  },
  authContentTablet: {
    paddingHorizontal: 32,
  },
  authContentCompactLandscape: {
    justifyContent: "flex-start",
  },
  authCard: {
    alignSelf: "center",
    maxWidth: 620,
    width: "100%",
  },
  authCardWide: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 44,
    maxWidth: 960,
  },
  authIntro: {
    flex: 1,
    minWidth: 0,
  },
  authControls: {
    flex: 1,
    minWidth: 0,
    width: "100%",
  },
  homeContent: {
    backgroundColor: "#111111",
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
  },
  homeContentCompact: {
    paddingTop: 12,
  },
  homeFrame: {
    alignSelf: "center",
    gap: 18,
    maxWidth: 1120,
    width: "100%",
  },
  kicker: {
    color: "#fbbf24",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 3,
    marginBottom: 10,
  },
  title: {
    color: "#fafaf9",
    fontSize: 36,
    fontWeight: "700",
    lineHeight: 42,
  },
  titleCompact: {
    fontSize: 30,
    lineHeight: 35,
  },
  homeTitle: {
    color: "#fafaf9",
    flexShrink: 1,
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 36,
  },
  body: {
    color: "#d6d3d1",
    fontSize: 16,
    lineHeight: 24,
    marginTop: 14,
  },
  segmentedControl: {
    flexDirection: "row",
    gap: 8,
    marginTop: 24,
  },
  segment: {
    alignItems: "center",
    borderColor: "#44403c",
    borderRadius: 18,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minHeight: 46,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  segmentSelected: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  segmentText: {
    color: "#d6d3d1",
    fontWeight: "600",
    textAlign: "center",
  },
  segmentSelectedText: {
    color: "#1c1917",
    fontWeight: "700",
    textAlign: "center",
  },
  form: {
    gap: 10,
    marginTop: 20,
  },
  label: {
    color: "#d6d3d1",
    fontSize: 14,
    fontWeight: "600",
    marginTop: 8,
  },
  input: {
    backgroundColor: "#0c0a09",
    borderColor: "#44403c",
    borderRadius: 16,
    borderWidth: 1,
    color: "#fafaf9",
    fontSize: 16,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  button: {
    alignItems: "center",
    borderRadius: 16,
    justifyContent: "center",
    marginTop: 10,
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  primaryButton: {
    backgroundColor: "#fbbf24",
  },
  secondaryButton: {
    borderColor: "#57534e",
    borderWidth: 1,
  },
  primaryButtonText: {
    color: "#1c1917",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryButtonText: {
    color: "#f5f5f4",
    fontSize: 16,
    fontWeight: "600",
    textAlign: "center",
  },
  buttonPressed: {
    opacity: 0.82,
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  toast: {
    alignSelf: "center",
    backgroundColor: "#292524",
    borderColor: "#fbbf24",
    borderRadius: 16,
    borderWidth: 1,
    left: 20,
    maxWidth: 560,
    paddingHorizontal: 16,
    paddingVertical: 12,
    position: "absolute",
    right: 20,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 12,
    zIndex: 50,
  },
  toastText: {
    color: "#fef3c7",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  headerRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  headerCopy: {
    flex: 1,
    minWidth: 0,
  },
  userMenuRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
    marginTop: 6,
  },
  userName: {
    color: "#d6d3d1",
    flexShrink: 1,
    fontSize: 15,
    lineHeight: 21,
  },
  menuButton: {
    alignItems: "center",
    borderColor: "#57534e",
    borderRadius: 18,
    borderWidth: 1,
    height: 44,
    justifyContent: "center",
    width: 44,
  },
  menuButtonText: {
    color: "#fcd34d",
    fontSize: 23,
    lineHeight: 27,
  },
  panel: {
    backgroundColor: "#1c1917",
    borderColor: "#44403c",
    borderRadius: 24,
    borderWidth: 1,
    padding: 18,
  },
  centeredPanel: {
    alignItems: "center",
    backgroundColor: "#1c1917",
    borderColor: "#44403c",
    borderRadius: 24,
    borderWidth: 1,
    gap: 10,
    justifyContent: "center",
    minHeight: 160,
    padding: 20,
  },
  emptyHouseholdPanel: {
    alignSelf: "center",
    backgroundColor: "#1c1917",
    borderColor: "#44403c",
    borderRadius: 24,
    borderWidth: 1,
    maxWidth: 620,
    padding: 20,
    width: "100%",
  },
  panelTitle: {
    color: "#fafaf9",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 26,
  },
  panelText: {
    color: "#d6d3d1",
    fontSize: 14,
    lineHeight: 20,
    marginTop: 6,
  },
  dashboardGrid: {
    gap: 18,
  },
  dashboardGridWide: {
    alignItems: "flex-start",
    flexDirection: "row",
  },
  dashboardPrimary: {
    minWidth: 0,
    width: "100%",
  },
  dashboardPrimaryWide: {
    flex: 1.4,
    width: "auto",
  },
  dashboardSecondary: {
    flex: 1,
    width: "auto",
  },
  membersPanel: {
    minWidth: 0,
    width: "100%",
  },
  panelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    marginBottom: 12,
  },
  panelHeaderCopy: {
    flex: 1,
    minWidth: 180,
  },
  inviteBadge: {
    alignItems: "flex-end",
    backgroundColor: "#292524",
    borderRadius: 12,
    gap: 2,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  inviteLabel: {
    color: "#a8a29e",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.6,
  },
  inviteCode: {
    color: "#fcd34d",
    fontFamily: "monospace",
    fontSize: 16,
    fontWeight: "700",
  },
  memberList: {
    gap: 10,
  },
  member: {
    alignItems: "flex-start",
    borderTopColor: "#44403c",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "space-between",
    paddingVertical: 14,
  },
  memberIdentity: {
    flex: 1,
    minWidth: 160,
  },
  memberName: {
    color: "#fafaf9",
    fontSize: 16,
    fontWeight: "600",
    lineHeight: 22,
  },
  memberDetail: {
    color: "#a8a29e",
    fontSize: 13,
    marginTop: 2,
  },
  role: {
    borderColor: "#57534e",
    borderRadius: 12,
    borderWidth: 1,
    color: "#d6d3d1",
    fontSize: 11,
    overflow: "hidden",
    paddingHorizontal: 9,
    paddingVertical: 5,
    textTransform: "uppercase",
  },
  drawerSection: {
    backgroundColor: "#1c1917",
    borderColor: "#44403c",
    borderRadius: 20,
    borderWidth: 1,
    gap: 10,
    padding: 15,
  },
  drawerKicker: {
    color: "#a8a29e",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2.2,
  },
  drawerMuted: {
    color: "#a8a29e",
    fontSize: 13,
    lineHeight: 18,
  },
  settingRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
    justifyContent: "space-between",
  },
  settingCopy: {
    flex: 1,
    gap: 4,
    minWidth: 0,
  },
  settingTitle: {
    color: "#fafaf9",
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
  },
  seniorSelectionList: {
    gap: 8,
  },
  seniorSelection: {
    alignItems: "center",
    backgroundColor: "#0c0a09",
    borderColor: "#44403c",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    minHeight: 72,
    padding: 10,
  },
  seniorSelectionSelected: {
    backgroundColor: "#422006",
    borderColor: "#fbbf24",
  },
  seniorSelectionName: {
    color: "#fafaf9",
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 20,
    minWidth: 0,
  },
  seniorCheckbox: {
    alignItems: "center",
    borderColor: "#78716c",
    borderRadius: 8,
    borderWidth: 2,
    height: 28,
    justifyContent: "center",
    width: 28,
  },
  seniorCheckboxSelected: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  seniorCheckboxText: {
    color: "#1c1917",
    fontSize: 18,
    fontWeight: "800",
    lineHeight: 21,
  },
  seniorExitHelp: {
    color: "#d6d3d1",
    fontSize: 12,
    lineHeight: 17,
    marginTop: 2,
  },
  profileImageRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 14,
  },
  profileImageControls: {
    flex: 1,
    minWidth: 0,
  },
  householdList: {
    gap: 10,
  },
  householdItem: {
    alignItems: "center",
    backgroundColor: "#0c0a09",
    borderColor: "#44403c",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    minHeight: 64,
    padding: 12,
  },
  householdItemSelected: {
    backgroundColor: "#422006",
    borderColor: "#fbbf24",
  },
  householdItemCopy: {
    flex: 1,
    minWidth: 0,
  },
  householdName: {
    color: "#fafaf9",
    fontSize: 15,
    fontWeight: "700",
    lineHeight: 20,
  },
  householdInvite: {
    color: "#fcd34d",
    flexShrink: 0,
    fontFamily: "monospace",
    fontSize: 13,
    fontWeight: "700",
  },
  drawerInviteRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    justifyContent: "space-between",
  },
  drawerMember: {
    alignItems: "center",
    borderTopColor: "#44403c",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
    paddingTop: 10,
  },
  drawerMemberCopy: {
    flex: 1,
    minWidth: 0,
  },
  drawerMemberName: {
    color: "#fafaf9",
    fontSize: 14,
    fontWeight: "600",
  },
  removeButton: {
    borderColor: "#fb7185",
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 40,
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  remove: {
    color: "#fda4af",
    fontSize: 13,
    fontWeight: "700",
  },
  signOutButton: {
    alignItems: "center",
    borderColor: "#78716c",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 52,
    paddingHorizontal: 16,
    paddingVertical: 13,
  },
  signOutText: {
    color: "#fafaf9",
    fontSize: 16,
    fontWeight: "700",
  },
});
