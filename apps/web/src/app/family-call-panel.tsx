"use client";

import { api } from "../../../../convex/_generated/api";
import type { Id } from "../../../../convex/_generated/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { getOrCreateWebDeviceId } from "./web-device-identity";

type Member = {
  email: string | null;
  image: string | null;
  joinedAt: number;
  name: string | null;
  role: "member" | "owner";
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
    answeredByDeviceId?: string;
    calleeId: Id<"users">;
    callerDeviceId?: string;
    callerId: Id<"users">;
    offerSdp: string;
    status: "active" | "declined" | "ended" | "ringing";
  };
  candidates: Array<{
    _id: Id<"callIceCandidates">;
    candidate: string;
    recipientId: Id<"users">;
    senderDeviceId?: string;
    sdpMid?: string;
    sdpMLineIndex?: number;
    senderId: Id<"users">;
    usernameFragment?: string;
  }>;
};

type PendingIceCandidate = {
  candidate: string;
  sdpMid?: string;
  sdpMLineIndex?: number;
  usernameFragment?: string;
};

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

function subscribeToWebDeviceIdentity() {
  return () => undefined;
}

function getMemberLabel(member: Member | undefined) {
  if (!member) {
    return "Family member";
  }
  return member.name ?? member.email ?? "Family member";
}

function serializeDescription(description: RTCSessionDescriptionInit) {
  return JSON.stringify({
    type: description.type,
    sdp: description.sdp ?? "",
  });
}

function parseDescription(serialized: string): RTCSessionDescriptionInit {
  const parsed = JSON.parse(serialized);
  return {
    type: parsed.type,
    sdp: parsed.sdp,
  };
}

async function requestLocalMedia() {
  const attempts: MediaStreamConstraints[] = [
    {
      audio: true,
      video: {
        facingMode: "user",
      },
    },
    {
      audio: true,
      video: true,
    },
  ];

  let lastError: unknown = null;
  for (const constraints of attempts) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

export function FamilyCallPanel({
  currentUserId,
  familyId,
  members,
}: Props) {
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localStreamPromiseRef = useRef<Promise<MediaStream> | null>(null);
  const mediaRequestGenerationRef = useRef(0);
  const callGenerationRef = useRef(0);
  const watchRef = useRef<CallSnapshot | null | undefined>(undefined);
  const remoteUserIdRef = useRef<Id<"users"> | null>(null);
  const currentCallIdRef = useRef<Id<"calls"> | null>(null);
  const answeredCallIdRef = useRef<Id<"calls"> | null>(null);
  const handledElsewhereCallIdRef = useRef<Id<"calls"> | null>(null);
  const processedCandidateIdsRef = useRef<Set<Id<"callIceCandidates">>>(new Set());
  const pendingIceCandidatesRef = useRef<PendingIceCandidate[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [callError, setCallError] = useState<string | null>(null);
  const [busyUserId, setBusyUserId] = useState<Id<"users"> | null>(null);
  const [locallyOwnedCallId, setLocallyOwnedCallId] = useState<Id<"calls"> | null>(null);
  const deviceId = useSyncExternalStore(
    subscribeToWebDeviceIdentity,
    getOrCreateWebDeviceId,
    () => null,
  );
  const getIceServers = useAction(api.callCredentials.getIceServers);
  const callState = useQuery(
    api.calls.watch,
    deviceId ? { deviceId, familyId } : "skip",
  ) as CallSnapshot | undefined;
  const startCall = useMutation(api.calls.start);
  const answerCall = useMutation(api.calls.answer);
  const declineCall = useMutation(api.calls.decline);
  const endCall = useMutation(api.calls.end);
  const addIceCandidate = useMutation(api.calls.addIceCandidate);

  const activeCall = callState?.call ?? null;
  const incomingCall =
    activeCall?.status === "ringing" && activeCall.calleeId === currentUserId
      ? activeCall
      : null;
  const currentRemoteUserId =
    activeCall === null
      ? null
      : activeCall.callerId === currentUserId
        ? activeCall.calleeId
        : activeCall.callerId;
  const remoteMember = members.find(
    (member) => member.userId === currentRemoteUserId,
  );
  const callableMembers = members.filter(
    (member) => member.userId !== currentUserId,
  );
  const isOwnedCall = activeCall !== null && deviceId !== null
    ? isCallOwnedByDevice(
        activeCall,
        currentUserId,
        deviceId,
        locallyOwnedCallId,
      )
    : false;
  const isCallOnAnotherDevice = activeCall !== null && !incomingCall && !isOwnedCall;

  const attachStreams = useCallback(
    (
      nextLocalStream: MediaStream | null,
      nextRemoteStream: MediaStream | null,
    ) => {
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = nextLocalStream;
      }
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = nextRemoteStream;
      }
    },
    [],
  );

  const teardownConnection = useCallback((stopLocalTracks: boolean) => {
    mediaRequestGenerationRef.current += 1;
    callGenerationRef.current += 1;
    peerConnectionRef.current?.close();
    peerConnectionRef.current = null;
    if (stopLocalTracks) {
      localStreamRef.current?.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
      localStreamPromiseRef.current = null;
      setLocalStream(null);
    }
    setRemoteStream(null);
    attachStreams(stopLocalTracks ? null : localStreamRef.current, null);
    currentCallIdRef.current = null;
    remoteUserIdRef.current = null;
    answeredCallIdRef.current = null;
    setLocallyOwnedCallId(null);
    processedCandidateIdsRef.current = new Set();
    pendingIceCandidatesRef.current = [];
    setBusyUserId(null);
  }, [attachStreams]);

  const ensureLocalStream = async () => {
    if (localStreamRef.current) {
      return localStreamRef.current;
    }
    if (localStreamPromiseRef.current) {
      return await localStreamPromiseRef.current;
    }

    const generation = mediaRequestGenerationRef.current;
    const request = (async () => {
      const stream = await requestLocalMedia();
      if (generation !== mediaRequestGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        throw new Error("The call ended before the camera was ready.");
      }
      localStreamRef.current = stream;
      setLocalStream(stream);
      attachStreams(stream, remoteStream);
      return stream;
    })();
    localStreamPromiseRef.current = request;

    try {
      return await request;
    } finally {
      if (localStreamPromiseRef.current === request) {
        localStreamPromiseRef.current = null;
      }
    }
  };

  const flushCandidates = useCallback(async () => {
    const peerConnection = peerConnectionRef.current;
    const snapshot = watchRef.current;
    if (!peerConnection || !snapshot?.candidates) {
      return;
    }

    for (const candidate of snapshot.candidates) {
      if (processedCandidateIdsRef.current.has(candidate._id)) {
        continue;
      }
      const call = snapshot.call;
      const expectedSenderDeviceId = call
        ? expectedRemoteDeviceId(call, currentUserId)
        : undefined;
      if (
        candidate.senderDeviceId !== undefined
        && expectedSenderDeviceId !== undefined
        && candidate.senderDeviceId !== expectedSenderDeviceId
      ) {
        continue;
      }
      await peerConnection.addIceCandidate({
        candidate: candidate.candidate,
        sdpMid: candidate.sdpMid ?? undefined,
        sdpMLineIndex: candidate.sdpMLineIndex ?? undefined,
        usernameFragment: candidate.usernameFragment ?? undefined,
      });
      processedCandidateIdsRef.current.add(candidate._id);
    }
  }, [currentUserId]);

  const sendIceCandidate = async (candidate: PendingIceCandidate) => {
    const callId = currentCallIdRef.current;
    const recipientId = remoteUserIdRef.current;
    if (!callId || !recipientId || !deviceId) {
      pendingIceCandidatesRef.current.push(candidate);
      return;
    }

    await addIceCandidate({ callId, deviceId, recipientId, ...candidate });
  };

  const flushPendingIceCandidates = async () => {
    const generation = callGenerationRef.current;
    const pendingCandidates = pendingIceCandidatesRef.current;
    pendingIceCandidatesRef.current = [];

    for (const candidate of pendingCandidates) {
      if (generation !== callGenerationRef.current) return;
      await sendIceCandidate(candidate);
    }
  };

  const createPeerConnection = async (otherUserId: Id<"users">) => {
    const generation = callGenerationRef.current;
    const credentials = await getIceServers({});
    if (generation !== callGenerationRef.current) {
      throw new Error("The call ended before the connection was ready.");
    }
    const connection = new RTCPeerConnection({
      iceServers: credentials.iceServers,
    });
    peerConnectionRef.current = connection;
    remoteUserIdRef.current = otherUserId;
    let stream: MediaStream;
    try {
      stream = await ensureLocalStream();
      if (
        generation !== callGenerationRef.current
        || peerConnectionRef.current !== connection
      ) {
        throw new Error("The call ended before the connection was ready.");
      }
    } catch (error) {
      if (peerConnectionRef.current === connection) {
        peerConnectionRef.current = null;
      }
      connection.close();
      throw error;
    }
    const nextRemoteStream = new MediaStream();

    stream.getTracks().forEach((track) => {
      connection.addTrack(track, stream);
    });
    connection.ontrack = (event) => {
      if (peerConnectionRef.current !== connection) return;
      event.streams[0]?.getTracks().forEach((track) => {
        nextRemoteStream.addTrack(track);
      });
      setRemoteStream(nextRemoteStream);
      attachStreams(stream, nextRemoteStream);
    };
    connection.onicecandidate = (event) => {
      if (!event.candidate || peerConnectionRef.current !== connection) {
        return;
      }

      void sendIceCandidate({
        candidate: event.candidate.candidate,
        sdpMid: event.candidate.sdpMid ?? undefined,
        sdpMLineIndex: event.candidate.sdpMLineIndex ?? undefined,
        usernameFragment: event.candidate.usernameFragment ?? undefined,
      }).catch((error) => {
        setCallError(
          error instanceof Error
            ? error.message
            : "Could not send network candidate.",
        );
      });
    };

    setRemoteStream(nextRemoteStream);
    attachStreams(stream, nextRemoteStream);
    return connection;
  };

  useEffect(() => {
    attachStreams(localStream, remoteStream);
  }, [attachStreams, localStream, remoteStream]);

  useEffect(() => {
    watchRef.current = callState;
  }, [callState]);

  useEffect(() => {
    if (activeCall === null) {
      handledElsewhereCallIdRef.current = null;
      if (currentCallIdRef.current !== null) {
        teardownConnection(true);
      }
      const resetBusyUser = window.setTimeout(() => setBusyUserId(null), 0);
      return () => window.clearTimeout(resetBusyUser);
    }

    if (isCallOnAnotherDevice) {
      if (handledElsewhereCallIdRef.current !== activeCall._id) {
        handledElsewhereCallIdRef.current = activeCall._id;
        teardownConnection(true);
      }
      return;
    }

    handledElsewhereCallIdRef.current = null;
    currentCallIdRef.current = activeCall._id;
    remoteUserIdRef.current =
      activeCall.callerId === currentUserId
        ? activeCall.calleeId
        : activeCall.callerId;
  }, [activeCall, currentUserId, isCallOnAnotherDevice, teardownConnection]);

  useEffect(() => {
    const generation = callGenerationRef.current;
    const syncCall = async () => {
      const connection = peerConnectionRef.current;
      if (!activeCall || !isOwnedCall || !connection) {
        return;
      }

      if (
        activeCall.status === "active" &&
        activeCall.callerId === currentUserId &&
        activeCall.answerSdp &&
        answeredCallIdRef.current !== activeCall._id
      ) {
        answeredCallIdRef.current = activeCall._id;
        try {
          await connection.setRemoteDescription(
            parseDescription(activeCall.answerSdp),
          );
        } catch (error) {
          answeredCallIdRef.current = null;
          throw error;
        }
      }

      if (
        generation !== callGenerationRef.current
        || peerConnectionRef.current !== connection
      ) return;
      await flushCandidates();
    };

    void syncCall().catch((error) => {
      if (generation !== callGenerationRef.current) return;
      setCallError(
        error instanceof Error ? error.message : "Could not sync call state.",
      );
    });
  }, [activeCall, currentUserId, callState, flushCandidates, isOwnedCall]);

  useEffect(() => {
    return () => {
      teardownConnection(true);
    };
  }, [teardownConnection]);

  const onStartCall = async (calleeId: Id<"users">) => {
    if (!deviceId) {
      setCallError("This device is still being prepared for calls.");
      return;
    }
    if (typeof window === "undefined" || !window.RTCPeerConnection) {
      setCallError("This browser does not support video calling.");
      return;
    }

    const generation = callGenerationRef.current;
    setBusyUserId(calleeId);
    setCallError(null);
    try {
      const connection = await createPeerConnection(calleeId);
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
      currentCallIdRef.current = callId;
      setLocallyOwnedCallId(callId);
      await flushPendingIceCandidates();
    } catch (error) {
      if (generation !== callGenerationRef.current) return;
      teardownConnection(true);
      setCallError(
        error instanceof Error
          ? error.name === "NotFoundError"
            ? "No camera or microphone was found. Check this device's media settings and try again."
            : error.message
          : "Could not start the call.",
      );
    } finally {
      if (generation === callGenerationRef.current) setBusyUserId(null);
    }
  };

  const onAccept = async () => {
    if (!incomingCall || !deviceId) {
      return;
    }

    const generation = callGenerationRef.current;
    setBusyUserId(incomingCall.callerId);
    setCallError(null);
    try {
      const connection = await createPeerConnection(incomingCall.callerId);
      if (generation !== callGenerationRef.current) return;
      await connection.setRemoteDescription(
        parseDescription(incomingCall.offerSdp),
      );
      if (generation !== callGenerationRef.current) return;
      await flushCandidates();
      if (generation !== callGenerationRef.current) return;
      const answer = await connection.createAnswer();
      if (generation !== callGenerationRef.current) return;
      await connection.setLocalDescription(answer);
      if (generation !== callGenerationRef.current) return;
      await answerCall({
        callId: incomingCall._id,
        deviceId,
        answerSdp: serializeDescription(answer),
      });
      if (generation !== callGenerationRef.current) return;
      setLocallyOwnedCallId(incomingCall._id);
      answeredCallIdRef.current = incomingCall._id;
      await flushCandidates();
    } catch (error) {
      if (generation !== callGenerationRef.current) return;
      teardownConnection(true);
      const wasAnsweredElsewhere =
        error instanceof Error && /no longer ringing/i.test(error.message);
      setCallError(
        wasAnsweredElsewhere
          ? null
          : error instanceof Error
            ? error.name === "NotFoundError"
              ? "No camera or microphone was found. Check this device's media settings and try again."
              : error.message
            : "Could not answer the call.",
      );
    } finally {
      if (generation === callGenerationRef.current) setBusyUserId(null);
    }
  };

  const onDecline = async () => {
    if (!incomingCall || !deviceId) {
      return;
    }
    setBusyUserId(incomingCall.callerId);
    setCallError(null);
    try {
      await declineCall({ callId: incomingCall._id, deviceId });
    } catch (error) {
      setCallError(
        error instanceof Error ? error.message : "Could not decline the call.",
      );
    } finally {
      setBusyUserId(null);
    }
  };

  const onHangUp = async () => {
    if (!activeCall || !deviceId || !isOwnedCall) {
      return;
    }
    setBusyUserId(currentRemoteUserId);
    setCallError(null);
    try {
      await endCall({ callId: activeCall._id, deviceId });
    } catch (error) {
      setCallError(
        error instanceof Error ? error.message : "Could not end the call.",
      );
    } finally {
      teardownConnection(true);
      setBusyUserId(null);
    }
  };

  const isOnCall = activeCall !== null;
  const isIncoming = incomingCall !== null;
  const remoteLabel = getMemberLabel(remoteMember);
  const callOnAnotherDeviceMessage =
    activeCall?.status === "active" && activeCall.calleeId === currentUserId
      ? "Answered on another device."
      : activeCall?.status === "ringing"
        ? "This call was started on another device."
        : "This call is active on another device.";

  return (
    <div className="space-y-4 rounded-3xl border border-sky-400/20 bg-sky-400/5 p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-[0.3em] text-sky-200">
            Family Calls
          </p>
          <h3 className="mt-2 text-2xl font-semibold text-stone-50">
            Start a face-to-face check-in
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
            Calls use WebRTC in the browser. Convex handles the live signaling,
            and Cloudflare TURN can be used as the relay when direct peer
            connections are not enough.
          </p>
        </div>
        {isOwnedCall ? (
          <button
            className="rounded-2xl border border-rose-400/30 bg-rose-400/10 px-4 py-3 text-sm font-medium text-rose-100 transition hover:border-rose-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={busyUserId !== null}
            onClick={onHangUp}
            type="button"
          >
            Hang up
          </button>
        ) : null}
      </div>

      {callError ? (
        <p className="rounded-2xl border border-rose-400/20 bg-rose-400/10 px-4 py-3 text-sm text-rose-100">
          {callError}
        </p>
      ) : null}

      {isCallOnAnotherDevice ? (
        <p className="rounded-2xl border border-sky-300/30 bg-sky-300/10 px-4 py-3 text-sm text-sky-100">
          {callOnAnotherDeviceMessage}
        </p>
      ) : null}

      {isIncoming ? (
        <div className="flex flex-col gap-3 rounded-2xl border border-amber-300/30 bg-amber-300/10 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.24em] text-amber-200">
              Incoming call
            </p>
            <p className="mt-2 text-lg font-medium text-stone-50">
              {remoteLabel} is calling you
            </p>
          </div>
          <div className="flex gap-3">
            <button
              className="rounded-2xl bg-emerald-300 px-4 py-3 text-sm font-medium text-stone-950 transition hover:bg-emerald-200 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busyUserId !== null || deviceId === null}
              onClick={onAccept}
              type="button"
            >
              Answer
            </button>
            <button
              className="rounded-2xl border border-stone-600 px-4 py-3 text-sm font-medium text-stone-100 transition hover:border-stone-400 disabled:cursor-not-allowed disabled:opacity-60"
              disabled={busyUserId !== null || deviceId === null}
              onClick={onDecline}
              type="button"
            >
              Decline
            </button>
          </div>
        </div>
      ) : null}

      {!isOnCall ? (
        <div className="flex flex-wrap gap-3">
          {callableMembers.length === 0 ? (
            <p className="text-sm text-stone-400">
              Add another family member to start a call.
            </p>
          ) : (
            callableMembers.map((member) => (
              <button
                key={member.userId}
                className="rounded-full border border-sky-300/30 bg-sky-300/10 px-4 py-2 text-sm font-medium text-sky-100 transition hover:border-sky-200 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={busyUserId !== null || deviceId === null}
                onClick={() => onStartCall(member.userId)}
                type="button"
              >
                Call {getMemberLabel(member)}
              </button>
            ))
          )}
        </div>
      ) : null}

      {!isCallOnAnotherDevice ? <div className="grid gap-4 lg:grid-cols-2">
        <div className="overflow-hidden rounded-3xl border border-stone-800 bg-stone-950">
          <div className="border-b border-stone-800 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
              You
            </p>
          </div>
          <video
            ref={localVideoRef}
            autoPlay
            className="aspect-video w-full bg-stone-950 object-cover"
            muted
            playsInline
          />
        </div>
        <div className="overflow-hidden rounded-3xl border border-stone-800 bg-stone-950">
          <div className="border-b border-stone-800 px-4 py-3">
            <p className="text-xs uppercase tracking-[0.24em] text-stone-500">
              {isOnCall ? remoteLabel : "Waiting for call"}
            </p>
          </div>
          <video
            ref={remoteVideoRef}
            autoPlay
            className="aspect-video w-full bg-stone-950 object-cover"
            playsInline
          />
        </div>
      </div> : null}
    </div>
  );
}
