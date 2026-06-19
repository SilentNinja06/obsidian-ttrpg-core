import type { TTRPGSettings } from "../types";

/** A parsed session, normalized for recap generation. */
export interface SessionData {
  title: string;
  number?: string;
  date?: string;
  whatHappened: string[];
  decisions: string[];
  npcs: string[];
  loot: string[];
  threads: string[];
  quotes: string[];
}

/** Interchangeable prose generators. Deterministic is always available; AI is optional. */
export interface RecapProse {
  /** Produce a narrative prose recap for one or more sessions. */
  narrative(sessions: SessionData[], campaignName: string): Promise<string>;
}

/**
 * Offline deterministic stitcher. Turns structured session notes into flowing
 * prose using connective phrasing — no network, fully predictable.
 */
export class DeterministicProse implements RecapProse {
  async narrative(sessions: SessionData[], campaignName: string): Promise<string> {
    const paras: string[] = [];

    for (const s of sessions) {
      const sentences: string[] = [];

      if (s.whatHappened.length) {
        sentences.push(this.stitchEvents(s.whatHappened));
      }
      if (s.decisions.length) {
        sentences.push(this.stitchDecisions(s.decisions));
      }
      if (s.npcs.length) {
        sentences.push(this.stitchNpcs(s.npcs));
      }
      if (s.loot.length) {
        sentences.push(this.stitchLoot(s.loot));
      }
      if (s.threads.length) {
        sentences.push(this.stitchThreads(s.threads));
      }

      const heading = s.number ? `Session ${s.number}` : s.title;
      const body = sentences.filter(Boolean).join(" ");
      if (body.trim()) {
        paras.push(`### ${heading}\n\n${body}`);
      }
    }

    if (paras.length === 0) {
      return `_No session content yet for ${campaignName}._`;
    }
    return paras.join("\n\n");
  }

  private stitchEvents(events: string[]): string {
    const clean = events.map((e) => this.stripLink(e));
    if (clean.length === 1) return `${this.cap(clean[0])}.`;
    const last = clean[clean.length - 1];
    const rest = clean.slice(0, -1);
    const connectors = ["", "Then ", "After that, ", "Next, ", "Soon, "];
    const parts = rest.map((e, i) => {
      const c = connectors[Math.min(i, connectors.length - 1)];
      return `${c}${c ? this.lower(e) : this.cap(e)}`;
    });
    return `${parts.join(". ")}. Finally, ${this.lower(last)}.`;
  }

  private stitchDecisions(decisions: string[]): string {
    const clean = decisions.map((d) => this.lower(this.stripLink(d)));
    if (clean.length === 1) return `The party chose to ${clean[0]}.`;
    return `The party decided to ${clean.slice(0, -1).join(", ")}, and ${clean[clean.length - 1]}.`;
  }

  private stitchNpcs(npcs: string[]): string {
    const names = npcs.map((n) => this.npcName(n));
    if (names.length === 1) return `Along the way they encountered ${names[0]}.`;
    return `Along the way they crossed paths with ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`;
  }

  private stitchLoot(loot: string[]): string {
    const items = loot.map((l) => this.stripLink(l));
    if (items.length === 1) return `They came away with ${items[0]}.`;
    return `Their haul included ${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}.`;
  }

  private stitchThreads(threads: string[]): string {
    const t = threads.map((x) => this.lower(this.stripLink(x)));
    if (t.length === 1) return `Left unresolved: ${t[0]}.`;
    return `Still hanging over them: ${t.slice(0, -1).join("; ")}; and ${t[t.length - 1]}.`;
  }

  private npcName(raw: string): string {
    const stripped = this.stripLink(raw);
    // Take text before an em-dash or hyphen note
    const m = stripped.split(/[—–-]/)[0].trim();
    return m || stripped;
  }

  private stripLink(s: string): string {
    return s.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_m, p1, p2) => (p2 ? p2.slice(1) : p1)).trim();
  }
  private cap(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1); }
  private lower(s: string): string { return s.charAt(0).toLowerCase() + s.slice(1); }
}

/**
 * Optional AI prose generator. Compatible with Anthropic, OpenAI-style, and
 * custom endpoints. Only used when the user explicitly enables and configures it.
 * Falls back by throwing — callers catch and use DeterministicProse.
 */
export class AiProse implements RecapProse {
  private settings: TTRPGSettings;
  constructor(settings: TTRPGSettings) { this.settings = settings; }

  static isConfigured(s: TTRPGSettings): boolean {
    if (s.recapProseEngine !== "ai") return false;
    if (!s.aiApiKey.trim()) return false;
    if (s.aiProvider === "custom" && !s.aiEndpoint.trim()) return false;
    return true;
  }

  async narrative(sessions: SessionData[], campaignName: string): Promise<string> {
    const prompt = this.buildPrompt(sessions, campaignName);
    const { url, headers, body, extract } = this.buildRequest(prompt);
    const res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body) });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`AI request failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = await res.json();
    const out = extract(json);
    if (!out) throw new Error("AI returned an empty response");
    return out;
  }

  private buildPrompt(sessions: SessionData[], campaignName: string): string {
    const lines: string[] = [
      `Write a recap for the tabletop RPG campaign "${campaignName}".`,
      `Use an engaging, story-style narrative voice. Base it ONLY on the notes below; do not invent events.`,
      ``,
    ];
    for (const s of sessions) {
      lines.push(`## ${s.number ? `Session ${s.number}` : s.title}`);
      if (s.whatHappened.length) lines.push(`Events: ${s.whatHappened.join("; ")}`);
      if (s.decisions.length) lines.push(`Decisions: ${s.decisions.join("; ")}`);
      if (s.npcs.length) lines.push(`NPCs: ${s.npcs.join("; ")}`);
      if (s.loot.length) lines.push(`Loot: ${s.loot.join("; ")}`);
      if (s.threads.length) lines.push(`Open threads: ${s.threads.join("; ")}`);
      lines.push("");
    }
    return lines.join("\n");
  }

  private buildRequest(prompt: string): { url: string; headers: Record<string, string>; body: any; extract: (j: any) => string } {
    const { aiProvider, aiEndpoint, aiApiKey, aiModel } = this.settings;

    if (aiProvider === "anthropic") {
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": aiApiKey,
          "anthropic-version": "2023-06-01",
          "anthropic-dangerous-direct-browser-access": "true",
        },
        body: { model: aiModel || "claude-sonnet-4-6", max_tokens: 2000, messages: [{ role: "user", content: prompt }] },
        extract: (j) => (j?.content?.[0]?.text ?? "").trim(),
      };
    }

    // OpenAI-compatible (and custom endpoints that follow the chat schema)
    const url = aiProvider === "openai"
      ? "https://api.openai.com/v1/chat/completions"
      : aiEndpoint;
    return {
      url,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${aiApiKey}` },
      body: { model: aiModel || "gpt-4o-mini", max_tokens: 2000, messages: [{ role: "user", content: prompt }] },
      extract: (j) => (j?.choices?.[0]?.message?.content ?? "").trim(),
    };
  }
}

/** Pick the prose engine based on settings, with safe fallback to deterministic. */
export function makeProseEngine(settings: TTRPGSettings): RecapProse {
  if (AiProse.isConfigured(settings)) {
    return new AiProse(settings);
  }
  return new DeterministicProse();
}
