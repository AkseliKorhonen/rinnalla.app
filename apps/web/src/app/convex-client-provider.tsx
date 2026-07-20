"use client";

import { ConvexAuthProvider } from "@convex-dev/auth/react";
import { ConvexReactClient } from "convex/react";
import { ReactNode } from "react";
import { LanguageProvider } from "./language";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return (
    <LanguageProvider>
      <ConvexAuthProvider client={convex}>{children}</ConvexAuthProvider>
    </LanguageProvider>
  );
}
