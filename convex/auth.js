import { convexAuth } from "@convex-dev/auth/server";
import { Password } from "@convex-dev/auth/providers/Password";
import { resendPasswordReset } from "./resendPasswordReset";

function normalizeName(value) {
  if (typeof value !== "string") {
    throw new Error("Please enter your name");
  }
  const name = value.trim().replace(/\s+/g, " ");
  if (name.length < 2 || name.length > 80) {
    throw new Error("Your name must be between 2 and 80 characters");
  }
  return name;
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        if (typeof params.email !== "string") {
          throw new Error("Missing email");
        }
        if (params.flow === "signUp") {
          return { email: params.email, name: normalizeName(params.name) };
        }
        return { email: params.email };
      },
      reset: resendPasswordReset,
    }),
  ],
});
