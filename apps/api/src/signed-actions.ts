import { createHmac, timingSafeEqual } from "node:crypto";

import type { BriefItemFeedbackType } from "@news-agent/shared";

export interface FeedbackActionPayload {
  userId: string;
  briefId: string;
  itemId: string;
  type: BriefItemFeedbackType;
  expiresAt: number;
}

export class FeedbackActionSigner {
  public constructor(private readonly secret: string) {
    if (secret.length < 32) throw new Error("NEWS_AGENT_FEEDBACK_SIGNING_SECRET must be at least 32 characters");
  }

  public sign(payload: FeedbackActionPayload): string {
    const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
    return `${encoded}.${this.signature(encoded)}`;
  }

  public verify(token: string, now = Date.now()): FeedbackActionPayload | undefined {
    const [encoded, providedSignature, ...extra] = token.split(".");
    if (!encoded || !providedSignature || extra.length > 0) return undefined;
    const expectedSignature = this.signature(encoded);
    const expected = Buffer.from(expectedSignature);
    const provided = Buffer.from(providedSignature);
    if (expected.length !== provided.length || !timingSafeEqual(expected, provided)) return undefined;
    try {
      const parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as Partial<FeedbackActionPayload>;
      if (
        typeof parsed.userId !== "string" ||
        typeof parsed.briefId !== "string" ||
        typeof parsed.itemId !== "string" ||
        !["useful", "not_interested", "already_known", "repetitive"].includes(parsed.type ?? "") ||
        typeof parsed.expiresAt !== "number" ||
        parsed.expiresAt < now
      ) return undefined;
      return parsed as FeedbackActionPayload;
    } catch {
      return undefined;
    }
  }

  private signature(encoded: string): string {
    return createHmac("sha256", this.secret).update(encoded).digest("base64url");
  }
}
