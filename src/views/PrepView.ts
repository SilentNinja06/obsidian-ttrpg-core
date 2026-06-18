import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import { readNote, readSection } from "../utils/fileIO";
import { collectOpenThreads, collectUnassignedLoot } from "../utils/queries";

export const VIEW_TYPE_PREP = "ttrpg-prep";

export class PrepView extends ItemView {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;

  constructor(
    leaf: WorkspaceLeaf,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string
  ) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_PREP; }
  getDisplayText(): string { return "Session Prep"; }
  getIcon(): string { return "clipboard-list"; }

  async onOpen(): Promise<void> {
    await this.render();
  }

  private campaignFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}`;
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.cssText = "padding:1rem;overflow-y:auto;font-family:var(--font-sans)";

    const campaign = this.campaignManager.getActive();
    if (!campaign) {
      container.createEl("p", { text: "No active campaign.", cls: "ttrpg-muted" });
      return;
    }

    const folder = this.campaignFolder();

    // ── Header ───────────────────────────────────────────────────────────────
    const header = container.createDiv();
    header.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary)";
    const titleWrap = header.createDiv();
    titleWrap.createEl("h2", { text: "Session prep" }).style.cssText = "margin:0;font-size:18px;font-weight:500";
    titleWrap.createEl("p", { text: campaign.name, cls: "ttrpg-muted" }).style.cssText = "margin:2px 0 0;font-size:13px;color:var(--color-text-secondary)";
    const popBtn = header.createEl("button", { text: "⤢ Pop out" });
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // ── Determine last session ───────────────────────────────────────────────
    const sessionFiles = this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(`${folder}/sessions`))
      .sort((a, b) => b.stat.mtime - a.stat.mtime);
    const lastSession = sessionFiles[0];

    // ── Last session threads (highlighted) ───────────────────────────────────
    const allThreads = await collectOpenThreads(this.app, folder);
    const lastThreads = lastSession
      ? allThreads.filter((t) => t.sessionPath === lastSession.path)
      : [];
    const olderThreads = lastSession
      ? allThreads.filter((t) => t.sessionPath !== lastSession.path)
      : allThreads;

    this.sectionHeader(container, lastSession ? `Threads from last session — ${lastSession.basename}` : "Open threads");
    if (lastThreads.length === 0) {
      container.createEl("p", { text: lastSession ? "No threads recorded from last session." : "No sessions yet.", cls: "ttrpg-muted" })
        .style.cssText = "font-size:13px;color:var(--color-text-tertiary);margin:0 0 1rem";
    } else {
      const box = container.createDiv();
      box.style.cssText = "background:var(--color-background-info);border:0.5px solid var(--color-border-info);border-radius:var(--radius-m);padding:8px 12px;margin-bottom:1rem";
      for (const t of lastThreads) this.threadRow(box, t.text, null);
    }

    // ── Older unresolved threads ─────────────────────────────────────────────
    if (olderThreads.length > 0) {
      this.sectionHeader(container, "Older unresolved threads");
      const box = container.createDiv();
      box.style.cssText = "margin-bottom:1rem";
      for (const t of olderThreads) this.threadRow(box, t.text, t.sessionName);
    }

    // ── Party status ─────────────────────────────────────────────────────────
    this.sectionHeader(container, "Party status");
    const pcFolder = `${folder}/characters/pcs`;
    const pcFiles = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(pcFolder));
    const hpKeys = this.systemLoader.get(campaign.system)?.entities?.character?.hp;

    if (pcFiles.length === 0) {
      container.createEl("p", { text: "No player characters yet.", cls: "ttrpg-muted" })
        .style.cssText = "font-size:13px;color:var(--color-text-tertiary);margin:0 0 1rem";
    } else {
      for (const file of pcFiles) {
        await this.pcCard(container, file, hpKeys);
      }
    }

    // ── Unassigned loot ──────────────────────────────────────────────────────
    const loot = await collectUnassignedLoot(this.app, folder);
    this.sectionHeader(container, `Unassigned loot${loot.length ? ` (${loot.length})` : ""}`);
    if (loot.length === 0) {
      container.createEl("p", { text: "No unassigned loot.", cls: "ttrpg-muted" })
        .style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
    } else {
      const box = container.createDiv();
      for (const item of loot) {
        const row = box.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px";
        row.createSpan({ text: item.name }).style.flex = "1";
        row.createSpan({ text: item.source }).style.cssText = "font-size:11px;color:var(--color-text-tertiary)";
      }
    }
  }

  private sectionHeader(container: HTMLElement, text: string): void {
    const h = container.createEl("h3", { text });
    h.style.cssText = "font-size:13px;font-weight:600;color:var(--color-text-primary);margin:0 0 8px;text-transform:uppercase;letter-spacing:0.03em";
  }

  private threadRow(box: HTMLElement, text: string, sessionName: string | null): void {
    const row = box.createDiv();
    row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:4px 0;font-size:13px";
    const dot = row.createSpan();
    dot.style.cssText = "width:6px;height:6px;border-radius:50%;background:#BA7517;flex-shrink:0;margin-top:5px";
    row.createSpan({ text }).style.cssText = "flex:1;color:var(--color-text-primary);line-height:1.4";
    if (sessionName) {
      row.createSpan({ text: sessionName }).style.cssText = "font-size:11px;color:var(--color-text-tertiary);white-space:nowrap";
    }
  }

  private async pcCard(container: HTMLElement, file: TFile, hpKeys: { current: string; max: string } | undefined): Promise<void> {
    const { fm } = await readNote(this.app, file);
    const card = container.createDiv();
    card.style.cssText = "border:0.5px solid var(--color-border-tertiary);border-radius:var(--radius-m);padding:10px 12px;margin-bottom:8px;background:var(--color-background-primary)";

    const top = card.createDiv();
    top.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
    const name = top.createEl("a", { text: file.basename });
    name.style.cssText = "font-size:14px;font-weight:600;color:#185FA5;cursor:pointer";
    name.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(false).openFile(file); };

    if (hpKeys) {
      const cur = (fm[hpKeys.current] as number) ?? 0;
      const max = (fm[hpKeys.max] as number) ?? 0;
      const hp = top.createSpan({ text: `${cur}/${max} HP` });
      const pct = max > 0 ? cur / max : 1;
      const color = pct > 0.5 ? "#1D9E75" : pct > 0.25 ? "#BA7517" : "#E24B4A";
      hp.style.cssText = `font-size:12px;font-weight:600;color:${color}`;
    }

    const conditions = (fm.conditions as string[]) ?? [];
    for (const c of conditions) {
      top.createSpan({ text: c }).style.cssText = "font-size:11px;padding:1px 6px;border-radius:8px;background:#FAEEDA;color:#633806";
    }

    const goal = (fm["current-goal"] as string) || "";
    if (goal) {
      const goalEl = card.createDiv();
      goalEl.style.cssText = "font-size:12px;color:var(--color-text-secondary);line-height:1.4";
      goalEl.createSpan({ text: "Goal: " }).style.cssText = "color:var(--color-text-tertiary);font-weight:600";
      goalEl.createSpan({ text: goal });
    }
  }
}
