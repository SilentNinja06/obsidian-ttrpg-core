import { ItemView, WorkspaceLeaf, TFile, parseYaml } from "obsidian";
import type { SystemLoader } from "../engine/SystemLoader";

// ─── Character View ───────────────────────────────────────────────────────────

export const VIEW_TYPE_CHARACTER = "ttrpg-character";

export class CharacterView extends ItemView {
  private systemLoader: SystemLoader;
  private file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, systemLoader: SystemLoader) {
    super(leaf);
    this.systemLoader = systemLoader;
  }

  getViewType(): string { return VIEW_TYPE_CHARACTER; }
  getDisplayText(): string { return this.file?.basename ?? "Character"; }
  getIcon(): string { return "user"; }

  setFile(file: TFile): void {
    this.file = file;
    this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    if (!this.file) return;

    const content = await this.app.vault.read(this.file);
    const fm = this.parseFrontmatter(content);
    const system = this.systemLoader.get(fm.system as string);
    const stats = system?.entities?.character?.stats ?? [];
    const hpKey = system?.entities?.character?.hp;

    container.addClass("ttrpg-character-view");

    // Header
    const header = container.createDiv("ttrpg-char-header");
    const initials = (this.file.basename ?? "?").slice(0, 2).toUpperCase();
    const avatar = header.createDiv("ttrpg-char-avatar");
    avatar.textContent = initials;

    const meta = header.createDiv("ttrpg-char-meta");
    meta.createEl("h2", { text: this.file.basename });
    meta.createEl("p", {
      text: [fm.class, fm.level ? `Level ${fm.level}` : "", fm.race, fm.alignment]
        .filter(Boolean).join(" · "),
      cls: "ttrpg-muted",
    });

    const tagsRow = meta.createDiv("ttrpg-tags-row");
    for (const tag of (fm.tags as string[] ?? [])) {
      tagsRow.createSpan({ text: tag, cls: "ttrpg-tag" });
    }
    for (const cond of (fm.conditions as string[] ?? [])) {
      tagsRow.createSpan({ text: cond, cls: "ttrpg-tag ttrpg-tag-condition" });
    }

    // HP strip
    if (hpKey) {
      const hpCur = (fm[hpKey.current] as number) ?? 0;
      const hpMax = (fm[hpKey.max] as number) ?? 1;
      const pct = Math.round((hpCur / hpMax) * 100);
      const hpStrip = meta.createDiv("ttrpg-hp-strip");
      const barWrap = hpStrip.createDiv("ttrpg-hp-bar-wrap");
      const bar = barWrap.createDiv("ttrpg-hp-bar");
      bar.style.width = `${pct}%`;
      bar.style.background = pct > 50 ? "#1D9E75" : pct > 25 ? "#BA7517" : "#E24B4A";
      hpStrip.createSpan({ text: `${hpCur} / ${hpMax} HP`, cls: "ttrpg-muted" });
    }

    // Two columns
    const cols = container.createDiv("ttrpg-columns");
    const left = cols.createDiv();
    const right = cols.createDiv();

    // Stat block
    if (stats.length) {
      this.createCollapsibleSection(left, "Stat block", (body) => {
        const grid = body.createDiv("ttrpg-stat-grid");
        for (const stat of stats) {
          const box = grid.createDiv("ttrpg-stat-box");
          const val = (fm[stat.key] as number) ?? 0;
          const mod = Math.floor((val - 10) / 2);
          box.createDiv({ text: String(val), cls: "ttrpg-stat-val" });
          box.createDiv({ text: (mod >= 0 ? "+" : "") + mod, cls: "ttrpg-stat-mod" });
          box.createDiv({ text: stat.label, cls: "ttrpg-stat-lbl" });
        }
      });
    }

    // Arc / backstory (right column)
    this.createCollapsibleSection(right, "Backstory & arc", (body) => {
      for (const field of (system?.arcFields ?? [
        { key: "motivation", label: "Motivation" },
        { key: "secret", label: "Secret" },
        { key: "current-goal", label: "Current goal" },
      ])) {
        const f = body.createDiv("ttrpg-struct-field");
        f.createDiv({ text: field.label, cls: "ttrpg-field-label" });
        f.createDiv({ text: (fm[field.key] as string) ?? "—", cls: "ttrpg-field-val" });
      }
      body.createDiv({ text: "Notes", cls: "ttrpg-field-label" });
      body.createEl("textarea", { cls: "ttrpg-notes-area", attr: { placeholder: "Session observations…" } });
    });

    // Popout button
    const popoutBtn = container.createEl("button", { text: "⤢ Pop out", cls: "ttrpg-popout-btn" });
    popoutBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);
  }

  private createCollapsibleSection(
    parent: HTMLElement,
    title: string,
    builder: (body: HTMLElement) => void
  ): void {
    const section = parent.createDiv("ttrpg-section");
    const head = section.createDiv("ttrpg-section-head");
    head.createSpan({ text: title, cls: "ttrpg-section-title" });
    const toggle = head.createSpan({ text: "▾", cls: "ttrpg-section-toggle open" });
    const body = section.createDiv("ttrpg-section-body");
    builder(body);
    head.onclick = () => {
      body.classList.toggle("hidden");
      toggle.classList.toggle("open");
    };
  }

  private parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    try { return parseYaml(match[1]) ?? {}; }
    catch { return {}; }
  }
}

// ─── Session Note View ────────────────────────────────────────────────────────

export const VIEW_TYPE_SESSION = "ttrpg-session";

export class SessionNoteView extends ItemView {
  private file: TFile | null = null;
  private mode: "capture" | "writeup" = "capture";

  getViewType(): string { return VIEW_TYPE_SESSION; }
  getDisplayText(): string { return this.file?.basename ?? "Session"; }
  getIcon(): string { return "book-open"; }

  setFile(file: TFile): void {
    this.file = file;
    this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    if (!this.file) return;

    container.addClass("ttrpg-session-view");

    // Mode toggle header
    const header = container.createDiv("ttrpg-session-header");
    header.createEl("h2", { text: this.file.basename });

    const modeToggle = header.createDiv("ttrpg-mode-toggle");
    const captureBtn = modeToggle.createEl("button", { text: "Capture", cls: "ttrpg-mode-btn" + (this.mode === "capture" ? " active" : "") });
    const writeupBtn = modeToggle.createEl("button", { text: "Write-up", cls: "ttrpg-mode-btn" + (this.mode === "writeup" ? " active" : "") });

    captureBtn.onclick = () => { this.mode = "capture"; this.render(); };
    writeupBtn.onclick = () => { this.mode = "writeup"; this.render(); };

    if (this.mode === "capture") {
      this.renderCapture(container);
    } else {
      this.renderWriteup(container);
    }
  }

  private renderCapture(container: HTMLElement): void {
    const sections: { title: string; placeholder: string }[] = [
      { title: "What happened", placeholder: "Quick bullet…" },
      { title: "NPCs encountered", placeholder: "NPC name…" },
      { title: "Loot (unassigned)", placeholder: "Item name…" },
      { title: "Quotes & moments", placeholder: "Quote or moment…" },
      { title: "Loose threads", placeholder: "Unresolved hook…" },
      { title: "Decisions", placeholder: "What did the party decide?…" },
    ];
    const grid = container.createDiv("ttrpg-capture-grid");
    for (const { title, placeholder } of sections) {
      const block = grid.createDiv("ttrpg-cap-block");
      const head = block.createDiv("ttrpg-cap-head");
      head.createSpan({ text: title, cls: "ttrpg-cap-label" });
      const body = block.createDiv("ttrpg-cap-body");
      const list = body.createEl("ul", { cls: "ttrpg-bullet-list" });
      const inputRow = body.createDiv("ttrpg-quick-input");
      const input = inputRow.createEl("input", { attr: { placeholder } });
      input.style.color = "var(--text-normal)";
      const addBtn = inputRow.createEl("button", { text: "Add" });
      addBtn.onclick = () => {
        const val = input.value.trim();
        if (!val) return;
        const li = list.createEl("li", { cls: "ttrpg-bullet-item" });
        li.createSpan({ cls: "ttrpg-bullet-dot" });
        li.createSpan({ text: val, cls: "ttrpg-bullet-text" });
        input.value = "";
      };
      input.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
    }
  }

  private renderWriteup(container: HTMLElement): void {
    const areas: { title: string; placeholder: string }[] = [
      { title: "Plot summary", placeholder: "What happened this session, in prose…" },
      { title: "Decisions & why", placeholder: "What the party decided and the reasoning behind it…" },
      { title: "Memorable moments", placeholder: "Quotes, character beats, things worth keeping…" },
      { title: "Loose threads", placeholder: "Unresolved hooks for next time…" },
    ];
    for (const { title, placeholder } of areas) {
      const section = container.createDiv("ttrpg-section");
      section.createEl("h3", { text: title });
      const ta = section.createEl("textarea", { cls: "ttrpg-notes-area", attr: { placeholder } });
      ta.style.color = "var(--text-normal)";
    }
  }
}

// ─── Lore View ────────────────────────────────────────────────────────────────

export const VIEW_TYPE_LORE = "ttrpg-lore";

export class LoreView extends ItemView {
  private file: TFile | null = null;

  getViewType(): string { return VIEW_TYPE_LORE; }
  getDisplayText(): string { return this.file?.basename ?? "Lore"; }
  getIcon(): string { return "map"; }

  setFile(file: TFile): void {
    this.file = file;
    this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    if (!this.file) return;

    const content = await this.app.vault.read(this.file);
    const fm = this.parseFrontmatter(content);

    container.addClass("ttrpg-lore-view");

    // Header
    const iconMap: Record<string, string> = { location: "🏰", faction: "⚔️", history: "📜" };
    const type = (fm["ttrpg-type"] as string) ?? "location";
    const header = container.createDiv("ttrpg-lore-header");
    header.createDiv({ text: iconMap[type] ?? "📄", cls: "ttrpg-lore-icon" });
    const meta = header.createDiv("ttrpg-lore-meta");
    meta.createEl("h2", { text: this.file.basename });
    meta.createEl("p", { text: `${type} · ${fm.campaign ?? ""}`, cls: "ttrpg-muted" });
    const tagsRow = meta.createDiv("ttrpg-tags-row");
    tagsRow.createSpan({ text: type, cls: "ttrpg-tag ttrpg-tag-type" });
    const status = (fm.status as string) ?? "active";
    tagsRow.createSpan({ text: status, cls: `ttrpg-tag ttrpg-tag-status-${status}` });

    // Two columns
    const cols = container.createDiv("ttrpg-columns");
    const left = cols.createDiv();
    const right = cols.createDiv();

    // Core fields (left)
    this.createSection(left, "Details", (body) => {
      const coreFields: Record<string, string[]> = {
        location: ["region", "type", "controlled-by", "notable-features"],
        faction: ["alignment", "goals", "resources", "leadership"],
        history: ["era", "location", "parties-involved", "outcome"],
      };
      for (const key of (coreFields[type] ?? [])) {
        const val = fm[key];
        if (!val) continue;
        const f = body.createDiv("ttrpg-struct-field");
        f.createDiv({ text: key.replace(/-/g, " "), cls: "ttrpg-field-label" });
        f.createDiv({ text: String(val), cls: "ttrpg-field-val" });
      }
      body.createDiv({ text: "Notes", cls: "ttrpg-field-label" });
      const ta = body.createEl("textarea", { cls: "ttrpg-notes-area", attr: { placeholder: "DM notes, atmosphere, observations…" } });
      ta.style.color = "var(--text-normal)";
    });

    // Session appearances (right)
    this.createSection(right, "Session appearances", (body) => {
      const appearances = (fm["session-appearances"] as string[]) ?? [];
      if (appearances.length === 0) {
        body.createEl("p", { text: "No sessions yet — wikilinks will auto-populate via Dataview.", cls: "ttrpg-muted" });
      } else {
        for (const sess of appearances) {
          body.createSpan({ text: sess, cls: "ttrpg-session-pill" });
        }
      }
    });

    // Connections (right)
    this.createSection(right, "Connected characters", (body) => {
      body.createEl("p", { text: "Populated via Dataview query.", cls: "ttrpg-muted" });
    });
  }

  private createSection(
    parent: HTMLElement,
    title: string,
    builder: (body: HTMLElement) => void
  ): void {
    const section = parent.createDiv("ttrpg-section");
    const head = section.createDiv("ttrpg-section-head");
    head.createSpan({ text: title, cls: "ttrpg-section-title" });
    const toggle = head.createSpan({ text: "▾", cls: "ttrpg-section-toggle open" });
    const body = section.createDiv("ttrpg-section-body");
    builder(body);
    head.onclick = () => {
      body.classList.toggle("hidden");
      toggle.classList.toggle("open");
    };
  }

  private parseFrontmatter(content: string): Record<string, unknown> {
    const match = content.match(/^---\n([\s\S]*?)\n---/);
    if (!match) return {};
    try { return parseYaml(match[1]) ?? {}; }
    catch { return {}; }
  }
}
