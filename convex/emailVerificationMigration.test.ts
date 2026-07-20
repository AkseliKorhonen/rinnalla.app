/// <reference types="vite/client" />

import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.js");

test("marks only existing password accounts as email verified", async () => {
  const t = convexTest(schema, modules);
  await t.run(async (ctx) => {
    const legacyUserId = await ctx.db.insert("users", {
      email: "legacy@example.com",
    });
    const verifiedUserId = await ctx.db.insert("users", {
      email: "verified@example.com",
    });
    const oauthUserId = await ctx.db.insert("users", {
      email: "oauth@example.com",
    });
    await ctx.db.insert("authAccounts", {
      provider: "password",
      providerAccountId: "legacy@example.com",
      secret: "hashed-password",
      userId: legacyUserId,
    });
    await ctx.db.insert("authAccounts", {
      emailVerified: "verified@example.com",
      provider: "password",
      providerAccountId: "verified@example.com",
      secret: "hashed-password",
      userId: verifiedUserId,
    });
    await ctx.db.insert("authAccounts", {
      provider: "github",
      providerAccountId: "github-user",
      userId: oauthUserId,
    });
  });

  const result = await t.mutation(
    internal.emailVerificationMigration.markExistingPasswordAccountsVerified,
    {},
  );

  expect(result).toEqual({ alreadyVerified: 1, updated: 1 });
  const accounts = await t.run(async (ctx) =>
    ctx.db
      .query("authAccounts")
      .withIndex("providerAndAccountId", (query) =>
        query.eq("provider", "password"),
      )
      .take(10),
  );
  expect(accounts).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        emailVerified: "legacy@example.com",
        providerAccountId: "legacy@example.com",
      }),
      expect.objectContaining({
        emailVerified: "verified@example.com",
        providerAccountId: "verified@example.com",
      }),
    ]),
  );
});
