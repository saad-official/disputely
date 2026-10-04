import "server-only";
import { Resend } from "resend";
import { optionalEnv } from "@/lib/env";

export type OutgoingEmail = {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type SendResult = {
  provider: "outbox" | "resend";
  providerMessageId: string | null;
  /** Where the message actually went (differs from `to` in demo mode). */
  deliveredTo: string;
  demo: boolean;
};

export interface EmailProvider {
  readonly name: "outbox" | "resend";
  send(email: OutgoingEmail): Promise<SendResult>;
}

/**
 * Default provider: nothing leaves the app. The caller persists the rendered
 * message to the `outbox` table, which the Outbox page displays.
 */
export class OutboxProvider implements EmailProvider {
  readonly name = "outbox" as const;
  async send(email: OutgoingEmail): Promise<SendResult> {
    return {
      provider: "outbox",
      providerMessageId: null,
      deliveredTo: email.to,
      demo: true,
    };
  }
}

/**
 * Resend provider. When `demoRecipient` is set (no verified domain yet),
 * every message is redirected to that address and labelled with the
 * intended recipient so demos are honest about what happened.
 */
export class ResendProvider implements EmailProvider {
  readonly name = "resend" as const;
  private readonly client: Resend;

  constructor(
    apiKey: string,
    private readonly from: string,
    private readonly demoRecipient?: string,
  ) {
    this.client = new Resend(apiKey);
  }

  async send(email: OutgoingEmail): Promise<SendResult> {
    const demo = Boolean(this.demoRecipient);
    const to = this.demoRecipient ?? email.to;
    const subject = demo ? `[Demo for ${email.to}] ${email.subject}` : email.subject;
    const banner = demo
      ? `Demo mode: this message was addressed to ${email.to} and delivered to you instead.\n\n`
      : "";
    const htmlBanner = demo
      ? `<p style="background:#FFF4E0;border:1px solid #F2A33A;padding:8px 12px;border-radius:6px;font:14px system-ui">Demo mode: this message was addressed to <strong>${escapeHtml(email.to)}</strong> and delivered to you instead.</p>`
      : "";

    const { data, error } = await this.client.emails.send({
      from: this.from,
      to,
      subject,
      text: banner + email.text,
      html: email.html ? htmlBanner + email.html : undefined,
      replyTo: email.replyTo,
    });
    if (error) throw new Error(`Resend: ${error.message}`);
    return {
      provider: "resend",
      providerMessageId: data?.id ?? null,
      deliveredTo: to,
      demo,
    };
  }
}

export function getEmailProvider(): EmailProvider {
  const apiKey = optionalEnv("RESEND_API_KEY");
  if (!apiKey) return new OutboxProvider();
  return new ResendProvider(
    apiKey,
    optionalEnv("EMAIL_FROM") ?? "Disputely <onboarding@resend.dev>",
    optionalEnv("EMAIL_DEMO_RECIPIENT"),
  );
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
