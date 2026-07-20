/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as callCredentials from "../callCredentials.js";
import type * as callNotificationData from "../callNotificationData.js";
import type * as callNotifications from "../callNotifications.js";
import type * as calls from "../calls.js";
import type * as crons from "../crons.js";
import type * as emailVerificationMigration from "../emailVerificationMigration.js";
import type * as families from "../families.js";
import type * as http from "../http.js";
import type * as migrations from "../migrations.js";
import type * as profileImageActions from "../profileImageActions.js";
import type * as pushTokens from "../pushTokens.js";
import type * as resendEmailVerification from "../resendEmailVerification.js";
import type * as resendPasswordReset from "../resendPasswordReset.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  callCredentials: typeof callCredentials;
  callNotificationData: typeof callNotificationData;
  callNotifications: typeof callNotifications;
  calls: typeof calls;
  crons: typeof crons;
  emailVerificationMigration: typeof emailVerificationMigration;
  families: typeof families;
  http: typeof http;
  migrations: typeof migrations;
  profileImageActions: typeof profileImageActions;
  pushTokens: typeof pushTokens;
  resendEmailVerification: typeof resendEmailVerification;
  resendPasswordReset: typeof resendPasswordReset;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {
  migrations: import("@convex-dev/migrations/_generated/component.js").ComponentApi<"migrations">;
};
