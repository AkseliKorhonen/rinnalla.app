"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useAction,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import {
  ChangeEvent,
  FormEvent,
  KeyboardEvent as ReactKeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { FamilyCallPanel } from "./family-call-panel";
import { useLanguage } from "./language";
import { MemberAvatar } from "./member-avatar";

type Mode = "signIn" | "signUp";
type ResetStep = "request" | "verify" | null;

const ANDROID_DEVELOPMENT_APK_URL =
  "https://github.com/AkseliKorhonen/rinnalla.app/releases/download/development/rinnalla-development.apk";
const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
const PROFILE_IMAGE_CONTENT_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export function AuthPanel() {
  const { language, setLanguage, t, tError } = useLanguage();
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [emailVerificationCode, setEmailVerificationCode] = useState("");
  const [emailVerificationPending, setEmailVerificationPending] = useState(false);
  const [resetStep, setResetStep] = useState<ResetStep>(null);
  const [resetCode, setResetCode] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState<Id<"families"> | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [householdPanelOpen, setHouseholdPanelOpen] = useState(false);
  const [householdPanelModal, setHouseholdPanelModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const householdPanelRef = useRef<HTMLElement>(null);
  const householdPanelButtonRef = useRef<HTMLButtonElement>(null);
  const householdPanelCloseButtonRef = useRef<HTMLButtonElement>(null);
  const profileImageInputRef = useRef<HTMLInputElement>(null);
  const restoreHouseholdPanelFocusRef = useRef(true);
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current);
  const families = useQuery(
    api.families.listMy,
    isAuthenticated ? {} : "skip",
  );
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
  const activeFamilyId =
    families && families.length > 0
      ? selectedFamilyId && families.some((family) => family._id === selectedFamilyId)
        ? selectedFamilyId
        : families[0]._id
      : null;
  const dashboard = useQuery(
    api.families.dashboard,
    activeFamilyId ? { familyId: activeFamilyId } : "skip",
  );

  useEffect(() => {
    if (status === null) return;
    const timeout = window.setTimeout(() => setStatus(null), 4_000);
    return () => window.clearTimeout(timeout);
  }, [status]);

  useEffect(() => {
    const desktopMedia = window.matchMedia("(min-width: 1280px)");
    const syncDrawerSemantics = () => {
      setHouseholdPanelModal(!desktopMedia.matches);
    };

    syncDrawerSemantics();
    desktopMedia.addEventListener("change", syncDrawerSemantics);
    return () => desktopMedia.removeEventListener("change", syncDrawerSemantics);
  }, []);

  useEffect(() => {
    if (!householdPanelOpen) return;

    const desktopMedia = window.matchMedia("(min-width: 1280px)");
    const panelButton = householdPanelButtonRef.current;
    const originalOverflow = document.body.style.overflow;
    const syncDrawerMode = () => {
      if (desktopMedia.matches) {
        document.body.style.overflow = originalOverflow;
      } else {
        document.body.style.overflow = "hidden";
        householdPanelCloseButtonRef.current?.focus();
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setHouseholdPanelOpen(false);
      }
    };

    syncDrawerMode();
    desktopMedia.addEventListener("change", syncDrawerMode);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      desktopMedia.removeEventListener("change", syncDrawerMode);
      window.removeEventListener("keydown", closeOnEscape);
      document.body.style.overflow = originalOverflow;
      if (restoreHouseholdPanelFocusRef.current) panelButton?.focus();
      restoreHouseholdPanelFocusRef.current = true;
    };
  }, [householdPanelOpen]);

  const keepFocusInsideHouseholdPanel = (
    event: ReactKeyboardEvent<HTMLElement>,
  ) => {
    if (
      event.key !== "Tab" ||
      window.matchMedia("(min-width: 1280px)").matches
    ) {
      return;
    }

    const panel = householdPanelRef.current;
    if (!panel) return;

    const focusableElements = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
      ),
    );
    const first = focusableElements[0];
    const last = focusableElements.at(-1);

    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  const handleCallSurfaceChange = useCallback((visible: boolean) => {
    if (visible && householdPanelOpen) {
      restoreHouseholdPanelFocusRef.current = false;
      setHouseholdPanelOpen(false);
    }
  }, [householdPanelOpen]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const result = await signIn("password", {
        flow: mode,
        email,
        password,
        ...(mode === "signUp" ? { name: displayName } : {}),
      });

      if (result.signingIn) {
        setStatus(t(mode === "signUp" ? "Account created." : "Signed in."));
      } else {
        setPassword("");
        setEmailVerificationCode("");
        setEmailVerificationPending(true);
        setStatus(t(
          mode === "signUp"
            ? "Account created. Enter the verification code from your email."
            : "Enter the verification code we sent to your email.",
        ));
      }
    } catch (error) {
      setStatus(tError(error, "Authentication failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyEmail = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      setEmailVerificationPending(false);
      setStatus(t("Email verified. You are now signed in."));
    } catch (error) {
      setStatus(tError(error, "That verification code could not be verified."));
    } finally {
      setSubmitting(false);
    }
  };

  const onResendEmailVerification = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      await signIn("password", { email, flow: "email-verification" });
      setEmailVerificationCode("");
      setStatus(t("We sent a new verification code to your email."));
    } catch (error) {
      setStatus(tError(error, "Could not send a new verification code."));
    } finally {
      setSubmitting(false);
    }
  };

  const onUpdateName = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);
    try {
      await updateName({ name: displayName });
      setStatus(t("Your name has been updated."));
    } catch (error) {
      setStatus(tError(error, "Could not update your name."));
    } finally {
      setSubmitting(false);
    }
  };

  const onProfileImageSelected = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const input = event.currentTarget;
    const file = input.files?.[0];
    if (!file) return;

    const contentType = file.type === "image/jpg" ? "image/jpeg" : file.type;
    if (!PROFILE_IMAGE_CONTENT_TYPES.has(contentType)) {
      input.value = "";
      setStatus(t("Choose a JPEG, PNG, or WebP image."));
      return;
    }
    if (file.size > MAX_PROFILE_IMAGE_BYTES) {
      input.value = "";
      setStatus(t("Profile pictures must be 5 MB or smaller."));
      return;
    }

    setSubmitting(true);
    setStatus(null);
    try {
      const uploadUrl = await generateProfileImageUploadUrl({});
      const response = await fetch(uploadUrl, {
        body: file,
        headers: { "Content-Type": contentType },
        method: "POST",
      });
      if (!response.ok) throw new Error("Could not upload your picture.");
      const result = await response.json() as { storageId?: Id<"_storage"> };
      if (!result.storageId) throw new Error("The upload did not return a file ID.");
      await updateProfileImage({ storageId: result.storageId });
      setStatus(t("Your picture has been updated."));
    } catch (error) {
      setStatus(tError(error, "Could not update your picture."));
    } finally {
      input.value = "";
      setSubmitting(false);
    }
  };

  const onRemoveProfileImage = async () => {
    setSubmitting(true);
    setStatus(null);
    try {
      await removeProfileImage({});
      setStatus(t("Your picture has been removed."));
    } catch (error) {
      setStatus(tError(error, "Could not remove your picture."));
    } finally {
      setSubmitting(false);
    }
  };

  const onRequestPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      await signIn("password", { email, flow: "reset" });
      setResetStep("verify");
      setStatus(t("If an account matches that email, we sent a reset code."));
    } catch {
      setStatus(t("We could not start the password reset. Please try again."));
    } finally {
      setSubmitting(false);
    }
  };

  const onVerifyPasswordReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
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
      setResetStep(null);
      setStatus(t(
        result.signingIn
          ? "Password reset. You are now signed in."
          : "Password reset. You can now sign in.",
      ));
    } catch (error) {
      setStatus(tError(error, "That reset code could not be verified."));
    } finally {
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    setSubmitting(true);
    setStatus(null);

    try {
      await signOut();
      setStatus(t("Signed out."));
    } catch (error) {
      setStatus(tError(error, "Sign out failed."));
    } finally {
      setSubmitting(false);
    }
  };

  const onCreateFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      await createFamily({ name: familyName });
      setFamilyName("");
      setStatus(t("Family created."));
    } catch (error) {
      setStatus(tError(error, "Could not create family."));
    } finally {
      setSubmitting(false);
    }
  };

  const onJoinFamily = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      await joinFamily({ inviteCode });
      setInviteCode("");
      setStatus(t("Joined family."));
    } catch (error) {
      setStatus(tError(error, "Could not join family."));
    } finally {
      setSubmitting(false);
    }
  };

  const onRegenerateInviteCode = async () => {
    if (!activeFamilyId) {
      return;
    }
    setSubmitting(true);
    setStatus(null);

    try {
      const inviteCode = await regenerateInviteCode({ familyId: activeFamilyId });
      setStatus(t("New invite code: {code}", { code: inviteCode }));
    } catch (error) {
      setStatus(tError(error, "Could not rotate invite code."));
    } finally {
      setSubmitting(false);
    }
  };

  const onRemoveMember = async (userId: Id<"users">) => {
    if (!activeFamilyId) {
      return;
    }
    setSubmitting(true);
    setStatus(null);

    try {
      await removeMember({ familyId: activeFamilyId, userId });
      setStatus(t("Family member removed."));
    } catch (error) {
      setStatus(tError(error, "Could not remove family member."));
    } finally {
      setSubmitting(false);
    }
  };

  const onLeaveFamily = async () => {
    if (!activeFamilyId) {
      return;
    }
    setSubmitting(true);
    setStatus(null);

    try {
      await leaveFamily({ familyId: activeFamilyId });
      setStatus(t("You left the family."));
    } catch (error) {
      setStatus(tError(error, "Could not leave family."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full min-w-0 max-w-7xl rounded-2xl border border-stone-800 bg-stone-900/95 p-4 shadow-2xl shadow-black/30 sm:rounded-[2rem] sm:p-6 lg:p-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm uppercase tracking-[0.35em] text-amber-300">
          rinnalla.app
        </p>
        <div aria-label={t("Language")} className="flex items-center gap-1 rounded-xl border border-stone-700 p-1" role="group">
          {(["en", "fi"] as const).map((option) => (
            <button
              aria-pressed={language === option}
              className={`min-h-9 rounded-lg px-3 text-sm transition ${language === option ? "bg-amber-300 font-medium text-stone-950" : "text-stone-300 hover:bg-stone-800"}`}
              key={option}
              onClick={() => setLanguage(option)}
              type="button"
            >
              {t(option === "en" ? "English" : "Finnish")}
            </button>
          ))}
        </div>
      </div>
      <h1 className="mt-5 text-3xl font-semibold tracking-tight text-stone-50 sm:text-4xl">
        {t("Stay close, even from afar.")}
      </h1>
      <p className="mt-3 text-sm leading-6 text-stone-300">
        {t("A simple place for families to see who is available and connect face to face.")}
      </p>

      <div className="mt-6 flex flex-col gap-4 rounded-2xl border border-amber-300/20 bg-amber-300/[0.06] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="grid size-11 shrink-0 place-items-center rounded-xl bg-amber-300/10 text-amber-200"
          >
            <svg
              className="size-6"
              fill="none"
              viewBox="0 0 24 24"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M8 6.5 6.5 4M16 6.5 17.5 4M7 9h10v7.5A1.5 1.5 0 0 1 15.5 18h-7A1.5 1.5 0 0 1 7 16.5V9Zm-2 1.5v5m14-5v5M9.5 18v2m5-2v2"
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
              />
              <circle cx="10" cy="12" fill="currentColor" r=".75" />
              <circle cx="14" cy="12" fill="currentColor" r=".75" />
            </svg>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-stone-100">
              {t("Android development build")}
            </p>
            <p
              id="android-build-description"
              className="mt-1 break-words text-xs leading-5 text-stone-400"
            >
              {t("For testing rinnalla.app on an Android phone or tablet.")}
            </p>
          </div>
        </div>
        <a
          aria-describedby="android-build-description"
          aria-label={t("Download the rinnalla.app Android development APK")}
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center gap-2 rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-semibold text-stone-950 transition hover:bg-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:w-auto"
          href={ANDROID_DEVELOPMENT_APK_URL}
        >
          {t("Download APK")}
          <svg
            aria-hidden="true"
            className="size-4"
            fill="none"
            viewBox="0 0 24 24"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path
              d="M12 4v11m0 0 4-4m-4 4-4-4M5 20h14"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="2"
            />
          </svg>
        </a>
      </div>

      <AuthLoading>
        <p className="mt-8 text-sm text-stone-400">{t("Checking session...")}</p>
      </AuthLoading>

      <Unauthenticated>
        <div className="max-w-xl">
        {resetStep === null && !emailVerificationPending ? <div className="mt-8 grid grid-cols-2 gap-3 sm:flex">
          <button
            className={`min-h-11 rounded-full px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:px-4 ${
              mode === "signIn"
                ? "bg-amber-300 text-stone-950"
                : "border border-stone-700 text-stone-300"
            }`}
            onClick={() => setMode("signIn")}
            type="button"
          >
            {t("Sign in")}
          </button>
          <button
            className={`min-h-11 rounded-full px-3 py-2 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 sm:px-4 ${
              mode === "signUp"
                ? "bg-amber-300 text-stone-950"
                : "border border-stone-700 text-stone-300"
            }`}
            onClick={() => setMode("signUp")}
            type="button"
          >
            {t("Create account")}
          </button>
        </div> : null}

        {emailVerificationPending ? (
          <form className="mt-8 space-y-4" onSubmit={onVerifyEmail}>
            <div>
              <h2 className="text-xl font-semibold text-stone-50">{t("Verify your email")}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                {t("Enter the eight-digit code sent to {email}. The code expires in 15 minutes.", { email })}
              </p>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">{t("Verification code")}</span>
              <input
                autoComplete="one-time-code"
                autoFocus
                className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                id="email-verification-code"
                inputMode="numeric"
                maxLength={8}
                onChange={(event) => setEmailVerificationCode(event.target.value.replace(/\D/g, ""))}
                required
                value={emailVerificationCode}
              />
            </label>
            <button
              className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting || emailVerificationCode.length !== 8}
              type="submit"
            >
              {t(submitting ? "Verifying..." : "Verify email")}
            </button>
            <button
              className="w-full text-sm text-amber-200 underline underline-offset-4 transition hover:text-amber-100 disabled:opacity-60"
              disabled={submitting}
              onClick={() => void onResendEmailVerification()}
              type="button"
            >
              {t("Send a new code")}
            </button>
            <button
              className="w-full text-sm text-stone-300 underline underline-offset-4"
              onClick={() => {
                setEmailVerificationCode("");
                setEmailVerificationPending(false);
                setMode("signIn");
              }}
              type="button"
            >
              {t("Back to sign in")}
            </button>
          </form>
        ) : resetStep === null ? <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          {mode === "signUp" ? <label className="block">
            <span className="mb-2 block text-sm text-stone-300">{t("Your name")}</span>
            <input autoComplete="name" className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300" id="auth-name" minLength={2} name="name" onChange={(event) => setDisplayName(event.target.value)} required value={displayName} />
          </label> : null}
          <label className="block">
            <span className="mb-2 block text-sm text-stone-300">{t("Email")}</span>
            <input
              autoComplete="email"
              className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
              id="auth-email"
              name="email"
              onChange={(event) => setEmail(event.target.value)}
              required
              type="email"
              value={email}
            />
          </label>

          <label className="block">
            <span className="mb-2 block text-sm text-stone-300">{t("Password")}</span>
            <input
              autoComplete={
                mode === "signUp" ? "new-password" : "current-password"
              }
              className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
              id="auth-password"
              minLength={8}
              name="password"
              onChange={(event) => setPassword(event.target.value)}
              required
              type="password"
              value={password}
            />
          </label>

          <button
            className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={submitting}
            type="submit"
          >
            {t(submitting
              ? "Working..."
              : mode === "signUp"
                ? "Create account"
                : "Sign in")}
          </button>
          {mode === "signIn" ? (
            <button
              className="w-full text-sm text-amber-200 underline underline-offset-4 transition hover:text-amber-100"
              onClick={() => {
                setPassword("");
                setResetStep("request");
              }}
              type="button"
            >
              {t("Forgot password?")}
            </button>
          ) : null}
        </form>
        : resetStep === "request" ? (
          <form className="mt-6 space-y-4" onSubmit={onRequestPasswordReset}>
            <div>
              <h2 className="text-xl font-semibold text-stone-50">{t("Reset password")}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                {t("Enter your email and we will send you a reset code.")}
              </p>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">{t("Email")}</span>
              <input
                autoComplete="email"
                className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                id="reset-email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </label>
            <button
              className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {t(submitting ? "Sending..." : "Send reset code")}
            </button>
            <button
              className="w-full text-sm text-stone-300 underline underline-offset-4"
              onClick={() => setResetStep(null)}
              type="button"
            >
              {t("Back to sign in")}
            </button>
          </form>
        ) : (
          <form className="mt-6 space-y-4" onSubmit={onVerifyPasswordReset}>
            <div>
              <h2 className="text-xl font-semibold text-stone-50">{t("Enter your reset code")}</h2>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                {t("Check your email for the eight-digit code, then choose a new password.")}
              </p>
            </div>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">{t("Reset code")}</span>
              <input
                autoComplete="one-time-code"
                className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                id="reset-code"
                inputMode="numeric"
                onChange={(event) => setResetCode(event.target.value)}
                required
                value={resetCode}
              />
            </label>
            <label className="block">
              <span className="mb-2 block text-sm text-stone-300">{t("New password")}</span>
              <input
                autoComplete="new-password"
                className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                id="reset-password"
                minLength={8}
                onChange={(event) => setPassword(event.target.value)}
                required
                type="password"
                value={password}
              />
            </label>
            <button
              className="w-full rounded-2xl bg-amber-300 px-4 py-3 font-medium text-stone-950 transition hover:bg-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={submitting}
              type="submit"
            >
              {t(submitting ? "Resetting..." : "Reset password")}
            </button>
            <button
              className="w-full text-sm text-stone-300 underline underline-offset-4"
              onClick={() => setResetStep("request")}
              type="button"
            >
              {t("Send a new code")}
            </button>
          </form>
        )}
        </div>
      </Unauthenticated>

      <Authenticated>
        <div
          className={`mt-8 grid min-w-0 gap-6 ${
            householdPanelOpen
              ? "xl:grid-cols-[minmax(0,1.75fr)_minmax(20rem,1fr)]"
              : ""
          }`}
        >
          <section className="min-w-0 rounded-3xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_35%),linear-gradient(180deg,_rgba(28,25,23,0.96),_rgba(12,10,9,0.96))] p-4 sm:p-6">
            <div className="flex flex-col gap-5 border-b border-stone-800 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <p className="text-sm uppercase tracking-[0.32em] text-emerald-300">
                  {t("Family calls")}
                </p>
                <h2 className="mt-3 break-words text-2xl font-semibold tracking-tight text-stone-50 sm:text-3xl">
                  {dashboard?.family.name ?? t("Your household")}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
                  {t("Call anyone in your household, whenever you need to connect.")}
                </p>
              </div>
              <div className="w-full min-w-0 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 sm:w-auto sm:max-w-sm">
                <p className="text-xs uppercase tracking-[0.28em] text-emerald-200">
                  {t("You")}
                </p>
                <div className="mt-2 flex items-center justify-between gap-3">
                  <MemberAvatar
                    className="size-11"
                    image={user?.image}
                    label={user?.name ?? user?.email ?? t("Authenticated user")}
                  />
                  <p className="min-w-0 break-words text-base font-medium text-stone-50">
                    {user?.name ?? user?.email ?? t("Authenticated user")}
                  </p>
                  <button
                    ref={householdPanelButtonRef}
                    aria-controls="household-settings-panel"
                    aria-expanded={householdPanelOpen}
                    aria-label={t(householdPanelOpen ? "Close household settings" : "Open household settings")}
                    className="grid size-11 shrink-0 place-items-center rounded-xl text-amber-100 transition hover:bg-emerald-400/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200"
                    onClick={() => setHouseholdPanelOpen((open) => !open)}
                    title={t("Household settings")}
                    type="button"
                  >
                    <svg aria-hidden="true" className="size-5" fill="none" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9.6 3.8 10 2h4l.4 1.8a8.4 8.4 0 0 1 1.6.9l1.8-.6 2 3.5-1.4 1.2c.1.5.2 1.1.2 1.7s-.1 1.2-.2 1.7l1.4 1.2-2 3.5-1.8-.6a8.4 8.4 0 0 1-1.6.9L14 19h-4l-.4-1.8a8.4 8.4 0 0 1-1.6-.9l-1.8.6-2-3.5 1.4-1.2a7.6 7.6 0 0 1 0-3.4L4.2 7.6l2-3.5 1.8.6a8.4 8.4 0 0 1 1.6-.9Z" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.6" />
                      <circle cx="12" cy="10.5" r="2.5" stroke="currentColor" strokeWidth="1.6" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            <div className="mt-6">
              {families === undefined ? (
                <p className="text-sm text-stone-400">{t("Loading households...")}</p>
              ) : families.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-stone-700 bg-stone-950/40 p-6">
                  <p className="text-lg font-semibold text-stone-50">
                    {t("No family connected yet")}
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-400">
                    {t("Create a household or join one with an invite code to start calling your family.")}
                  </p>
                </div>
              ) : dashboard === undefined ? (
                <p className="text-sm text-stone-400">
                  {t("Loading household...")}
                </p>
              ) : (
                <div className="space-y-5">
                  <FamilyCallPanel
                    currentUserId={dashboard.currentUserId}
                    familyId={dashboard.family._id}
                    members={dashboard.members}
                    onCallSurfaceChange={handleCallSurfaceChange}
                  />

                  <div className="grid gap-4 md:grid-cols-2">
                    {dashboard.members.map((member) => (
                      <article
                        key={member.userId}
                        className="min-w-0 rounded-3xl border border-stone-800 bg-stone-950/70 px-4 py-4 transition sm:px-5"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="flex min-w-0 flex-1 items-center gap-3">
                            <MemberAvatar
                              image={member.image}
                              label={member.name ?? member.email ?? t("Family member")}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="break-words text-lg font-semibold text-stone-50">
                                {member.name ?? member.email ?? t("Family member")}
                              </p>
                              <p className="mt-1 break-all text-sm text-stone-400">
                                {member.email ?? t("No email available")}
                              </p>
                            </div>
                          </div>
                          <p className="shrink-0 rounded-full border border-stone-700 px-3 py-1 text-xs uppercase tracking-[0.24em] text-stone-300">
                            {t(member.role)}
                          </p>
                        </div>
                        {dashboard.members.find(
                          (currentMember) =>
                            currentMember.userId === dashboard.currentUserId,
                        )?.role === "owner" &&
                        member.userId !== dashboard.currentUserId ? (
                          <button
                            className="mt-4 min-h-11 w-full rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-medium text-rose-100 transition hover:border-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-200 disabled:cursor-not-allowed disabled:opacity-60 sm:w-auto"
                            disabled={submitting}
                            onClick={() => onRemoveMember(member.userId)}
                            type="button"
                          >
                            {t("Remove member")}
                          </button>
                        ) : null}
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {householdPanelOpen ? (
            <>
              <button aria-label={t("Close household settings")} className="household-backdrop-enter fixed inset-0 z-40 bg-black/65 backdrop-blur-[2px] xl:hidden" onClick={() => setHouseholdPanelOpen(false)} type="button" />
              <aside
                ref={householdPanelRef}
                aria-labelledby="household-settings-title"
                aria-modal={householdPanelModal || undefined}
                className="household-panel-enter household-settings-drawer fixed inset-y-0 right-0 z-50 w-[min(26rem,calc(100%-0.75rem))] space-y-6 overflow-y-auto overscroll-contain border-l border-stone-700 bg-stone-900 p-4 shadow-2xl shadow-black/50 sm:w-[26rem] sm:p-6 xl:static xl:z-auto xl:w-auto xl:overflow-visible xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none"
                id="household-settings-panel"
                onKeyDown={keepFocusInsideHouseholdPanel}
                role={householdPanelModal ? "dialog" : "region"}
              >
                <div className="flex items-center justify-between gap-4 xl:hidden">
                  <h2 className="text-xl font-semibold text-stone-50" id="household-settings-title">{t("Household settings")}</h2>
                  <button ref={householdPanelCloseButtonRef} aria-label={t("Close household settings")} className="grid size-11 shrink-0 place-items-center rounded-xl border border-stone-700 text-2xl text-stone-200 transition hover:border-stone-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200" onClick={() => setHouseholdPanelOpen(false)} type="button"><span aria-hidden="true">×</span></button>
                </div>
                <button className="min-h-11 w-full rounded-2xl border border-stone-600 px-4 py-3 text-sm font-medium text-stone-100 transition hover:border-stone-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-60" disabled={submitting} onClick={onSignOut} type="button">{t("Sign out")}</button>
            <div className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5">
              <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                {t("Households")}
              </p>
              <div className="mt-4 space-y-3">
                {families === undefined ? (
                  <p className="text-sm text-stone-400">{t("Loading families...")}</p>
                ) : families.length === 0 ? (
                  <p className="text-sm text-stone-400">
                    {t("Create or join a household to call your family.")}
                  </p>
                ) : (
                  families.map((family) => (
                    <article
                      key={family._id}
                      className={`w-full min-w-0 rounded-2xl border p-2 text-left ${family._id === activeFamilyId ? "border-amber-300/60 bg-amber-300/10" : "border-stone-800 bg-stone-900"}`}
                    >
                      <button aria-pressed={family._id === activeFamilyId} className="w-full min-w-0 rounded-xl px-2 py-2 text-left transition hover:bg-stone-800/70 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200" onClick={() => setSelectedFamilyId(family._id)} type="button">
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="break-words text-base font-semibold text-stone-50">{family.name}</p>
                            <p className="mt-1 text-sm text-stone-400">{t("Role: {role}", { role: t(family.role) })}</p>
                          </div>
                          <div className="shrink-0 text-right">
                            <p className="text-xs uppercase tracking-[0.25em] text-stone-500">{t("Invite")}</p>
                            <p className="mt-1 font-mono text-sm text-amber-300">{family.inviteCode}</p>
                          </div>
                        </div>
                      </button>
                      {family._id === activeFamilyId && family.role === "owner" ? (
                        <button
                          className="m-2 mt-1 min-h-11 rounded-xl border border-amber-300/30 px-3 py-2 text-xs font-medium text-amber-100 transition hover:border-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={submitting}
                          onClick={onRegenerateInviteCode}
                          type="button"
                        >
                          {t("Generate new invite code")}
                        </button>
                      ) : family._id === activeFamilyId ? (
                        <button
                          className="m-2 mt-1 min-h-11 rounded-xl border border-rose-400/30 px-3 py-2 text-xs font-medium text-rose-100 transition hover:border-rose-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-200 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={submitting}
                          onClick={onLeaveFamily}
                          type="button"
                        >
                          {t("Leave family")}
                        </button>
                      ) : null}
                    </article>
                  ))
                )}
              </div>
            </div>

            <div className="mt-4 space-y-4 rounded-3xl border border-stone-800 bg-stone-950/70 p-4 sm:p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                    {t("Setup")}
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-stone-50">
                    {t("Profile & setup")}
                  </h3>
                </div>
              </div>

              <div className="flex flex-col gap-4 rounded-2xl border border-stone-800 bg-stone-900/70 p-4 sm:flex-row sm:items-center">
                <MemberAvatar
                  className="size-20"
                  image={user?.image}
                  label={user?.name ?? user?.email ?? t("Authenticated user")}
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-stone-100">{t("Your picture")}</p>
                  <p className="mt-1 text-xs leading-5 text-stone-400">
                    {t("JPEG, PNG, or WebP, up to 5 MB.")}
                  </p>
                  <input
                    ref={profileImageInputRef}
                    accept="image/jpeg,image/png,image/webp"
                    aria-label={t("Choose your profile picture")}
                    className="hidden"
                    disabled={submitting}
                    onChange={onProfileImageSelected}
                    type="file"
                  />
                  <div className="mt-3 grid gap-2 sm:flex sm:flex-wrap">
                    <button
                      className="min-h-11 rounded-xl border border-amber-300/60 px-3 py-2 text-sm text-amber-100 transition hover:border-amber-200 disabled:opacity-50"
                      disabled={submitting}
                      onClick={() => profileImageInputRef.current?.click()}
                      type="button"
                    >
                      {t(user?.image ? "Update picture" : "Add picture")}
                    </button>
                    {user?.image ? (
                      <button
                        className="min-h-11 rounded-xl border border-rose-400/40 px-3 py-2 text-sm text-rose-100 transition hover:border-rose-300 disabled:opacity-50"
                        disabled={submitting}
                        onClick={() => void onRemoveProfileImage()}
                        type="button"
                      >
                        {t("Remove picture")}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>

              <form className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]" onSubmit={onUpdateName}>
                <input aria-label={t("Your name")} autoComplete="name" className="min-h-11 min-w-0 rounded-xl border border-stone-700 bg-stone-950 px-3 py-2 text-sm text-stone-50 outline-none transition focus:border-amber-300 focus-visible:ring-2 focus-visible:ring-amber-300/30" minLength={2} onChange={(event) => setDisplayName(event.target.value)} placeholder={t("How should your family see you?")} required value={displayName} />
                <button className="min-h-11 rounded-xl border border-amber-300/60 px-3 py-2 text-sm text-amber-100 transition hover:border-amber-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-amber-200 disabled:opacity-50" disabled={submitting} type="submit">{t("Save name")}</button>
              </form>

              <form className="space-y-3" onSubmit={onCreateFamily}>
                <label className="block">
                  <span className="mb-2 block text-sm text-stone-300">
                    {t("Create a family")}
                  </span>
                  <input
                    autoComplete="organization"
                    className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                    id="family-name"
                    name="familyName"
                    onChange={(event) => setFamilyName(event.target.value)}
                    placeholder={t("Korhonen family")}
                    required
                    value={familyName}
                  />
                </label>
                <button
                  className="w-full rounded-2xl bg-stone-100 px-4 py-3 font-medium text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  {t("Create family")}
                </button>
              </form>

              <form className="space-y-3" onSubmit={onJoinFamily}>
                <label className="block">
                  <span className="mb-2 block text-sm text-stone-300">
                    {t("Join with invite code")}
                  </span>
                  <input
                    autoComplete="off"
                    className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 uppercase outline-none transition focus:border-amber-300"
                    id="invite-code"
                    name="inviteCode"
                    onChange={(event) =>
                      setInviteCode(event.target.value.toUpperCase())
                    }
                    placeholder="ABC123"
                    required
                    value={inviteCode}
                  />
                </label>
                <button
                  className="w-full rounded-2xl border border-stone-600 px-4 py-3 font-medium text-stone-100 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  {t("Join family")}
                </button>
              </form>
            </div>
              </aside>
            </>
          ) : null}
        </div>
      </Authenticated>

      {status ? <div aria-live="polite" className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-1/2 z-70 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 break-words rounded-2xl border border-amber-300/30 bg-stone-900/95 px-4 py-3 text-center text-sm text-stone-100 shadow-2xl shadow-black/40 backdrop-blur" role="status">{status}</div> : null}
    </div>
  );
}
