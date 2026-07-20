# Convex migrations

Data migrations use `@convex-dev/migrations` so cleanup is batched, resumable,
and observable. Never remove a field or table from `schema.js` until its migration
has completed in every deployment that will receive the narrowed schema.

The deprecated presence and sample-notes cleanup completed on the development
deployment on 2026-07-20. The tables intentionally remain in the schema until the
same migration has completed in every deployment:

```powershell
npx convex run migrations:runDeleteDeprecatedFamilyPresence '{"dryRun":true}'
npx convex run migrations:runDeleteUnusedNotes '{"dryRun":true}'
npx convex run migrations:runDeprecatedTableCleanup
npx convex run --component migrations lib:getStatus --watch
```

After both migrations report success everywhere, remove the deprecated table
definitions in a separate narrowing change. The no-op `families:heartbeat`
compatibility endpoint remains until all previously distributed development
clients have been retired.
