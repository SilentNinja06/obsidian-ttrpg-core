import { App, TFile, Notice, normalizePath } from "obsidian";
import { jsPDF } from "jspdf";
import type { CampaignManager } from "./CampaignManager";
import type { TTRPGSettings } from "../types";
import { readNote, readSection } from "../utils/fileIO";
import { SessionData, makeProseEngine, DeterministicProse } from "./RecapProse";

export type RecapScope = "last" | "campaign";
export type RecapStyle = "narrative" | "bulleted";

export class RecapGenerator {
  private app: App;
  private campaignManager: CampaignManager;
  private settings: TTRPGSettings;

  constructor(app: App, campaignManager: CampaignManager, settings: TTRPGSettings) {
    this.app = app;
    this.campaignManager = campaignManager;
    this.settings = settings;
  }

  private campaignFolder(): string {
    return `${this.settings.defaultCampaignFolder}/${this.campaignManager.getActiveId()}`;
  }

  /** All session files for the active campaign, sorted by session number / date / ctime. */
  private sessionFiles(): TFile[] {
    const folder = `${this.campaignFolder()}/sessions`;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));
    return files.sort((a, b) => {
      const fa = this.app.metadataCache.getFileCache(a)?.frontmatter;
      const fb = this.app.metadataCache.getFileCache(b)?.frontmatter;
      const na = parseInt(String(fa?.["session-number"] ?? "")) || 0;
      const nb = parseInt(String(fb?.["session-number"] ?? "")) || 0;
      if (na && nb && na !== nb) return na - nb;
      const da = fa?.date ? new Date(fa.date as string).getTime() : a.stat.ctime;
      const db = fb?.date ? new Date(fb.date as string).getTime() : b.stat.ctime;
      return da - db;
    });
  }

  private async parseSession(file: TFile): Promise<SessionData> {
    const { fm, body } = await readNote(this.app, file);
    const bullets = (section: string): string[] => {
      const raw = readSection(body, section);
      return raw
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.startsWith("-") || l.startsWith("*"))
        .map((l) => l.replace(/^[-*]\s*/, "").trim())
        .filter((l) => l && !l.startsWith("_") && !l.startsWith("<!--"));
    };
    // For "what happened", also accept prose (non-bullet) lines
    const whatRaw = readSection(body, "What happened");
    const whatHappened = whatRaw
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("_") && !l.startsWith("<!--") && !l.startsWith("#"))
      .map((l) => l.replace(/^[-*]\s*/, "").trim());

    return {
      title: file.basename,
      number: fm?.["session-number"] ? String(fm["session-number"]) : undefined,
      date: fm?.date ? String(fm.date) : undefined,
      whatHappened,
      decisions: bullets("Decisions"),
      npcs: bullets("NPCs encountered"),
      loot: bullets("Loot (unassigned)"),
      threads: bullets("Loose threads"),
      quotes: bullets("Quotes & moments"),
    };
  }

  /** Generate the recap and write a PDF into the vault, returning the file. */
  async generate(scope: RecapScope, style: RecapStyle): Promise<TFile | null> {
    const campaign = this.campaignManager.getActive();
    if (!campaign) { new Notice("No active campaign."); return null; }

    let files = this.sessionFiles();
    if (files.length === 0) { new Notice("No sessions to recap yet."); return null; }
    if (scope === "last") files = [files[files.length - 1]];

    const sessions: SessionData[] = [];
    for (const f of files) sessions.push(await this.parseSession(f));

    let proseText = "";
    let usedAi = false;
    if (style === "narrative") {
      const engine = makeProseEngine(this.settings);
      try {
        proseText = await engine.narrative(sessions, campaign.name);
        usedAi = engine.constructor.name === "AiProse";
      } catch (e) {
        new Notice(`AI recap failed, using offline stitcher. (${(e as Error).message.slice(0, 80)})`);
        proseText = await new DeterministicProse().narrative(sessions, campaign.name);
      }
    }

    const pdf = this.renderPdf(campaign.name, scope, style, sessions, proseText);

    // Write into the vault
    const recapsFolder = normalizePath(`${this.campaignFolder()}/recaps`);
    if (!this.app.vault.getFolderByPath(recapsFolder)) {
      await this.app.vault.createFolder(recapsFolder).catch(() => {});
    }
    const stamp = new Date().toISOString().slice(0, 10);
    const scopeLabel = scope === "last" ? "last-session" : "campaign";
    const path = normalizePath(`${recapsFolder}/recap-${scopeLabel}-${stamp}.pdf`);
    const buffer = pdf.output("arraybuffer");

    const existing = this.app.vault.getFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) {
      await this.app.vault.modifyBinary(existing, buffer);
      file = existing;
    } else {
      file = await this.app.vault.createBinary(path, buffer);
    }

    new Notice(`Recap generated${usedAi ? " (AI)" : ""}: ${file.name}`);
    await this.app.workspace.getLeaf(true).openFile(file);
    return file;
  }

  private renderPdf(
    campaignName: string,
    scope: RecapScope,
    style: RecapStyle,
    sessions: SessionData[],
    proseText: string
  ): jsPDF {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 56;
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const maxW = pageW - margin * 2;
    let y = margin;

    const ensureSpace = (needed: number) => {
      if (y + needed > pageH - margin) { doc.addPage(); y = margin; }
    };
    const text = (str: string, size: number, style2: "normal" | "bold" | "italic", gap = 4, color: [number, number, number] = [30, 30, 30]) => {
      doc.setFont("helvetica", style2);
      doc.setFontSize(size);
      doc.setTextColor(color[0], color[1], color[2]);
      const lines = doc.splitTextToSize(str, maxW) as string[];
      for (const line of lines) {
        ensureSpace(size + gap);
        doc.text(line, margin, y);
        y += size + gap;
      }
    };

    // Title
    text(campaignName, 24, "bold", 6, [20, 20, 20]);
    const sub = scope === "last" ? "Last Session Recap" : "Campaign Recap";
    text(sub, 13, "italic", 10, [110, 110, 110]);
    text(new Date().toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" }), 10, "normal", 14, [140, 140, 140]);

    if (style === "narrative") {
      // Parse the prose markdown-ish output (### headings + paragraphs)
      const blocks = proseText.split("\n\n");
      for (const block of blocks) {
        if (block.startsWith("### ")) {
          y += 6;
          text(block.replace(/^###\s*/, ""), 15, "bold", 5, [40, 40, 40]);
        } else {
          text(block.replace(/^_|_$/g, ""), 11, "normal", 5);
          y += 4;
        }
      }
    } else {
      // Bulleted digest
      for (const s of sessions) {
        y += 6;
        const heading = s.number ? `Session ${s.number}` : s.title;
        text(heading + (s.date ? `  ·  ${s.date}` : ""), 15, "bold", 5, [40, 40, 40]);
        const sec = (label: string, items: string[]) => {
          if (!items.length) return;
          text(label, 11, "bold", 3, [90, 90, 90]);
          for (const it of items) {
            const clean = it.replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, (_m, p1, p2) => (p2 ? p2.slice(1) : p1));
            text("•  " + clean, 11, "normal", 3);
          }
          y += 4;
        };
        sec("What happened", s.whatHappened);
        sec("Decisions", s.decisions);
        sec("NPCs encountered", s.npcs);
        sec("Loot", s.loot);
        sec("Open threads", s.threads);
        sec("Quotes & moments", s.quotes);
      }
    }

    // Footer page numbers
    const pages = doc.getNumberOfPages();
    for (let i = 1; i <= pages; i++) {
      doc.setPage(i);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(160, 160, 160);
      doc.text(`${campaignName} · page ${i} of ${pages}`, pageW / 2, pageH - 28, { align: "center" });
    }

    return doc;
  }
}
