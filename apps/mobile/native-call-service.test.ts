import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const appStateListeners: Array<(state: string) => void> = [];
  const appState = {
    currentState: "active",
    addEventListener: vi.fn(
      (_event: string, listener: (state: string) => void) => {
        appStateListeners.push(listener);
        return { remove: vi.fn() };
      },
    ),
  };
  const callKeep = {
    addEventListener: vi.fn(),
    backToForeground: vi.fn(),
    clearInitialEvents: vi.fn(),
    displayIncomingCall: vi.fn(),
    endCall: vi.fn(),
    getInitialEvents: vi.fn(async () => []),
    setCurrentCallActive: vi.fn(),
    setup: vi.fn(async () => undefined),
  };
  const bridge = {
    disconnectResolvedIncomingCall: vi.fn(async () => true),
    dismissIncomingCallForForeground: vi.fn(async () => true),
    getCallAppVisibleOverLockScreen: vi.fn(async () => false),
    getNativeCallMetadata: vi.fn(async () => null),
    removeNativeCallMetadata: vi.fn(),
    setCallAppVisibleOverLockScreen: vi.fn(),
    startIncomingRingtone: vi.fn(),
    stopIncomingRingtone: vi.fn(),
    storeNativeCallMetadata: vi.fn(async () => undefined),
  };

  return { appState, appStateListeners, bridge, callKeep };
});

vi.mock("react-native-callkeep", () => ({ default: mocks.callKeep }));
vi.mock("react-native", () => ({
  AppState: mocks.appState,
  NativeModules: { RNCallKeep: mocks.bridge },
  Platform: { OS: "android", Version: 36 },
}));

const incomingCall = {
  callId: "call-1",
  familyId: "family-1",
  nativeCallId: "native-1",
  callerName: "Family member",
};

async function loadService() {
  vi.resetModules();
  return await import("./native-call-service");
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.appState.currentState = "active";
  mocks.appStateListeners.length = 0;
  mocks.bridge.disconnectResolvedIncomingCall.mockResolvedValue(true);
  mocks.bridge.dismissIncomingCallForForeground.mockResolvedValue(true);
  mocks.bridge.getCallAppVisibleOverLockScreen.mockResolvedValue(false);
  mocks.bridge.getNativeCallMetadata.mockResolvedValue(null);
  mocks.callKeep.getInitialEvents.mockResolvedValue([]);
});

describe("native call presentation", () => {
  test("rings in the app without opening Telecom while the app is active", async () => {
    const service = await loadService();

    await service.showIncomingCall(incomingCall);

    expect(mocks.bridge.startIncomingRingtone).toHaveBeenCalledWith("native-1");
    expect(mocks.callKeep.displayIncomingCall).not.toHaveBeenCalled();
    expect(service.claimIncomingCallInApp("native-1")).toBe(true);
    expect(mocks.bridge.stopIncomingRingtone).toHaveBeenCalledWith("native-1");
  });

  test("uses the native incoming-call surface while the app is backgrounded", async () => {
    mocks.appState.currentState = "background";
    const service = await loadService();

    await service.showIncomingCall(incomingCall);

    expect(mocks.callKeep.displayIncomingCall).toHaveBeenCalledWith(
      "native-1",
      "Family member",
      "Family member",
      "generic",
      true,
    );
    expect(mocks.bridge.startIncomingRingtone).not.toHaveBeenCalled();
  });

  test("moves a ringing native call into the app when it becomes active", async () => {
    mocks.appState.currentState = "background";
    const service = await loadService();
    await service.showIncomingCall(incomingCall);

    mocks.appState.currentState = "active";
    for (const listener of mocks.appStateListeners) listener("active");

    await vi.waitFor(() => {
      expect(mocks.bridge.dismissIncomingCallForForeground).toHaveBeenCalledWith(
        "native-1",
      );
      expect(mocks.bridge.startIncomingRingtone).toHaveBeenCalledWith("native-1");
    });
  });

  test("does not resurrect a native surface after the call was resolved", async () => {
    mocks.appState.currentState = "background";
    const service = await loadService();

    await service.dismissResolvedIncomingCall("native-1", "answered");
    await service.showIncomingNativeCall(incomingCall);

    expect(mocks.bridge.disconnectResolvedIncomingCall).toHaveBeenCalledWith(
      "native-1",
      4,
    );
    expect(mocks.callKeep.displayIncomingCall).not.toHaveBeenCalled();
  });
});
