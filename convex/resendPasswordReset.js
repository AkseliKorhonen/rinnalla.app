import Resend from "@auth/core/providers/resend";
import { generateRandomString } from "@oslojs/crypto/random";
import { Resend as ResendClient } from "resend";

const RESET_CODE_LENGTH = 8;

export const resendPasswordReset = Resend({
  id: "resend-otp",
  apiKey: process.env.AUTH_RESEND_KEY,
  async generateVerificationToken() {
    const random = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };

    return generateRandomString(random, "0123456789", RESET_CODE_LENGTH);
  },
  async sendVerificationRequest({ identifier: email, provider, token }) {
    const from = process.env.AUTH_RESEND_FROM;
    if (!from) {
      throw new Error("AUTH_RESEND_FROM is not configured");
    }

    const resend = new ResendClient(provider.apiKey);
    const { error } = await resend.emails.send({
      from,
      to: [email],
      subject: "Reset your Vaari Tablet password",
      text: `Your Vaari Tablet password reset code is ${token}. It expires shortly. If you did not request it, you can ignore this email.`,
    });

    if (error) {
      throw new Error("Could not send password reset email");
    }
  },
});
