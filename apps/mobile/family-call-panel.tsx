import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  PermissionsAndroid,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  mediaDevices,
  MediaStream,
  RTCPeerConnection,
  RTCView,
} from "react-native-webrtc";
import {
  dismissNativeCall,
  initializeNativeCallService,
  markNativeCallActive,
  setNativeCallHandlers,
  showIncomingNativeCall,
  showOutgoingNativeCall,
} from "./native-call-service";

type Member = {
  email: string | null;
  isOnline: boolean;
  name: string | null;
  userId: Id<"users">;
};

type Props = {
  currentUserId: Id<"users">;
  familyId: Id<"families">;
  members: Member[];
};

type CallSnapshot = {
  call: null | {
    _id: Id<"calls">;
    answerSdp?: string;
    calleeId: Id<"users">;
    callerId: Id<"users">;
    offerSdp: string;
    nativeCallId?: string;
    status: "active" | "declined" | "ended" | "ringing";
  };
  candidates: Array<{
    _id: Id<"callIceCandidates">;
    candidate: string;
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

export function FamilyCallPanel({ currentUserId, familyId, members }: Props) {
  const connectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const callIdRef = useRef<Id<"calls"> | null>(null);
  const remoteUserIdRef = useRef<Id<"users"> | null>(null);
  const answeredCallIdRef = useRef<Id<"calls"> | null>(null);
  const processedCandidateIdsRef = useRef<Set<Id<"callIceCandidates">>>(new Set());
  const pendingCandidatesRef = useRef<PendingCandidate[]>([]);
  const remoteTracksRef = useRef<Map<string, RemoteTrack>>(new Map());
  const watchRef = useRef<CallSnapshot | undefined>(undefined);
  const nativeCallIdRef = useRef<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const getIceServers = useAction(api.callCredentials.getIceServers);
  const startCall = useMutation(api.calls.start);
  const answerCall = useMutation(api.calls.answer);
  const declineCall = useMutation(api.calls.decline);
  const endCall = useMutation(api.calls.end);
  const addIceCandidate = useMutation(api.calls.addIceCandidate);
  const callState = useQuery(api.calls.watch, { familyId }) as CallSnapshot | undefined;
  watchRef.current = callState;

  const activeCall = callState?.call ?? null;
  const incomingCall = activeCall?.status === "ringing" && activeCall.calleeId === currentUserId ? activeCall : null;
  const remoteUserId = activeCall
    ? activeCall.callerId === currentUserId ? activeCall.calleeId : activeCall.callerId
    : null;
  const remoteMember = members.find((member) => member.userId === remoteUserId);
  const onlineMembers = members.filter((member) => member.userId !== currentUserId && member.isOnline);

  const teardown = () => {
    connectionRef.current?.close();
    connectionRef.current = null;
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStream(null);
    callIdRef.current = null;
    remoteUserIdRef.current = null;
    answeredCallIdRef.current = null;
    processedCandidateIdsRef.current = new Set();
    pendingCandidatesRef.current = [];
    remoteTracksRef.current = new Map();
  };

  const ensureLocalStream = async () => {
    if (localStreamRef.current) return localStreamRef.current;
    const stream = await requestCameraAndMicrophone();
    localStreamRef.current = stream;
    setLocalStream(stream);
    return stream;
  };

  const sendCandidate = async (candidate: PendingCandidate) => {
    if (!callIdRef.current || !remoteUserIdRef.current) {
      pendingCandidatesRef.current.push(candidate);
      return;
    }
    await addIceCandidate({ callId: callIdRef.current, recipientId: remoteUserIdRef.current, ...candidate });
  };

  const flushPendingCandidates = async () => {
    const candidates = pendingCandidatesRef.current;
    pendingCandidatesRef.current = [];
    for (const candidate of candidates) await sendCandidate(candidate);
  };

  const flushRemoteCandidates = async () => {
    const connection = connectionRef.current;
    const candidates = watchRef.current?.candidates ?? [];
    if (!connection) return;
    for (const candidate of candidates) {
      if (processedCandidateIdsRef.current.has(candidate._id)) continue;
      await connection.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid,
        sdpMLineIndex: candidate.sdpMLineIndex,
        usernameFragment: candidate.usernameFragment,
      });
      processedCandidateIdsRef.current.add(candidate._id);
    }
  };

  const createConnection = async (otherUserId: Id<"users">) => {
    const { iceServers } = await getIceServers({});
    const connection = new RTCPeerConnection({ iceServers });
    const stream = await ensureLocalStream();
    stream.getTracks().forEach((track) => connection.addTrack(track, stream));
    const events = connection as unknown as NativeConnectionEvents;
    events.ontrack = (event) => {
      const remoteTracks = event.track ? [event.track] : event.streams[0]?.getTracks() ?? [];
      for (const track of remoteTracks) {
        remoteTracksRef.current.set(track.id, track);
      }
      const nextRemoteStream = new MediaStream();
      for (const track of remoteTracksRef.current.values()) {
        nextRemoteStream.addTrack(track);
      }
      setRemoteStream(nextRemoteStream);
    };
    events.onicecandidate = (event) => {
      if (!event.candidate) return;
      void sendCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: event.candidate.usernameFragment ?? undefined,
      }).catch((candidateError) => setError(candidateError instanceof Error ? candidateError.message : "Could not send network details."));
    };
    events.onconnectionstatechange = () => {
      if (connection.connectionState === "failed") setError("The call connection failed. Try again.");
    };
    connectionRef.current = connection;
    remoteUserIdRef.current = otherUserId;
    return connection;
  };

  useEffect(() => {
    if (activeCall === null) {
      if (callIdRef.current) teardown();
      return;
    }
    callIdRef.current = activeCall._id;
    remoteUserIdRef.current = activeCall.callerId === currentUserId ? activeCall.calleeId : activeCall.callerId;
  }, [activeCall, currentUserId]);

  const declineIncomingCall = async (callId: Id<"calls">) => {
    setBusy(true); setError(null);
    try { await declineCall({ callId }); }
    catch (callError) { setError(callError instanceof Error ? callError.message : "Could not decline the call."); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    const sync = async () => {
      if (!activeCall || !connectionRef.current) return;
      if (activeCall.status === "active" && activeCall.callerId === currentUserId && activeCall.answerSdp && answeredCallIdRef.current !== activeCall._id) {
        answeredCallIdRef.current = activeCall._id;
        try {
          await connectionRef.current.setRemoteDescription(parseDescription(activeCall.answerSdp));
        } catch (error) {
          answeredCallIdRef.current = null;
          throw error;
        }
      }
      await flushRemoteCandidates();
    };
    void sync().catch((syncError) => setError(syncError instanceof Error ? syncError.message : "Could not sync call state."));
  }, [activeCall, callState, currentUserId]);

  useEffect(() => () => teardown(), []);

  const beginCall = async (calleeId: Id<"users">) => {
    setBusy(true); setError(null);
    try {
      const connection = await createConnection(calleeId);
      const offer = await connection.createOffer();
      await connection.setLocalDescription(offer);
      const callId = await startCall({ familyId, calleeId, offerSdp: serializeDescription(offer) });
      callIdRef.current = callId;
      await flushPendingCandidates();
    } catch (callError) {
      teardown(); setError(callError instanceof Error ? callError.message : "Could not start the call.");
    } finally { setBusy(false); }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    setBusy(true); setError(null);
    try {
      const connection = await createConnection(incomingCall.callerId);
      await connection.setRemoteDescription(parseDescription(incomingCall.offerSdp));
      await flushRemoteCandidates();
      const answer = await connection.createAnswer();
      await connection.setLocalDescription(answer);
      await answerCall({ callId: incomingCall._id, answerSdp: serializeDescription(answer) });
      answeredCallIdRef.current = incomingCall._id;
      await flushPendingCandidates();
      await flushRemoteCandidates();
    } catch (callError) {
      teardown(); setError(callError instanceof Error ? callError.message : "Could not answer the call.");
    } finally { setBusy(false); }
  };

  useEffect(() => {
    void initializeNativeCallService().catch((setupError) => {
      setError(setupError instanceof Error ? setupError.message : "Could not set up native calling.");
    });

    return setNativeCallHandlers({
      onAnswer: (callId) => {
        const call = watchRef.current?.call;
        if (call?._id === callId && call.status === "ringing" && call.calleeId === currentUserId) {
          void acceptCall();
        }
      },
      onEnd: (callId) => {
        const call = watchRef.current?.call;
        if (!call || call._id !== callId) return;
        if (call.status === "ringing" && call.calleeId === currentUserId) void declineIncomingCall(call._id);
        else void hangUp();
      },
    });
  }, [currentUserId]);

  useEffect(() => {
    const previousNativeCallId = nativeCallIdRef.current;
    if (!activeCall?.nativeCallId) {
      if (previousNativeCallId) dismissNativeCall(previousNativeCallId);
      nativeCallIdRef.current = null;
      return;
    }

    nativeCallIdRef.current = activeCall.nativeCallId;
    const callerName = labelFor(remoteMember);
    if (activeCall.status === "ringing") {
      if (activeCall.calleeId === currentUserId) {
        void showIncomingNativeCall({ callId: activeCall._id, nativeCallId: activeCall.nativeCallId, callerName });
      } else {
        void showOutgoingNativeCall({ callId: activeCall._id, nativeCallId: activeCall.nativeCallId, callerName });
      }
    } else if (activeCall.status === "active") {
      markNativeCallActive(activeCall.nativeCallId);
    }
  }, [activeCall, currentUserId, remoteMember]);

  const hangUp = async () => {
    if (!activeCall) return;
    setBusy(true); setError(null);
    try { await endCall({ callId: activeCall._id }); } catch (callError) { setError(callError instanceof Error ? callError.message : "Could not end the call."); }
    finally { teardown(); setBusy(false); }
  };

  const isConnected = activeCall?.status === "active";

  return <>
    <Modal animationType="fade" onRequestClose={() => void hangUp()} statusBarTranslucent visible={isConnected}>
      <View style={styles.fullScreenCall}>
        {remoteStream ? <RTCView mirror={false} objectFit="cover" streamURL={remoteStream.toURL()} style={styles.fullScreenVideo} /> : <Text style={styles.waiting}>Connecting video to {labelFor(remoteMember)}â€¦</Text>}
        {localStream ? <View style={styles.fullScreenLocal}><RTCView mirror objectFit="cover" streamURL={localStream.toURL()} style={styles.rtcView} /></View> : null}
        <View style={styles.fullScreenControls}><Action danger disabled={busy} label="End call" onPress={() => void hangUp()} /></View>
      </View>
    </Modal>
  <View style={styles.panel}>
    <Text style={styles.kicker}>FAMILY CALLS</Text>
    <Text style={styles.title}>{activeCall ? `Calling ${labelFor(remoteMember)}` : "Face-to-face check-ins"}</Text>
    {error ? <Text style={styles.error}>{error}</Text> : null}
    {incomingCall ? <View style={styles.incoming}><Text style={styles.incomingText}>{labelFor(remoteMember)} is calling you</Text><View style={styles.row}><Action label="Answer" onPress={() => void acceptCall()} disabled={busy} /><Action label="Decline" onPress={() => void declineIncomingCall(incomingCall._id)} disabled={busy} secondary /></View></View> : null}
    {activeCall && !isConnected ? <>
      <View style={styles.videoGrid}>
        <View style={styles.video}>{remoteStream ? <RTCView mirror={false} objectFit="cover" streamURL={remoteStream.toURL()} style={styles.rtcView} /> : <Text style={styles.waiting}>Waiting for {labelFor(remoteMember)}…</Text>}</View>
        <View style={styles.localVideo}>{localStream ? <RTCView mirror objectFit="cover" streamURL={localStream.toURL()} style={styles.rtcView} /> : null}</View>
      </View>
      <Action label="Hang up" onPress={() => void hangUp()} disabled={busy} danger />
    </> : !incomingCall ? <View style={styles.members}>{onlineMembers.length === 0 ? <Text style={styles.waiting}>No other family members are online right now.</Text> : onlineMembers.map((member) => <Action key={member.userId} label={`Call ${labelFor(member)}`} onPress={() => void beginCall(member.userId)} disabled={busy} />)}</View> : null}
    {busy ? <ActivityIndicator color="#bae6fd" style={styles.spinner} /> : null}
  </View>
  </>;
}

function Action({ label, onPress, disabled, secondary, danger }: { label: string; onPress: () => void; disabled?: boolean; secondary?: boolean; danger?: boolean }) {
  return <Pressable disabled={disabled} onPress={onPress} style={[styles.button, secondary ? styles.secondaryButton : danger ? styles.dangerButton : styles.primaryButton, disabled && styles.disabled]}><Text style={secondary ? styles.secondaryText : styles.buttonText}>{label}</Text></Pressable>;
}

const styles = StyleSheet.create({
  panel: { backgroundColor: "#082f49", borderColor: "#0ea5e9", borderRadius: 24, borderWidth: 1, gap: 12, padding: 18 },
  fullScreenCall: { alignItems: "center", backgroundColor: "#020617", flex: 1, justifyContent: "center" }, fullScreenVideo: { height: "100%", width: "100%" }, fullScreenLocal: { borderColor: "#e0f2fe", borderRadius: 14, borderWidth: 1, height: 150, overflow: "hidden", position: "absolute", right: 18, top: 54, width: 108 }, fullScreenControls: { bottom: 34, left: 24, position: "absolute", right: 24 },
  kicker: { color: "#bae6fd", fontSize: 12, fontWeight: "700", letterSpacing: 2 }, title: { color: "#f8fafc", fontSize: 21, fontWeight: "700" }, error: { color: "#fecdd3", fontSize: 14 }, incoming: { backgroundColor: "#1c1917", borderRadius: 16, gap: 12, padding: 14 }, incomingText: { color: "#f8fafc", fontSize: 16, fontWeight: "600" }, row: { flexDirection: "row", gap: 10 }, members: { gap: 10 }, button: { alignItems: "center", borderRadius: 14, flex: 1, padding: 13 }, primaryButton: { backgroundColor: "#7dd3fc" }, secondaryButton: { borderColor: "#94a3b8", borderWidth: 1 }, dangerButton: { backgroundColor: "#be123c" }, buttonText: { color: "#082f49", fontWeight: "700" }, secondaryText: { color: "#e2e8f0", fontWeight: "700" }, disabled: { opacity: 0.5 }, videoGrid: { backgroundColor: "#020617", borderRadius: 16, height: 260, overflow: "hidden", position: "relative" }, video: { alignItems: "center", flex: 1, justifyContent: "center" }, localVideo: { borderColor: "#e0f2fe", borderRadius: 12, borderWidth: 1, bottom: 10, height: 88, overflow: "hidden", position: "absolute", right: 10, width: 116 }, rtcView: { flex: 1 }, waiting: { color: "#cbd5e1", fontSize: 14, textAlign: "center" }, spinner: { marginTop: 4 },
});
