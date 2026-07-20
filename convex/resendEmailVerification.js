import Resend from "@auth/core/providers/resend";
import { generateRandomString } from "@oslojs/crypto/random";
import { Resend as ResendClient } from "resend";

const VERIFICATION_CODE_LENGTH = 8;
const VERIFICATION_CODE_MAX_AGE_SECONDS = 15 * 60;

export const resendEmailVerification = Resend({
  id: "resend-email-verification",
  apiKey: process.env.AUTH_RESEND_KEY,
  maxAge: VERIFICATION_CODE_MAX_AGE_SECONDS,
  async generateVerificationToken() {
    const random = {
      read(bytes) {
        crypto.getRandomValues(bytes);
      },
    };

    return generateRandomString(
      random,
      "0123456789",
      VERIFICATION_CODE_LENGTH,
    );
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
      subject: "Verify your rinnalla.app email",
      text: `Your rinnalla.app email verification code is ${token}. It expires in 15 minutes. If you did not create an account, you can ignore this email.`,
    });

    if (error) {
      throw new Error("Could not send email verification code");
    }
  },
});
