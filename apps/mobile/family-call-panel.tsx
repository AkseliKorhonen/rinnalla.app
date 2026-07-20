import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCView,
} from "react-native-webrtc";
import { shouldAutoAnswerCall } from "./auto-answer-policy";
import {
  bringCallAppToForeground,
  claimIncomingCallInApp,
  clearCallAppLockScreenVisibility,
  dismissNativeCall,
  dismissResolvedIncomingCall,
  initializeNativeCallService,
  markNativeCallActive,
  resumeIncomingCallAlert,
  setNativeCallHandlers,
  showIncomingCall,
  waitForCallAppForeground,
} from "./native-call-service";
import { MemberAvatar } from "./member-avatar";
import { useResponsiveLayout } from "./responsive-layout";

type Member = {
  email: string | null;
  image: string | null;
  name: string | null;
  userId: Id<"users">;
};

type Props = {
  autoAnswerCalls: boolean;
  currentUserId: Id<"users">;
  deviceId: string;
  familyId: Id<"families">;
  members: Member[];
  onCallSurfaceChange?: (visible: boolean) => void;
  onSelectFamily: (familyId: string) => void;
};

type CallSnapshot = {
  call: null | {
    _id: Id<"calls">;
    answerSdp?: string;
    answeredByDeviceId?: string;
    calleeId: Id<"users">;
    callerDeviceId?: string;
    callerId: Id<"users">;
    offerSdp: string;
    nativeCallId?: string;
    status: "active" | "declined" | "ended" | "ringing";
  };
  candidates: Array<{
    _id: Id<"callIceCandidates">;
    candidate: string;
    senderDeviceId?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
    usernameFragment?: string;
  }>;
};

type PendingCandidate = {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
};

type RemoteTrack = ReturnType<MediaStream["getTracks"]>[number];

type Call = NonNullable<CallSnapshot["call"]>;

function isCallOwnedByDevice(
  call: Call,
  currentUserId: Id<"users">,
  deviceId: string,
  locallyOwnedCallId: Id<"calls"> | null,
) {
  if (call.callerId === currentUserId) {
    return call.callerDeviceId === undefined
      ? locallyOwnedCallId === call._id
      : call.callerDeviceId === deviceId;
  }

  if (call.status !== "active") return false;
  return call.answeredByDeviceId === undefined
    ? locallyOwnedCallId === call._id
    : call.answeredByDeviceId === deviceId;
}

function expectedRemoteDeviceId(call: Call, currentUserId: Id<"users">) {
  return call.callerId === currentUserId
    ? call.answeredByDeviceId
    : call.callerDeviceId;
}

type NativeConnectionEvents = {
  onconnectionstatechange: (() => void) | null;
  onicecandidate: ((event: {
    candidate: null | {
      candidate: string;
      sdpMLineIndex?: number | null;
      sdpMid?: string | null;
      usernameFragment?: string | null;
    };
  }) => void) | null;
  ontrack: ((event: { streams: MediaStream[]; track?: RemoteTrack }) => void) | null;
};

function labelFor(member: Member | undefined) {
  return member?.name ?? member?.email ?? "Family member";
}

function serializeDescription(description: { type?: string; sdp?: string }) {
  return JSON.stringify({ type: description.type, sdp: description.sdp ?? "" });
}

function parseDescription(serialized: string) {
  return JSON.parse(serialized) as { type: "answer" | "offer"; sdp: string };
}

function releaseLocalMediaStream(stream: MediaStream) {
  stream.getTracks().forEach((track) => track.stop());
  stream.release();
}

async function requestCameraAndMicrophone() {
  if (Platform.OS === "android") {
    const result = await PermissionsAndroid.requestMultiple([
      PermissionsAndroid.PERMISSIONS.CAMERA,
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    ]);
    if (
      result[PermissionsAndroid.PERMISSIONS.CAMERA] !== PermissionsAndroid.RESULTS.GRANTED ||
      result[PermissionsAndroid.PERMISSIONS.RECORD_AUDIO] !== PermissionsAndroid.RESULTS.GRANTED
    ) {
      throw new Error("Camera and microphone access is required for calls.");
    }
  }
  return await mediaDevices.getUserMedia({ audio: true, video: { facingMode: "user" } });
}

export function FamilyCallPanel({
  autoAnswerCalls,
  currentUserId,
  deviceId,
  familyId,
  members,
  onCallSurfaceChange,
  onSelectFamily,
}: Props) {
  const insets = useSafeAreaInsets();
  const {
    height,
    isCompactLandscape,
    isLandscape,
    isTablet,
    width,
  } = useResponsiveLayout();
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const mediaRequestGenerationRef = useRef(0);
  const callGenerationRef = useRef(0);
  const callIdRef = useRef<Id<"calls"> | null>(null);
  const remoteUserIdRef = useRef<Id<"users"> | null>(null);
  const answeredCallIdRef = useRef<Id<"calls"> | null>(null);
  const locallyOwnedCallIdRef = useRef<Id<"calls"> | null>(null);
  const resolvedElsewhereCallIdRef = useRef<Id<"calls"> | null>(null);
  const acceptingCallIdRef = useRef<Id<"calls"> | null>(null);
  const processedCandidateIdsRef = useRef<Set<Id<"callIceCandidates">>>(new Set());
  const pendingCandidatesRef = useRef<PendingCandidate[]>([]);
  const remoteFallbackStreamRef = useRef<MediaStream | null>(null);
  const syncQueueRef = useRef<Promise<void>>(Promise.resolve());
  const watchRef = useRef<CallSnapshot | undefined>(undefined);
  const nativeCallIdRef = useRef<string | null>(null);
  const resolvedNativeCallIdRef = useRef<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [answeringCallId, setAnsweringCallId] = useState<Id<"calls"> | null>(null);
  const [locallyOwnedCallId, setLocallyOwnedCallId] = useState<Id<"calls"> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [appState, setAppState] = useState(AppState.currentState);
  const getIceServers = useAction(api.callCredentials.getIceServers);
  const startCall = useMutation(api.calls.start);
  const answerCall = useMutation(api.calls.answer);
  const declineCall = useMutation(api.calls.decline);
  const endCall = useMutation(api.calls.end);
  const addIceCandidate = useMutation(api.calls.addIceCandidate);
  const callState = useQuery(api.calls.watch, { deviceId, familyId }) as CallSnapshot | undefined;
  watchRef.current = callState;

  const activeCall = callState?.call ?? null;
  const incomingCall = activeCall?.status === "ringing" && activeCall.calleeId === currentUserId ? activeCall : null;
  const remoteUserId = activeCall
    ? activeCall.callerId === currentUserId ? activeCall.calleeId : activeCall.callerId
    : null;
  const remoteMember = members.find((member) => member.userId === remoteUserId);
  const callableMembers = members.filter((member) => member.userId !== currentUserId);
  const isOwnedCall = activeCall
    ? isCallOwnedByDevice(
        activeCall,
        currentUserId,
        deviceId,
        locallyOwnedCallId,
      )
    : false;
  const isCallOnAnotherDevice = activeCall !== null && !incomingCall && !isOwnedCall;

  useEffect(() => {
    const subscription = AppState.addEventListener("change", setAppState);
    return () => subscription.remove();
  }, []);

  const teardown = (dismissNativePresentation = true) => {
    mediaRequestGenerationRef.current += 1;
    callGenerationRef.current += 1;
    syncQueueRef.current = Promise.resolve();
    const nativeCallId = nativeCallIdRef.current ?? activeCall?.nativeCallId ?? null;
    nativeCallIdRef.current = null;
    if (nativeCallId && dismissNativePresentation) dismissNativeCall(nativeCallId);
    else clearCallAppLockScreenVisibility();
    connectionRef.current?.close();
    connectionRef.current = null;
    if (localStreamRef.current) releaseLocalMediaStream(localStreamRef.current);
    localStreamRef.current = null;
    localStreamPromiseRef.current = null;
    remoteFallbackStreamRef.current?.release();
    remoteFallbackStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    setAnsweringCallId(null);
    setBusy(false);
    callIdRef.current = null;
    remoteUserIdRef.current = null;
    answeredCallIdRef.current = null;
    locallyOwnedCallIdRef.current = null;
    setLocallyOwnedCallId(null);
    acceptingCallIdRef.current = null;
    processedCandidateIdsRef.current = new Set();
    pendingCandidatesRef.current = [];
  };

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    if (localStreamPromiseRef.current) return await localStreamPromiseRef.current;

    const generation = mediaRequestGenerationRef.current;
    const request = (async () => {
      await waitForCallAppForeground();
      const stream = await requestCameraAndMicrophone();
      if (generation !== mediaRequestGenerationRef.current) {
        releaseLocalMediaStream(stream);
        throw new Error("The call ended before the camera was ready.");
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      return stream;
    })();
    localStreamPromiseRef.current = request;

    try {
      return await request;
    } finally {
      if (localStreamPromiseRef.current === request) localStreamPromiseRef.current = null;
    }
  };

  const sendCandidate = async (candidate: PendingCandidate) => {
    if (!callIdRef.current || !remoteUserIdRef.current) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await addIceCandidate({
      callId: callIdRef.current,
      deviceId,
      recipientId: remoteUserIdRef.current,
      ...candidate,
    });
  };

  const flushPendingCandidates = async () => {
    const generation = callGenerationRef.current;
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of candidates) {
      if (generation !== callGenerationRef.current) return;
      await sendCandidate(candidate);
    }
  };

  const flushRemoteCandidates = async () => {
    const connection = connectionRef.current;
    const candidates = watchRef.current?.candidates ?? [];
    if (!connection?.remoteDescription) return;
    const call = watchRef.current?.call;
    const expectedSenderDeviceId = call
      ? expectedRemoteDeviceId(call, currentUserId)
      : undefined;
    for (const candidate of candidates) {
      if (processedCandidateIdsRef.current.has(candidate._id)) continue;
      if (
        candidate.senderDeviceId !== undefined
        && expectedSenderDeviceId !== undefined
        && candidate.senderDeviceId !== expectedSenderDeviceId
      ) continue;
      processedCandidateIdsRef.current.add(candidate._id);
      try {
        await connection.addIceCandidate({
          candidate: candidate.candidate,
          sdpMid: candidate.sdpMid,
          sdpMLineIndex: candidate.sdpMLineIndex,
          usernameFragment: candidate.usernameFragment,
        });
      } catch (error) {
        processedCandidateIdsRef.current.delete(candidate._id);
        throw error;
      }
    }
  };

  const createConnection = async (otherUserId: Id<"users">) => {
    const generation = callGenerationRef.current;
    const { iceServers } = await getIceServers({});
    if (generation !== callGenerationRef.current) {
      throw new Error("The call ended before the connection was ready.");
    }
    const connection = new RTCPeerConnection({ iceServers });
    connectionRef.current = connection;
    remoteUserIdRef.current = otherUserId;

    let stream: MediaStream;
    try {
      stream = await ensureLocalStream();
      if (
        generation !== callGenerationRef.current ||
        connectionRef.current !== connection
      ) {
        throw new Error("The call ended before the connection was ready.");
      }
      stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    } catch (error) {
      if (connectionRef.current === connection) connectionRef.current = null;
      connection.close();
      throw error;
    }
    const events = connection as unknown as NativeConnectionEvents;
    events.ontrack = (event) => {
      if (connectionRef.current !== connection) return;
      const nativeStream = event.streams[0];
      if (nativeStream) {
        if (event.track?.kind === "video" || nativeStream.getVideoTracks().length > 0) {
          remoteFallbackStreamRef.current?.release();
          remoteFallbackStreamRef.current = null;
          setRemoteStream(nativeStream);
        }
        return;
      }

      const track = event.track;
      if (!track) return;
      const fallback = remoteFallbackStreamRef.current ?? new MediaStream();
      remoteFallbackStreamRef.current = fallback;
      if (!fallback.getTracks().some((candidate) => candidate.id === track.id)) {
        fallback.addTrack(track);
      }
      if (track.kind === "video") {
        setTimeout(() => {
          if (remoteFallbackStreamRef.current === fallback) setRemoteStream(fallback);
        }, 0);
      }
    };
    events.onicecandidate = (event) => {
      if (!event.candidate || connectionRef.current !== connection) return;
      void sendCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: event.candidate.usernameFragment ?? undefined,
      }).catch((candidateError) => setError(candidateError instanceof Error ? candidateError.message : "Could not send network details."));
    };
    events.onconnectionstatechange = () => {
      if (connectionRef.current === connection && connection.connectionState === "failed") {
        setError("The call connection failed. Try again.");
      }
    };
    return connection;
  };

  useEffect(() => {
    if (activeCall === null) {
      const resolvedNativeCallId = nativeCallIdRef.current;
      resolvedElsewhereCallIdRef.current = null;
      if (callIdRef.current) {
        teardown(false);
        if (resolvedNativeCallId) {
          void dismissResolvedIncomingCall(resolvedNativeCallId, "ended");
        }
      }
      return;
    }

    if (isCallOnAnotherDevice) {
      if (resolvedElsewhereCallIdRef.current !== activeCall._id) {
        resolvedElsewhereCallIdRef.current = activeCall._id;
        teardown(false);
      }
      return;
    }

    resolvedElsewhereCallIdRef.current = null;
    callIdRef.current = activeCall._id;
    remoteUserIdRef.current = activeCall.callerId === currentUserId ? activeCall.calleeId : activeCall.callerId;
  }, [activeCall, currentUserId, isCallOnAnotherDevice]);

  const declineIncomingCall = async (call: CallSnapshot["call"] = incomingCall) => {
    if (!call || call.status !== "ringing" || call.calleeId !== currentUserId) return;
    const claimedForegroundCall = call.nativeCallId
      ? claimIncomingCallInApp(call.nativeCallId)
      : false;
    setBusy(true); setError(null);
    try { await declineCall({ callId: call._id, deviceId }); }
    catch (callError) {
      if (
        claimedForegroundCall
        && call.nativeCallId
        && watchRef.current?.call?._id === call._id
        && watchRef.current.call.status === "ringing"
      ) {
        void resumeIncomingCallAlert({
          callId: call._id,
          familyId,
          nativeCallId: call.nativeCallId,
          callerName: labelFor(members.find((member) => member.userId === call.callerId)),
        }).catch(() => undefined);
      }
      setError(callError instanceof Error ? callError.message : "Could not decline the call.");
    }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const generation = callGenerationRef.current;
    const connection = connectionRef.current;
    const sync = async () => {
      if (
        !activeCall ||
        !isOwnedCall ||
        !connection ||
        generation !== callGenerationRef.current ||
        connectionRef.current !== connection ||
        callIdRef.current !== activeCall._id
      ) return;
      if (activeCall.status === "active" && activeCall.callerId === currentUserId && activeCall.answerSdp && answeredCallIdRef.current !== activeCall._id) {
        answeredCallIdRef.current = activeCall._id;
        try {
          await connection.setRemoteDescription(parseDescription(activeCall.answerSdp));
        } catch (error) {
          answeredCallIdRef.current = null;
          throw error;
        }
      }
      if (generation !== callGenerationRef.current || connectionRef.current !== connection) return;
      await flushRemoteCandidates();
    };
    const queuedSync = syncQueueRef.current.catch(() => undefined).then(sync);
    syncQueueRef.current = queuedSync;
    void queuedSync.catch((syncError) => setError(syncError instanceof Error ? syncError.message : "Could not sync call state."));
  }, [activeCall, callState, currentUserId, isOwnedCall]);

  useEffect(() => () => teardown(), []);

  const beginCall = async (calleeId: Id<"users">) => {
    const generation = callGenerationRef.current;
    setBusy(true); setError(null);
    try {
      const connection = await createConnection(calleeId);
      if (generation !== callGenerationRef.current) return;
      const offer = await connection.createOffer();
      if (generation !== callGenerationRef.current) return;
      await connection.setLocalDescription(offer);
      if (generation !== callGenerationRef.current) return;
      const callId = await startCall({
        familyId,
        calleeId,
        deviceId,
        offerSdp: serializeDescription(offer),
      });
      if (generation !== callGenerationRef.current) return;
      callIdRef.current = callId;
      locallyOwnedCallIdRef.current = callId;
      setLocallyOwnedCallId(callId);
      await flushPendingCandidates();
    } catch (callError) {
      if (generation !== callGenerationRef.current) return;
      teardown(); setError(callError instanceof Error ? callError.message : "Could not start the call.");
    } finally {
      if (generation === callGenerationRef.current) setBusy(false);
    }
  };

  const acceptCall = async (call: CallSnapshot["call"] = incomingCall) => {
    if (!call || call.status !== "ringing" || call.calleeId !== currentUserId) return;
    if (acceptingCallIdRef.current === call._id || answeredCallIdRef.current === call._id) return;
    acceptingCallIdRef.current = call._id;
    callIdRef.current = call._id;
    const claimedForegroundCall = call.nativeCallId
      ? claimIncomingCallInApp(call.nativeCallId)
      : false;
    setAnsweringCallId(call._id);
    const generation = callGenerationRef.current;
    let answeredOnServer = false;
    setBusy(true); setError(null);
    try {
      const connection = await createConnection(call.callerId);
      if (generation !== callGenerationRef.current) return;
      await connection.setRemoteDescription(parseDescription(call.offerSdp));
      if (generation !== callGenerationRef.current) return;
      await flushRemoteCandidates();
      if (generation !== callGenerationRef.current) return;
      const answer = await connection.createAnswer();
      if (generation !== callGenerationRef.current) return;
      await connection.setLocalDescription(answer);
      if (generation !== callGenerationRef.current) return;
      await answerCall({
        callId: call._id,
        deviceId,
        answerSdp: serializeDescription(answer),
      });
      answeredOnServer = true;
      if (generation !== callGenerationRef.current) return;
      locallyOwnedCallIdRef.current = call._id;
      setLocallyOwnedCallId(call._id);
      if (call.nativeCallId) markNativeCallActive(call.nativeCallId);
      else bringCallAppToForeground();
      answeredCallIdRef.current = call._id;
      await flushPendingCandidates();
      if (generation !== callGenerationRef.current) return;
      await flushRemoteCandidates();
    } catch (callError) {
      if (generation !== callGenerationRef.current) return;
      if (answeredOnServer) {
        try {
          await endCall({ callId: call._id, deviceId });
        } catch {
          // The stale-call expiry job remains the final fallback if the network is gone.
        }
        if (generation !== callGenerationRef.current) return;
      }
      const wasAnsweredElsewhere =
        !answeredOnServer
        && callError instanceof Error
        && /no longer ringing/i.test(callError.message);
      teardown(!wasAnsweredElsewhere);
      if (wasAnsweredElsewhere && call.nativeCallId) {
        resolvedNativeCallIdRef.current = call.nativeCallId;
        void dismissResolvedIncomingCall(call.nativeCallId, "answered");
      }
      if (
        !answeredOnServer
        && claimedForegroundCall
        && call.nativeCallId
        && watchRef.current?.call?._id === call._id
        && watchRef.current.call.status === "ringing"
      ) {
        void resumeIncomingCallAlert({
          callId: call._id,
          familyId,
          nativeCallId: call.nativeCallId,
          callerName: labelFor(members.find((member) => member.userId === call.callerId)),
        }).catch(() => undefined);
      }
      setError(
        wasAnsweredElsewhere
          ? null
          : callError instanceof Error
            ? callError.message
            : "Could not answer the call.",
      );
    } finally {
      if (acceptingCallIdRef.current === call._id) acceptingCallIdRef.current = null;
      if (generation === callGenerationRef.current) setBusy(false);
    }
  };

  useEffect(() => {
    void initializeNativeCallService().catch((setupError) => {
      setError(setupError instanceof Error ? setupError.message : "Could not set up native calling.");
    });

    return setNativeCallHandlers({
      onAnswer: (callId, nativeFamilyId) => {
        if (nativeFamilyId && nativeFamilyId !== familyId) {
          onSelectFamily(nativeFamilyId);
          return false;
        }
        const snapshot = watchRef.current;
        if (snapshot === undefined) return false;
        const call = snapshot.call;
        if (call?._id === callId && call.status === "ringing" && call.calleeId === currentUserId) {
          void acceptCall(call);
          return true;
        }
        if (call?._id === callId && call.status === "active") {
          const ownsCall = isCallOwnedByDevice(
            call,
            currentUserId,
            deviceId,
            locallyOwnedCallIdRef.current,
          );
          if (
            !ownsCall
            && call.nativeCallId
            && resolvedNativeCallIdRef.current !== call.nativeCallId
          ) {
            resolvedNativeCallIdRef.current = call.nativeCallId;
            void dismissResolvedIncomingCall(call.nativeCallId, "answered");
          }
          return true;
        }
        return false;
      },
      onEnd: (callId, nativeFamilyId) => {
        if (nativeFamilyId && nativeFamilyId !== familyId) {
          onSelectFamily(nativeFamilyId);
          return false;
        }
        const snapshot = watchRef.current;
        if (snapshot === undefined) return false;
        const call = snapshot.call;
        if (!call || call._id !== callId) return true;
        if (call.status === "ringing" && call.calleeId === currentUserId) {
          void declineIncomingCall(call);
        } else if (
          isCallOwnedByDevice(
            call,
            currentUserId,
            deviceId,
            locallyOwnedCallIdRef.current,
          )
        ) {
          void hangUp(call);
        } else if (
          call.nativeCallId
          && resolvedNativeCallIdRef.current !== call.nativeCallId
        ) {
          resolvedNativeCallIdRef.current = call.nativeCallId;
          void dismissResolvedIncomingCall(call.nativeCallId, "answered");
        }
        return true;
      },
    });
  }, [currentUserId, deviceId, familyId, onSelectFamily]);

  useEffect(() => {
    const previousNativeCallId = nativeCallIdRef.current;
    const incomingNativeCallId =
      activeCall?.calleeId === currentUserId ? activeCall.nativeCallId : undefined;

    if (previousNativeCallId && previousNativeCallId !== incomingNativeCallId) {
      void dismissResolvedIncomingCall(previousNativeCallId, "ended");
      nativeCallIdRef.current = null;
    }

    if (!incomingNativeCallId || !activeCall) {
      nativeCallIdRef.current = null;
      resolvedNativeCallIdRef.current = null;
      return;
    }

    nativeCallIdRef.current = incomingNativeCallId;
    const callerName = labelFor(remoteMember);
    if (activeCall.status === "ringing") {
      resolvedNativeCallIdRef.current = null;
      void showIncomingCall({ callId: activeCall._id, familyId, nativeCallId: incomingNativeCallId, callerName })
        .then(() => {
          const currentCall = watchRef.current?.call;
          if (
            !shouldAutoAnswerCall(autoAnswerCalls, appState)
            || AppState.currentState !== "active"
            || currentCall?._id !== activeCall._id
            || currentCall.status !== "ringing"
            || currentCall.calleeId !== currentUserId
          ) return;
          void acceptCall(currentCall);
        })
        .catch((callError) => setError(callError instanceof Error ? callError.message : "Could not alert you to the incoming call."));
    } else if (activeCall.status === "active") {
      if (isOwnedCall) {
        resolvedNativeCallIdRef.current = null;
        markNativeCallActive(incomingNativeCallId);
      } else {
        nativeCallIdRef.current = null;
        if (resolvedNativeCallIdRef.current !== incomingNativeCallId) {
          resolvedNativeCallIdRef.current = incomingNativeCallId;
          void dismissResolvedIncomingCall(incomingNativeCallId, "answered");
        }
      }
    }
  }, [activeCall, appState, autoAnswerCalls, currentUserId, familyId, isOwnedCall, remoteMember]);

  const hangUp = async (call: CallSnapshot["call"] = activeCall) => {
    if (
      !call
      || !isCallOwnedByDevice(
        call,
        currentUserId,
        deviceId,
        locallyOwnedCallIdRef.current,
      )
    ) return;
    setBusy(true); setError(null);
    try { await endCall({ callId: call._id, deviceId }); } catch (callError) { setError(callError instanceof Error ? callError.message : "Could not end the call."); }
    finally { teardown(); setBusy(false); }
  };

  const isConnected = activeCall?.status === "active" && isOwnedCall;
  const isShowingCallScreen =
    isConnected
    || answeringCallId !== null
    || (incomingCall !== null && !isCallOnAnotherDevice);

  useLayoutEffect(() => {
    onCallSurfaceChange?.(isShowingCallScreen);
  }, [isShowingCallScreen, onCallSurfaceChange]);

  const isShowingIncomingPrompt = incomingCall !== null && answeringCallId === null;
  const callOnAnotherDeviceMessage =
    activeCall?.status === "active" && activeCall.calleeId === currentUserId
      ? "Answered on another device."
      : activeCall?.status === "ringing"
        ? "This call was started on another device."
        : "This call is active on another device.";

  const localPreviewWidth = isTablet
    ? (isLandscape ? 210 : 168)
    : (isCompactLandscape ? 128 : 112);
  const localPreviewHeight = isTablet
    ? (isLandscape ? 148 : 224)
    : (isCompactLandscape ? 88 : 150);
  const embeddedVideoHeight = Math.max(
    180,
    Math.min(isTablet ? 360 : 280, Math.round(width * (isLandscape ? 0.42 : 0.62))),
  );

  return <>
    <Modal
      animationType="fade"
      hardwareAccelerated
      navigationBarTranslucent
      onRequestClose={() => {
        if (busy) return;
        if (incomingCall) void declineIncomingCall();
        else void hangUp();
      }}
      presentationStyle="fullScreen"
      statusBarTranslucent
      supportedOrientations={[
        "portrait",
        "portrait-upside-down",
        "landscape",
        "landscape-left",
        "landscape-right",
      ]}
      visible={isShowingCallScreen}
    >
      <View style={styles.fullScreenCall}>
        {isConnected && remoteStream ? (
          <RTCView
            mirror={false}
            objectFit="cover"
            streamURL={remoteStream.toURL()}
            style={styles.fullScreenVideo}
            zOrder={0}
          />
        ) : (
          <View style={styles.fullScreenBackdrop} />
        )}

        {isShowingIncomingPrompt ? (
          <ScrollView
            bounces={false}
            contentContainerStyle={[
              styles.callPromptScroll,
              {
                minHeight: height,
                paddingBottom: Math.max(insets.bottom + 18, 24),
                paddingLeft: Math.max(insets.left + 18, 24),
                paddingRight: Math.max(insets.right + 18, 24),
                paddingTop: Math.max(insets.top + 18, 24),
              },
            ]}
            style={StyleSheet.absoluteFill}
          >
            <View style={[styles.callPrompt, isCompactLandscape && styles.callPromptCompact]}>
              <MemberAvatar
                image={remoteMember?.image}
                label={labelFor(remoteMember)}
                size={isCompactLandscape ? 64 : 88}
              />
              <Text style={styles.callPromptKicker}>INCOMING FAMILY CALL</Text>
              <Text accessibilityRole="header" style={[styles.callPromptTitle, isCompactLandscape && styles.callPromptTitleCompact]}>
                {labelFor(remoteMember)} is calling
              </Text>
              <Text style={styles.callPromptText}>Answer to start your private video call.</Text>
              {error ? <Text accessibilityLiveRegion="assertive" style={styles.callModalErrorText}>{error}</Text> : null}
              <View style={styles.callPromptActions}>
                <Action label="Answer" onPress={() => void acceptCall()} disabled={busy} />
                <Action label="Decline" onPress={() => void declineIncomingCall()} disabled={busy} secondary />
              </View>
              {busy ? <ActivityIndicator color="#bae6fd" /> : null}
            </View>
          </ScrollView>
        ) : !isConnected || !remoteStream ? (
          <ScrollView
            bounces={false}
            contentContainerStyle={[
              styles.connectingCall,
              {
                minHeight: height,
                paddingBottom: Math.max(insets.bottom + 24, 32),
                paddingLeft: Math.max(insets.left + 24, 24),
                paddingRight: Math.max(insets.right + 24, 24),
                paddingTop: Math.max(insets.top + 24, 32),
              },
            ]}
            style={StyleSheet.absoluteFill}
          >
            <MemberAvatar
              image={remoteMember?.image}
              label={labelFor(remoteMember)}
              size={72}
            />
            <ActivityIndicator color="#bae6fd" size="large" />
            <Text style={styles.waiting}>Connecting video to {labelFor(remoteMember)}…</Text>
            {error ? <Text accessibilityLiveRegion="assertive" style={styles.callModalErrorText}>{error}</Text> : null}
          </ScrollView>
        ) : null}

        {isConnected && remoteStream && error ? (
          <View
            accessibilityLiveRegion="assertive"
            style={[
              styles.fullScreenError,
              {
                left: Math.max(insets.left + 16, 20),
                top: Math.max(insets.top + 16, 20),
                width: Math.max(180, Math.min(520, width - localPreviewWidth - 56)),
              },
            ]}
          >
            <Text style={styles.fullScreenErrorText}>{error}</Text>
          </View>
        ) : null}

        {isConnected && localStream ? (
          <View
            style={[
              styles.fullScreenLocal,
              {
                height: localPreviewHeight,
                right: Math.max(insets.right + 14, 18),
                top: Math.max(insets.top + 14, 18),
                width: localPreviewWidth,
              },
            ]}
          >
            <RTCView mirror objectFit="cover" streamURL={localStream.toURL()} style={styles.rtcView} zOrder={1} />
          </View>
        ) : null}
        {isConnected ? (
          <View
            style={[
              styles.fullScreenControls,
              {
                bottom: Math.max(insets.bottom + 16, 24),
                left: Math.max(insets.left + 20, 24),
                right: Math.max(insets.right + 20, 24),
              },
            ]}
          >
            <View style={styles.fullScreenControlInner}>
              <Action danger disabled={busy} label="End call" onPress={() => void hangUp()} />
            </View>
          </View>
        ) : null}
      </View>
    </Modal>
  <View style={[styles.panel, isCompactLandscape && styles.panelCompact]}>
    <Text style={styles.kicker}>FAMILY CALLS</Text>
    <Text style={styles.title}>{isCallOnAnotherDevice ? "Call in progress" : activeCall ? `Calling ${labelFor(remoteMember)}` : "Face-to-face check-ins"}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {isCallOnAnotherDevice ? <View style={styles.resolvedElsewhere}><Text style={styles.resolvedElsewhereText}>{callOnAnotherDeviceMessage}</Text></View> : activeCall && isOwnedCall && !isConnected ? <>
      <View style={[styles.videoGrid, { height: embeddedVideoHeight }]}>
        <View style={styles.video}>{remoteStream ? <RTCView mirror={false} objectFit="cover" streamURL={remoteStream.toURL()} style={styles.rtcView} zOrder={0} /> : <Text style={styles.waiting}>Waiting for {labelFor(remoteMember)}…</Text>}</View>
        <View style={styles.localVideo}>{localStream ? <RTCView mirror objectFit="cover" streamURL={localStream.toURL()} style={styles.rtcView} zOrder={1} /> : null}</View>
      </View>
      <Action label="Hang up" onPress={() => void hangUp()} disabled={busy} danger />
    </> : !incomingCall ? <View style={styles.members}>{callableMembers.length === 0 ? <Text style={styles.waiting}>Add another family member to start a call.</Text> : callableMembers.map((member) => <Action avatar={{ image: member.image, label: labelFor(member) }} key={member.userId} label={`Call ${labelFor(member)}`} onPress={() => void beginCall(member.userId)} disabled={busy} />)}</View> : null}
    {busy ? <ActivityIndicator color="#bae6fd" style={styles.spinner} /> : null}
  </View>
  </>;
}

function Action({ avatar, label, onPress, disabled, secondary, danger }: { avatar?: { image: string | null; label: string }; label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        secondary ? styles.secondaryButton : danger ? styles.dangerButton : styles.primaryButton,
        disabled && styles.disabled,
        pressed && !disabled && styles.pressed,
      ]}
    >
      {avatar ? <MemberAvatar image={avatar.image} label={avatar.label} size={32} /> : null}
      <Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  panel: {
    backgroundColor: "#082f49",
    borderColor: "#0ea5e9",
    borderRadius: 24,
    borderWidth: 1,
    gap: 12,
    padding: 18,
  },
  panelCompact: {
    padding: 14,
  },
  fullScreenCall: {
    alignItems: "center",
    backgroundColor: "#020617",
    flex: 1,
    justifyContent: "center",
  },
  fullScreenBackdrop: {
    backgroundColor: "#020617",
    bottom: 0,
    left: 0,
    position: "absolute",
    right: 0,
    top: 0,
  },
  fullScreenVideo: {
    height: "100%",
    width: "100%",
  },
  fullScreenLocal: {
    backgroundColor: "#0f172a",
    borderColor: "#e0f2fe",
    borderRadius: 14,
    borderWidth: 1,
    elevation: 8,
    overflow: "hidden",
    position: "absolute",
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
  },
  fullScreenControls: {
    alignItems: "center",
    position: "absolute",
  },
  fullScreenControlInner: {
    maxWidth: 420,
    width: "100%",
  },
  fullScreenError: {
    backgroundColor: "rgba(76, 5, 25, 0.94)",
    borderColor: "#fb7185",
    borderRadius: 14,
    borderWidth: 1,
    elevation: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    position: "absolute",
    zIndex: 3,
  },
  fullScreenErrorText: {
    color: "#ffe4e6",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
  },
  connectingCall: {
    alignItems: "center",
    flexGrow: 1,
    gap: 14,
    justifyContent: "center",
  },
  callPromptScroll: {
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
  },
  callPrompt: {
    alignSelf: "center",
    backgroundColor: "rgba(8, 47, 73, 0.97)",
    borderColor: "#38bdf8",
    borderRadius: 26,
    borderWidth: 1,
    gap: 14,
    maxWidth: 520,
    padding: 24,
    width: "100%",
  },
  callPromptCompact: {
    gap: 9,
    maxWidth: 620,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  callPromptKicker: {
    color: "#bae6fd",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
  },
  callPromptTitle: {
    color: "#f8fafc",
    fontSize: 30,
    fontWeight: "700",
    lineHeight: 36,
    textAlign: "center",
  },
  callPromptTitleCompact: {
    fontSize: 24,
    lineHeight: 29,
  },
  callPromptText: {
    color: "#cbd5e1",
    fontSize: 15,
    lineHeight: 21,
    textAlign: "center",
  },
  callModalErrorText: {
    color: "#fecdd3",
    fontSize: 14,
    fontWeight: "600",
    lineHeight: 20,
    textAlign: "center",
  },
  callPromptActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  kicker: {
    color: "#bae6fd",
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 2,
  },
  title: {
    color: "#f8fafc",
    fontSize: 21,
    fontWeight: "700",
    lineHeight: 27,
  },
  error: {
    color: "#fecdd3",
    fontSize: 14,
    lineHeight: 20,
  },
  resolvedElsewhere: {
    backgroundColor: "#0c4a6e",
    borderColor: "#38bdf8",
    borderRadius: 16,
    borderWidth: 1,
    padding: 14,
  },
  resolvedElsewhereText: {
    color: "#e0f2fe",
    fontSize: 15,
    textAlign: "center",
  },
  members: {
    gap: 10,
  },
  button: {
    alignItems: "center",
    borderRadius: 14,
    flex: 1,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 50,
    minWidth: 120,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  primaryButton: {
    backgroundColor: "#7dd3fc",
  },
  secondaryButton: {
    borderColor: "#94a3b8",
    borderWidth: 1,
  },
  dangerButton: {
    backgroundColor: "#be123c",
  },
  buttonText: {
    color: "#082f49",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  secondaryText: {
    color: "#e2e8f0",
    fontSize: 15,
    fontWeight: "700",
    textAlign: "center",
  },
  disabled: {
    opacity: 0.5,
  },
  pressed: {
    opacity: 0.8,
  },
  videoGrid: {
    backgroundColor: "#020617",
    borderRadius: 16,
    minHeight: 180,
    overflow: "hidden",
    position: "relative",
  },
  video: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
  },
  localVideo: {
    borderColor: "#e0f2fe",
    borderRadius: 12,
    borderWidth: 1,
    bottom: 10,
    height: 88,
    overflow: "hidden",
    position: "absolute",
    right: 10,
    width: 116,
  },
  rtcView: {
    flex: 1,
  },
  waiting: {
    color: "#cbd5e1",
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  spinner: {
    marginTop: 4,
  },
});
