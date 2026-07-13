"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import {
  Authenticated,
  AuthLoading,
  Unauthenticated,
  useConvexAuth,
  useMutation,
  useQuery,
} from "convex/react";
import { FormEvent, useEffect, useState } from "react";
import { FamilyCallPanel } from "./family-call-panel";

type Mode = "signIn" | "signUp";
const HEARTBEAT_INTERVAL_MS = 10_000;

function formatPresence(lastSeenAt: number | null) {
  if (lastSeenAt === null) {
    return "Waiting for first check-in";
  }

  const secondsAgo = Math.max(0, Math.round((Date.now() - lastSeenAt) / 1000));
  if (secondsAgo < 15) {
    return "Active just now";
  }
  if (secondsAgo < 60) {
    return "Active less than a minute ago";
  }

  const minutesAgo = Math.round(secondsAgo / 60);
  return `Last seen ${minutesAgo} min ago`;
}

export function AuthPanel() {
  const [mode, setMode] = useState<Mode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [selectedFamilyId, setSelectedFamilyId] = useState<Id<"families"> | null>(
    null,
  );
  const [status, setStatus] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { signIn, signOut } = useAuthActions();
  const { isAuthenticated } = useConvexAuth();
  const user = useQuery(api.users.current);
  const families = useQuery(
    api.families.listMy,
    isAuthenticated ? {} : "skip",
  );
  const createFamily = useMutation(api.families.create);
  const joinFamily = useMutation(api.families.join);
  const heartbeat = useMutation(api.families.heartbeat);
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
    if (!families || families.length === 0) {
      if (selectedFamilyId !== null) {
        setSelectedFamilyId(null);
      }
      return;
    }

    if (
      selectedFamilyId === null ||
      !families.some((family) => family._id === selectedFamilyId)
    ) {
      setSelectedFamilyId(families[0]._id);
    }
  }, [families, selectedFamilyId]);

  useEffect(() => {
    if (!activeFamilyId || !isAuthenticated) {
      return;
    }

    let cancelled = false;
    const sendHeartbeat = async () => {
      try {
        await heartbeat({ familyId: activeFamilyId });
      } catch (error) {
        if (!cancelled) {
          setStatus(
            error instanceof Error
              ? error.message
              : "Could not update online status.",
          );
        }
      }
    };

    void sendHeartbeat();
    const interval = window.setInterval(() => {
      void sendHeartbeat();
    }, HEARTBEAT_INTERVAL_MS);

    const onVisibilityOrFocus = () => {
      if (document.visibilityState === "visible") {
        void sendHeartbeat();
      }
    };

    window.addEventListener("focus", onVisibilityOrFocus);
    document.addEventListener("visibilitychange", onVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
      window.removeEventListener("focus", onVisibilityOrFocus);
      document.removeEventListener("visibilitychange", onVisibilityOrFocus);
    };
  }, [activeFamilyId, heartbeat, isAuthenticated]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSubmitting(true);
    setStatus(null);

    try {
      const result = await signIn("password", {
        flow: mode,
        email,
        password,
      });

      if (result.signingIn) {
        setStatus(mode === "signUp" ? "Account created." : "Signed in.");
      }
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Authentication failed.");
    } finally {
      setSubmitting(false);
    }
  };

  const onSignOut = async () => {
    setSubmitting(true);
    setStatus(null);

    try {
      await signOut();
      setStatus("Signed out.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Sign out failed.");
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
      setStatus("Family created.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not create family.");
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
      setStatus("Joined family.");
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "Could not join family.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="w-full max-w-5xl rounded-[2rem] border border-stone-800 bg-stone-900/95 p-8 shadow-2xl shadow-black/30 backdrop-blur">
      <p className="text-sm uppercase tracking-[0.35em] text-amber-300">
        Vaari Tablet
      </p>
      <h1 className="mt-5 text-4xl font-semibold tracking-tight text-stone-50">
        Hello World
      </h1>
      <p className="mt-3 text-sm leading-6 text-stone-300">
        The web landing page is up, and basic Convex Auth is now wired in.
      </p>

      <AuthLoading>
        <p className="mt-8 text-sm text-stone-400">Checking session...</p>
      </AuthLoading>

      <Unauthenticated>
        <div className="mt-8 flex gap-3">
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === "signIn"
                ? "bg-amber-300 text-stone-950"
                : "border border-stone-700 text-stone-300"
            }`}
            onClick={() => setMode("signIn")}
            type="button"
          >
            Sign In
          </button>
          <button
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${
              mode === "signUp"
                ? "bg-amber-300 text-stone-950"
                : "border border-stone-700 text-stone-300"
            }`}
            onClick={() => setMode("signUp")}
            type="button"
          >
            Create Account
          </button>
        </div>

        <form className="mt-6 space-y-4" onSubmit={onSubmit}>
          <label className="block">
            <span className="mb-2 block text-sm text-stone-300">Email</span>
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
            <span className="mb-2 block text-sm text-stone-300">Password</span>
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
            {submitting
              ? "Working..."
              : mode === "signUp"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
      </Unauthenticated>

      <Authenticated>
        <div className="mt-8 grid gap-6 lg:grid-cols-[1.65fr_1fr]">
          <section className="rounded-3xl border border-emerald-500/20 bg-[radial-gradient(circle_at_top_left,_rgba(16,185,129,0.18),_transparent_35%),linear-gradient(180deg,_rgba(28,25,23,0.96),_rgba(12,10,9,0.96))] p-6">
            <div className="flex flex-col gap-5 border-b border-stone-800 pb-6 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-sm uppercase tracking-[0.32em] text-emerald-300">
                  Family Presence
                </p>
                <h2 className="mt-3 text-3xl font-semibold tracking-tight text-stone-50">
                  {dashboard?.family.name ?? "Who's online right now?"}
                </h2>
                <p className="mt-3 max-w-xl text-sm leading-6 text-stone-300">
                  Keep the tablet open and you will see which family members are
                  available in real time.
                </p>
              </div>
              <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3">
                <p className="text-xs uppercase tracking-[0.28em] text-emerald-200">
                  You
                </p>
                <p className="mt-2 text-base font-medium text-stone-50">
                  {user?.email ?? "Authenticated user"}
                </p>
              </div>
            </div>

            <div className="mt-6">
              {families === undefined ? (
                <p className="text-sm text-stone-400">Loading households...</p>
              ) : families.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-stone-700 bg-stone-950/40 p-6">
                  <p className="text-lg font-semibold text-stone-50">
                    No family connected yet
                  </p>
                  <p className="mt-2 text-sm leading-6 text-stone-400">
                    Create a household or join with an invite code to start
                    seeing live presence.
                  </p>
                </div>
              ) : dashboard === undefined ? (
                <p className="text-sm text-stone-400">
                  Syncing who is online...
                </p>
              ) : (
                <div className="space-y-5">
                  <FamilyCallPanel
                    currentUserId={dashboard.currentUserId}
                    familyId={dashboard.family._id}
                    members={dashboard.members}
                  />

                  <div className="flex flex-wrap gap-3">
                    {families.map((family) => {
                      const isSelected = family._id === activeFamilyId;
                      return (
                        <button
                          key={family._id}
                          className={`rounded-full px-4 py-2 text-sm font-medium transition ${
                            isSelected
                              ? "bg-amber-300 text-stone-950"
                              : "border border-stone-700 text-stone-300 hover:border-stone-500"
                          }`}
                          onClick={() => setSelectedFamilyId(family._id)}
                          type="button"
                        >
                          {family.name}
                        </button>
                      );
                    })}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    {dashboard.members.map((member) => (
                      <article
                        key={member.userId}
                        className={`rounded-3xl border px-5 py-4 transition ${
                          member.isOnline
                            ? "border-emerald-400/30 bg-emerald-400/10"
                            : "border-stone-800 bg-stone-950/70"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <div className="flex items-center gap-3">
                              <span
                                className={`inline-flex h-3 w-3 rounded-full ${
                                  member.isOnline
                                    ? "bg-emerald-300 shadow-[0_0_16px_rgba(110,231,183,0.9)]"
                                    : "bg-stone-600"
                                }`}
                              />
                              <p className="text-lg font-semibold text-stone-50">
                                {member.name ?? member.email ?? "Family member"}
                              </p>
                            </div>
                            <p className="mt-2 text-sm text-stone-400">
                              {member.email ?? "No email available"}
                            </p>
                          </div>
                          <p className="rounded-full border border-stone-700 px-3 py-1 text-xs uppercase tracking-[0.24em] text-stone-300">
                            {member.role}
                          </p>
                        </div>
                        <div className="mt-4 flex items-center justify-between gap-3 text-sm">
                          <p
                            className={
                              member.isOnline
                                ? "text-emerald-200"
                                : "text-stone-400"
                            }
                          >
                            {member.isOnline ? "Online now" : "Offline"}
                          </p>
                          <p className="text-stone-500">
                            {formatPresence(member.lastSeenAt)}
                          </p>
                        </div>
                      </article>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-stone-800 bg-stone-950/70 p-5">
              <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                Households
              </p>
              <div className="mt-4 space-y-3">
                {families === undefined ? (
                  <p className="text-sm text-stone-400">Loading families...</p>
                ) : families.length === 0 ? (
                  <p className="text-sm text-stone-400">
                    Build your first household to unlock presence.
                  </p>
                ) : (
                  families.map((family) => (
                    <div
                      key={family._id}
                      className="rounded-2xl border border-stone-800 bg-stone-900 px-4 py-4"
                    >
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-base font-semibold text-stone-50">
                            {family.name}
                          </p>
                          <p className="mt-1 text-sm text-stone-400">
                            Role: {family.role}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs uppercase tracking-[0.25em] text-stone-500">
                            Invite
                          </p>
                          <p className="mt-1 font-mono text-sm text-amber-300">
                            {family.inviteCode}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="space-y-4 rounded-3xl border border-stone-800 bg-stone-950/70 p-5">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm uppercase tracking-[0.3em] text-stone-400">
                    Setup
                  </p>
                  <h3 className="mt-2 text-xl font-semibold text-stone-50">
                    Manage family access
                  </h3>
                </div>
                <button
                  className="rounded-2xl border border-stone-600 px-4 py-3 text-sm font-medium text-stone-100 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={submitting}
                  onClick={onSignOut}
                  type="button"
                >
                  Sign out
                </button>
              </div>

              <form className="space-y-3" onSubmit={onCreateFamily}>
                <label className="block">
                  <span className="mb-2 block text-sm text-stone-300">
                    Create a family
                  </span>
                  <input
                    autoComplete="organization"
                    className="w-full rounded-2xl border border-stone-700 bg-stone-950 px-4 py-3 text-stone-50 outline-none transition focus:border-amber-300"
                    id="family-name"
                    name="familyName"
                    onChange={(event) => setFamilyName(event.target.value)}
                    placeholder="Korhonen family"
                    required
                    value={familyName}
                  />
                </label>
                <button
                  className="w-full rounded-2xl bg-stone-100 px-4 py-3 font-medium text-stone-950 transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={submitting}
                  type="submit"
                >
                  Create family
                </button>
              </form>

              <form className="space-y-3" onSubmit={onJoinFamily}>
                <label className="block">
                  <span className="mb-2 block text-sm text-stone-300">
                    Join with invite code
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
                  Join family
                </button>
              </form>
            </div>
          </aside>
        </div>
      </Authenticated>

      {status ? <p className="mt-5 text-sm text-stone-300">{status}</p> : null}
    </div>
  );
}
