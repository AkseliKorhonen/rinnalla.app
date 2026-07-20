import { Migrations } from "@convex-dev/migrations";
import { components, internal } from "./_generated/api";

export const migrations = new Migrations(components.migrations);

export const deleteDeprecatedFamilyPresence = migrations.define({
  table: "familyPresence",
  migrateOne: async (ctx, presence) => {
    await ctx.db.delete(presence._id);
  },
});

export const deleteUnusedNotes = migrations.define({
  table: "notes",
  migrateOne: async (ctx, note) => {
    await ctx.db.delete(note._id);
  },
});

export const runDeleteDeprecatedFamilyPresence = migrations.runner(
  internal.migrations.deleteDeprecatedFamilyPresence,
);
export const runDeleteUnusedNotes = migrations.runner(
  internal.migrations.deleteUnusedNotes,
);
export const runDeprecatedTableCleanup = migrations.runner([
  internal.migrations.deleteDeprecatedFamilyPresence,
  internal.migrations.deleteUnusedNotes,
]);
