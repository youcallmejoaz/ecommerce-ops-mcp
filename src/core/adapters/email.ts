import type { DB } from "../db";

export interface CampaignSend {
  actionId: number;
  segmentId: string;
  subject: string;
  body: string;
  discountPct: number;
  recipientCount: number;
  sentAt: string;
}

/** The only code path that sends email. Called exclusively from approvals.ts. */
export interface EmailAdapter {
  readonly name: string;
  sendCampaign(c: CampaignSend): Promise<{ ref: string }>;
}

export function recordSendLocally(db: DB, c: CampaignSend, ref: string): void {
  db.prepare(`INSERT INTO email_outbox (action_id, segment_id, subject, body, discount_pct, recipient_count, provider_ref, sent_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(c.actionId, c.segmentId, c.subject, c.body, c.discountPct, c.recipientCount, ref, c.sentAt);
}

/** Klaviyo-style mock: records the send in an outbox table instead of emailing anyone. */
export class MockEmailAdapter implements EmailAdapter {
  readonly name = "mock-email";
  constructor(private db: DB) {}

  async sendCampaign(c: CampaignSend) {
    const ref = `mock-campaign-${c.actionId}`;
    recordSendLocally(this.db, c, ref);
    return { ref };
  }
}
