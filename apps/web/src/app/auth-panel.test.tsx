import { renderToString } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, test, vi } from "vitest";
const queryMock = vi.fn();
const mutationMock = vi.fn((reference?: unknown) => {
  void reference;
  return vi.fn();
});
const useConvexAuthMock = vi.fn();
const useAuthActionsMock = vi.fn(() => ({
  signIn: vi.fn(),
  signOut: vi.fn(),
}));

vi.mock("convex/react", () => ({
  Authenticated: ({ children }: { children: ReactNode }) => children,
  AuthLoading: () => null,
  Unauthenticated: ({ children }: { children: ReactNode }) => children,
  useConvexAuth: () => useConvexAuthMock(),
  useMutation: (reference: unknown) => mutationMock(reference),
  useQuery: (...args: unknown[]) => queryMock(...args),
}));

vi.mock("@convex-dev/auth/react", () => ({
  useAuthActions: () => useAuthActionsMock(),
}));

vi.mock("./family-call-panel", () => ({
  FamilyCallPanel: () => null,
}));

describe("AuthPanel", () => {
  beforeEach(() => {
    queryMock.mockReset();
    mutationMock.mockClear();
    useConvexAuthMock.mockReset();
    useAuthActionsMock.mockClear();
  });

  test("skips family loading until the user is authenticated", async () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: false });
    queryMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);
    const { AuthPanel } = await import("./auth-panel");

    renderToString(<AuthPanel />);

    const queryArgs = queryMock.mock.calls;
    expect(queryArgs[0]).toHaveLength(1);
    expect(queryArgs[1][1]).toBe("skip");
    expect(queryArgs[2][1]).toBe("skip");
  });

  test("offers password reset from the sign-in screen", async () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: false });
    queryMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce(undefined)
      .mockReturnValueOnce(undefined);
    const { AuthPanel } = await import("./auth-panel");

    const html = renderToString(<AuthPanel />);

    expect(html).toContain("Forgot password?");
  });

  test("loads families once the user is authenticated", async () => {
    useConvexAuthMock.mockReturnValue({ isAuthenticated: true });
    queryMock
      .mockReturnValueOnce(null)
      .mockReturnValueOnce([
        {
          _id: "family_1",
          name: "Korhonen",
          inviteCode: "ABC123",
          role: "owner",
          joinedAt: 0,
        },
      ])
      .mockReturnValueOnce({
        family: {
          _id: "family_1",
          name: "Korhonen",
          inviteCode: "ABC123",
        },
        currentUserId: "user_1",
        members: [
          {
            userId: "user_1",
            email: "owner@example.com",
            name: null,
            image: null,
            role: "owner",
            joinedAt: 0,
          },
        ],
      });
    const { AuthPanel } = await import("./auth-panel");

    renderToString(<AuthPanel />);

    const queryArgs = queryMock.mock.calls;
    expect(queryArgs[0]).toHaveLength(1);
    expect(queryArgs[1][1]).toEqual({});
    expect(queryArgs[2][1]).toEqual({ familyId: "family_1" });
  });
});
