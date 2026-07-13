/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
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

describe("calls", () => {
  test("starts, answers, and delivers ICE candidates for a family call", async () => {
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
    const [family] = await owner.query(api.families.listMy, {});
    await member.mutation(api.families.join, {
      inviteCode: family.inviteCode,
    });

    const callId = await owner.mutation(api.calls.start, {
      familyId: family._id,
      calleeId: memberId,
      offerSdp: '{"type":"offer","sdp":"offer-sdp"}',
    });

    const incoming = await member.query(api.calls.watch, {
      familyId: family._id,
    });
    expect(incoming.call).toMatchObject({
      _id: callId,
      status: "ringing",
      callerId: ownerId,
      calleeId: memberId,
      offerSdp: '{"type":"offer","sdp":"offer-sdp"}',
    });

    await owner.mutation(api.calls.addIceCandidate, {
      callId,
      recipientId: memberId,
      candidate: "candidate-1",
      sdpMid: "0",
      sdpMLineIndex: 0,
    });

    const withCandidate = await member.query(api.calls.watch, {
      familyId: family._id,
    });
    expect(withCandidate.candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          candidate: "candidate-1",
          recipientId: memberId,
          senderId: ownerId,
        }),
      ]),
    );

    await member.mutation(api.calls.answer, {
      callId,
      answerSdp: '{"type":"answer","sdp":"answer-sdp"}',
    });

    const active = await owner.query(api.calls.watch, {
      familyId: family._id,
    });
    expect(active.call).toMatchObject({
      _id: callId,
      status: "active",
      answerSdp: '{"type":"answer","sdp":"answer-sdp"}',
    });
  });

  test("expires abandoned calls and deletes their signaling candidates", async () => {
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
    const [family] = await owner.query(api.families.listMy, {});
    await member.mutation(api.families.join, {
      inviteCode: family.inviteCode,
    });

    const callId = await t.run(async (ctx) => {
      return await ctx.db.insert("calls", {
        familyId: family._id,
        callerId: ownerId,
        calleeId: memberId,
        status: "ringing",
        offerSdp: "offer-sdp",
        createdAt: 0,
      });
    });
    await t.run(async (ctx) => {
      await ctx.db.insert("callIceCandidates", {
        callId,
        recipientId: memberId,
        senderId: ownerId,
        candidate: "candidate-1",
        createdAt: 0,
      });
    });

    await t.mutation(internal.calls.expireStale, {});

    const call = await t.run(async (ctx) => await ctx.db.get(callId));
    expect(call).toMatchObject({ status: "ended" });
    const candidates = await t.run(async (ctx) =>
      ctx.db
        .query("callIceCandidates")
        .withIndex("by_callId", (q) => q.eq("callId", callId))
        .take(10),
    );
    expect(candidates).toEqual([]);
  });
});
