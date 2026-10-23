import Anthropic from "@anthropic-ai/sdk";

export interface GenerateRequest {
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Deterministic output used when no API key is configured (test-response mode). */
  testResponse: () => string;
}

export interface LLM {
  readonly mode: "anthropic" | "test";
  readonly model: string;
  generate(req: GenerateRequest): Promise<string>;
}

export const DEFAULT_MODEL = "claude-opus-5-5";

export class AnthropicLLM implements LLM {
  readonly mode = "anthropic" as const;
  constructor(public readonly client: Anthropic, public readonly model: string) {}

  async generate(req: GenerateRequest): Promise<string> {
    const res = await this.client.messages.create({
      model: this.model,
      max_tokens: req.maxTokens ?? 4000,
      system: req.system,
      output_config: { effort: "low" },
      messages: [{ role: "user", content: req.prompt }],
    } as Anthropic.MessageCreateParamsNonStreaming);
    if (res.stop_reason === "refusal") throw new Error("Claude declined to write this content.");
    return res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
  }
}

export class TestLLM implements LLM {
  readonly mode = "test" as const;
  readonly model = "test-responses";
  async generate(req: GenerateRequest): Promise<string> {
    return req.testResponse();
  }
}

export function createLLM(env = process.env): LLM {
  if (env.ANTHROPIC_API_KEY?.trim()) {
    return new AnthropicLLM(new Anthropic(), env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL);
  }
  return new TestLLM();
}
