import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import { readNote, readSection } from "../utils/fileIO";

export const VIEW_TYPE_TIMELINE = "ttrpg-timeline";

interface TimelineEvent {
  title: string;
  label: string;       // display date/era label
  detail: string;
  type: "history" | "session" | "arc";
  path: string;
  order: number;       // sort key
}

const TYPE_META: Record<string, { icon: string; color: string }> = {
  history: { icon: "📜", color: "#7C3AED" },
  session: { icon: "📋", color: "#378ADD" },
  arc: { icon: "👤", color: "#C2410C" },
};

export class TimelineView extends ItemView {
  private campaignManager: CampaignManager;
  private campaignsFolder: string;
  private mode: "in-world" | "play-order" = "in-world";

  constructor(leaf: WorkspaceLeaf, campaignManager: CampaignManager, campaignsFolder: string) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_TIMELINE; }
  getDisplayText(): string { return "Timeline"; }
  getIcon(): string { return "history"; }

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

    // Header + mode toggle
    const header = container.createDiv();
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap;gap:8px";
    const titleWrap = header.createDiv();
    titleWrap.createEl("h2", { text: "Timeline" }).style.cssText = "margin:0;font-size:18px;font-weight:500";
    titleWrap.createEl("p", { text: campaign.name }).style.cssText = "margin:2px 0 0;font-size:13px;color:var(--color-text-secondary)";

    const controls = header.createDiv();
    controls.style.cssText = "display:flex;gap:8px;align-items:center";
    const toggle = controls.createDiv();
    toggle.style.cssText = "display:flex;border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-m);overflow:hidden";
    const inWorldBtn = toggle.createEl("button", { text: "In-world" });
    const playBtn = toggle.createEl("button", { text: "Play order" });
    [inWorldBtn, playBtn].forEach(b => b.style.cssText = "font-size:12px;padding:5px 12px;background:none;border:none;cursor:pointer;color:var(--color-text-secondary)");
    if (this.mode === "in-world") inWorldBtn.style.cssText += ";background:var(--color-background-secondary);color:var(--color-text-primary);font-weight:600";
    else playBtn.style.cssText += ";background:var(--color-background-secondary);color:var(--color-text-primary);font-weight:600";
    inWorldBtn.onclick = () => { this.mode = "in-world"; this.render(); };
    playBtn.onclick = () => { this.mode = "play-order"; this.render(); };

    const popBtn = controls.createEl("button", { text: "⤢ Pop out" });
    popBtn.style.cssText = "font-size:12px;padding:5px 10px";
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // Gather events
    const events = await this.gatherEvents();
    const sorted = this.mode === "in-world"
      ? events.filter(e => e.type !== "session" || e.order !== Infinity).sort((a, b) => a.order - b.order)
      : events.slice().sort((a, b) => a.order - b.order);

    if (sorted.length === 0) {
      container.createEl("p", { text: "No events yet. Add history notes, sessions, or character arc stages.", cls: "ttrpg-muted" })
        .style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
      return;
    }

    // Render timeline
    const timeline = container.createDiv();
    timeline.style.cssText = "position:relative;padding-left:24px";
    // Vertical line
    const line = timeline.createDiv();
    line.style.cssText = "position:absolute;left:7px;top:8px;bottom:8px;width:2px;background:var(--color-border-tertiary)";

    for (const ev of sorted) {
      const meta = TYPE_META[ev.type];
      const row = timeline.createDiv();
      row.style.cssText = "position:relative;margin-bottom:16px";

      // Dot
      const dot = row.createDiv();
      dot.style.cssText = `position:absolute;left:-21px;top:3px;width:12px;height:12px;border-radius:50%;background:${meta.color};border:2px solid var(--color-background-primary)`;

      // Label
      const labelRow = row.createDiv();
      labelRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:2px";
      labelRow.createSpan({ text: meta.icon });
      const lbl = labelRow.createSpan({ text: ev.label });
      lbl.style.cssText = `font-size:12px;font-weight:600;color:${meta.color};text-transform:uppercase;letter-spacing:0.03em`;
      labelRow.createSpan({ text: ev.type }).style.cssText = "font-size:10px;padding:1px 6px;border-radius:6px;background:var(--color-background-secondary);color:var(--color-text-tertiary)";

      // Title (clickable)
      const title = row.createEl("a", { text: ev.title });
      title.style.cssText = "font-size:14px;font-weight:500;color:#185FA5;cursor:pointer;display:block";
      title.onclick = (e) => {
        e.preventDefault();
        const f = this.app.vault.getFileByPath(ev.path);
        if (f) this.app.workspace.getLeaf(false).openFile(f);
      };

      if (ev.detail) {
        const detail = row.createDiv({ text: ev.detail });
        detail.style.cssText = "font-size:12px;color:var(--color-text-secondary);line-height:1.4;margin-top:2px";
      }
    }
  }

  private async gatherEvents(): Promise<TimelineEvent[]> {
    const folder = this.campaignFolder();
    const events: TimelineEvent[] = [];
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;
      const type = fm["ttrpg-type"];

      if (type === "history") {
        const order = typeof fm["timeline-order"] === "number" ? fm["timeline-order"] : 9999;
        const label = (fm.era as string) || "Unknown era";
        const { body } = await readNote(this.app, file);
        const detail = this.firstLine(readSection(body, "What happened"));
        events.push({ title: file.basename, label, detail, type: "history", path: file.path, order });
      } else if (type === "session") {
        const dateStr = (fm.date as string) || "";
        const playOrder = dateStr ? new Date(dateStr).getTime() : file.stat.ctime;
        // Sessions appear in play-order; in in-world mode they sort after history (high order)
        const order = this.mode === "play-order" ? playOrder : Infinity;
        const label = dateStr || "Session";
        const { body } = await readNote(this.app, file);
        const detail = this.firstLine(readSection(body, "What happened"));
        events.push({ title: file.basename, label, detail, type: "session", path: file.path, order });
      } else if (type === "character") {
        const arcStage = (fm["arc-stage"] as string) || "";
        if (arcStage.trim()) {
          // Arc moments: in-world they sit with the character's order if set, else end
          const order = this.mode === "play-order" ? file.stat.mtime : (typeof fm["timeline-order"] === "number" ? fm["timeline-order"] : 9998);
          events.push({
            title: `${file.basename} — arc`,
            label: arcStage,
            detail: (fm["current-goal"] as string) || "",
            type: "arc",
            path: file.path,
            order,
          });
        }
      }
    }

    return events;
  }

  private firstLine(text: string): string {
    const line = text.split("\n").map(l => l.trim()).filter(l => l && !l.startsWith("_") && !l.startsWith("<!--"))[0] || "";
    return line.replace(/^-\s*/, "").slice(0, 140);
  }
}
