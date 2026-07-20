import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";

const MAX_EXISTING_PASSWORD_ACCOUNTS = 500;

function passwordAccounts(ctx) {
  return ctx.db
    .query("authAccounts")
    .withIndex("providerAndAccountId", (query) =>
      query.eq("provider", "password"),
    )
    .take(MAX_EXISTING_PASSWORD_ACCOUNTS + 1);
}

export const status = internalQuery({
  args: {},
  returns: v.object({
    hasMore: v.boolean(),
    scanned: v.number(),
    unverified: v.number(),
  }),
  handler: async (ctx) => {
    const accounts = await passwordAccounts(ctx);
    const scannedAccounts = accounts.slice(0, MAX_EXISTING_PASSWORD_ACCOUNTS);
    return {
      hasMore: accounts.length > MAX_EXISTING_PASSWORD_ACCOUNTS,
      scanned: scannedAccounts.length,
      unverified: scannedAccounts.filter(
        (account) => account.emailVerified === undefined,
      ).length,
    };
  },
});

export const markExistingPasswordAccountsVerified = internalMutation({
  args: {},
  returns: v.object({
    alreadyVerified: v.number(),
    updated: v.number(),
  }),
  handler: async (ctx) => {
    const accounts = await passwordAccounts(ctx);
    if (accounts.length > MAX_EXISTING_PASSWORD_ACCOUNTS) {
      throw new Error(
        "More than 500 password accounts exist; use a batched migration instead.",
      );
    }

    let alreadyVerified = 0;
    let updated = 0;
    for (const account of accounts) {
      if (account.emailVerified !== undefined) {
        alreadyVerified += 1;
        continue;
      }
      await ctx.db.patch(account._id, {
        emailVerified: account.providerAccountId,
      });
      updated += 1;
    }

    return { alreadyVerified, updated };
  },
});
