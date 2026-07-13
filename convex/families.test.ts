/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.js");

async function createUser(t: ReturnType<typeof convexTest>, email: string) {
  const userId = await t.run(async (ctx) => {
    return await ctx.db.insert("users", { email });
  });

  return {
    userId,
    authed: t.withIdentity({
      email,
      subject: userId,
      tokenIdentifier: `test|${userId}`,
    }),
  };
}

describe("families", () => {
  test("requires authentication to list and create families", async () => {
    const t = convexTest({ schema, modules });

    await expect(t.query(api.families.listMy, {})).rejects.toThrow(
      "Not authenticated",
    );
    await expect(
      t.mutation(api.families.create, { name: "Korhonen" }),
    ).rejects.toThrow("Not authenticated");
  });

  test("creates a family and owner membership for the authenticated user", async () => {
    const t = convexTest({ schema, modules });
    const { authed } = await createUser(t, "owner@example.com");

    await authed.mutation(api.families.create, { name: "Korhonen" });
    const families = await authed.query(api.families.listMy, {});

    expect(families).toHaveLength(1);
    expect(families[0]).toMatchObject({
      name: "Korhonen",
      role: "owner",
    });
    expect(families[0].inviteCode).toHaveLength(6);
  });

  test("joins a family by invite code and prevents duplicate membership", async () => {
    const t = convexTest({ schema, modules });
    const { authed: owner } = await createUser(t, "owner@example.com");
    const { authed: member } = await createUser(t, "member@example.com");

    await owner.mutation(api.families.create, { name: "Korhonen" });
    const [createdFamily] = await owner.query(api.families.listMy, {});

    await member.mutation(api.families.join, {
      inviteCode: createdFamily.inviteCode,
    });

    const memberFamilies = await member.query(api.families.listMy, {});
    expect(memberFamilies).toHaveLength(1);
    expect(memberFamilies[0]).toMatchObject({
      name: "Korhonen",
      role: "member",
      inviteCode: createdFamily.inviteCode,
    });

    await expect(
      member.mutation(api.families.join, {
        inviteCode: createdFamily.inviteCode,
      }),
    ).rejects.toThrow("You are already in this family");
  });

  test("shows online family members in the dashboard", async () => {
    const t = convexTest({ schema, modules });
    const { authed: owner, userId: ownerId } = await createUser(
      t,
      "owner@example.com",
    );
    const { authed: member, userId: memberId } = await createUser(
      t,
      "member@example.com",
    );

    await owner.mutation(api.families.create, { name: "Korhonen" });
    const [createdFamily] = await owner.query(api.families.listMy, {});

    await member.mutation(api.families.join, {
      inviteCode: createdFamily.inviteCode,
    });
    await owner.mutation(api.families.heartbeat, {
      familyId: createdFamily._id,
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("familyPresence", {
        familyId: createdFamily._id,
        userId: memberId,
        lastSeenAt: Date.now() - 10 * 60 * 1000,
      });
    });

    const dashboard = await owner.query(api.families.dashboard, {
      familyId: createdFamily._id,
    });

    expect(dashboard.onlineCount).toBe(1);
    expect(dashboard.currentUserId).toBe(ownerId);
    expect(dashboard.members).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          userId: ownerId,
          email: "owner@example.com",
          isOnline: true,
          role: "owner",
        }),
        expect.objectContaining({
          userId: memberId,
          email: "member@example.com",
          isOnline: false,
          role: "member",
        }),
      ]),
    );
  });
});
