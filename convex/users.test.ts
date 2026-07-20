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

describe("profile pictures", () => {
  test("requires authentication before issuing an upload URL", async () => {
    const t = convexTest({ schema, modules });
    await expect(
      t.mutation(api.users.generateProfileImageUploadUrl, {}),
    ).rejects.toThrow("Not authenticated");
  });

  test("stores, resolves, replaces, and removes the current user's picture", async () => {
    const t = convexTest({ schema, modules });
    const { authed, userId } = await createUser(t, "person@example.com");
    const firstStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([
          new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
          "first-image",
        ], { type: "image/png" }),
      );
    });
    const secondStorageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob([
          new Uint8Array([0xff, 0xd8, 0xff]),
          "second-image",
        ], { type: "image/jpeg" }),
      );
    });

    await authed.action(api.profileImageActions.updateProfileImage, {
      storageId: firstStorageId,
    });
    const withFirstImage = await authed.query(api.users.current, {});
    expect(withFirstImage?.image).toMatch(/^https:\/\//);

    await authed.action(api.profileImageActions.updateProfileImage, {
      storageId: secondStorageId,
    });
    const storedAfterReplace = await t.run(async (ctx) => ({
      first: await ctx.db.system.get("_storage", firstStorageId),
      second: await ctx.db.system.get("_storage", secondStorageId),
      user: await ctx.db.get(userId),
    }));
    expect(storedAfterReplace.first).toBeNull();
    expect(storedAfterReplace.second).not.toBeNull();
    expect(storedAfterReplace.user?.profileImageStorageId).toBe(secondStorageId);

    await authed.mutation(api.users.removeProfileImage, {});
    const storedAfterRemove = await t.run(async (ctx) => ({
      image: await ctx.db.system.get("_storage", secondStorageId),
      user: await ctx.db.get(userId),
    }));
    expect(storedAfterRemove.image).toBeNull();
    expect(storedAfterRemove.user?.profileImageStorageId).toBeUndefined();
    expect((await authed.query(api.users.current, {}))?.image).toBeNull();
  });

  test("rejects non-image uploads", async () => {
    const t = convexTest({ schema, modules });
    const { authed } = await createUser(t, "person@example.com");
    const storageId = await t.run(async (ctx) => {
      return await ctx.storage.store(
        new Blob(["not-an-image"], { type: "text/plain" }),
      );
    });

    await expect(
      authed.action(api.profileImageActions.updateProfileImage, { storageId }),
    ).rejects.toThrow("Choose a JPEG, PNG, or WebP image");
    await expect(
      t.run(async (ctx) => await ctx.db.system.get("_storage", storageId)),
    ).resolves.toBeNull();
  });
});
