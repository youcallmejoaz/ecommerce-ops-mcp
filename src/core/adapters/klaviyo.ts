// Klaviyo adapter: create campaign -> create template -> assign -> send job.
// Written against API revision 2024-10-15; verify against your account before use.
import type { DB } from "../db";
import { type CampaignSend, type EmailAdapter, recordSendLocally } from "./email";

type FetchLike = typeof fetch;

export interface KlaviyoOptions {
  db: DB;
  apiKey: string;
  fromEmail: string;
  fromLabel: string;
  /** segment id (vip, loyal, ...) -> Klaviyo list or segment id */
  audienceMap: Record<string, string>;
  fetch?: FetchLike;
  revision?: string;
}

const BASE = "https://a.klaviyo.com/api";

const toHtml = (text: string) =>
  text.split(/\n{2,}/).map((p) => `<p>${p.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/\n/g, "<br>")}</p>`).join("\n");

export class KlaviyoEmailAdapter implements EmailAdapter {
  readonly name = "klaviyo";
  private fetch: FetchLike;

  constructor(private o: KlaviyoOptions) {
    this.fetch = o.fetch ?? fetch;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const res = await this.fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Klaviyo-API-Key ${this.o.apiKey}`,
        revision: this.o.revision ?? "2024-10-15",
        accept: "application/vnd.api+json",
        "content-type": "application/vnd.api+json",
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`Klaviyo ${path} HTTP ${res.status}: ${text.slice(0, 300)}`);
    return (text ? JSON.parse(text) : {}) as T;
  }

  async sendCampaign(c: CampaignSend) {
    const audience = this.o.audienceMap[c.segmentId];
    if (!audience) throw new Error(`No Klaviyo audience mapped for segment "${c.segmentId}" (KLAVIYO_AUDIENCE_MAP).`);

    const campaign = await this.post<{ data: { id: string; relationships: { "campaign-messages": { data: { id: string }[] } } } }>("/campaigns/", {
      data: {
        type: "campaign",
        attributes: {
          name: `ops-agent #${c.actionId}: ${c.subject}`.slice(0, 120),
          audiences: { included: [audience], excluded: [] },
          send_strategy: { method: "immediate" },
          "campaign-messages": {
            data: [{
              type: "campaign-message",
              attributes: {
                definition: {
                  channel: "email",
                  label: c.subject,
                  content: { subject: c.subject, preview_text: c.body.split("\n").find((l) => l.trim() && !l.startsWith("Hi")) ?? "", from_email: this.o.fromEmail, from_label: this.o.fromLabel },
                },
              },
            }],
          },
        },
      },
    });
    const campaignId = campaign.data.id;
    const messageId = campaign.data.relationships["campaign-messages"].data[0].id;

    const template = await this.post<{ data: { id: string } }>("/templates/", {
      data: { type: "template", attributes: { name: `ops-agent #${c.actionId}`, editor_type: "CODE", html: toHtml(c.body), text: c.body } },
    });
    await this.post("/campaign-message-assign-template/", {
      data: { type: "campaign-message", id: messageId, relationships: { template: { data: { type: "template", id: template.data.id } } } },
    });
    await this.post("/campaign-send-jobs/", { data: { type: "campaign-send-job", id: campaignId } });

    recordSendLocally(this.o.db, c, campaignId);
    return { ref: campaignId };
  }
}
