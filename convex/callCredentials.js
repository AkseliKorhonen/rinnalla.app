"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";

const DEFAULT_ICE_SERVERS = [
  {
    urls: ["stun:stun.cloudflare.com:3478", "stun:stun.cloudflare.com:53"],
  },
];

export const getIceServers = action({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("Not authenticated");
    }

    const turnKeyId = process.env.CLOUDFLARE_TURN_KEY_ID;
    const turnApiToken = process.env.CLOUDFLARE_TURN_API_TOKEN;

    if (!turnKeyId || !turnApiToken) {
      return {
        iceServers: DEFAULT_ICE_SERVERS,
        source: "stun-only",
      };
    }

    const response = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${turnKeyId}/credentials/generate-ice-servers`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${turnApiToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ttl: 3600 }),
      },
    );

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Could not load TURN credentials: ${body}`);
    }

    const payload = await response.json();
    return {
      iceServers: payload.iceServers ?? DEFAULT_ICE_SERVERS,
      source: "cloudflare-turn",
    };
  },
});
