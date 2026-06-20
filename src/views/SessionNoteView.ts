import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import { readNote, writeNoteSection, writeFrontmatterKey, readSection, stripHintPlaceholder } from "../utils/fileIO";
import { promptText } from "../modals/InputModal";

export const VIEW_TYPE_SESSION = "ttrpg-session";

export class SessionNoteView extends ItemView {
  file: TFile | null = null;
  private mode: "capture" | "writeup" = "capture";

  getViewType(): string { return VIEW_TYPE_SESSION; }
  getDisplayText(): string { return this.file?.basename ?? "Session"; }
  getIcon(): string { return "book-open"; }

  setFile(file: TFile): void {
    this.file = file;
    this.render();
  }

  async setState(state: any, result: any): Promise<void> {
    if (state?.file) {
      const f = this.app.vault.getFileByPath(state.file);
      if (f instanceof TFile) {
        this.file = f;
        await this.render();
      }
    }
    return super.setState(state, result);
  }

  getState(): any {
    const state = super.getState();
    if (this.file) state.file = this.file.path;
    return state;
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    if (!this.file) return;

    const { fm, body } = await readNote(this.app, this.file);
    container.style.cssText = "padding:1rem;overflow-y:auto;font-family:var(--font-sans)";

    // ── Top bar ──────────────────────────────────────────────────────────────
    const topBar = container.createDiv();
    topBar.style.cssText = "display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary)";

    const metaDiv = topBar.createDiv();
    metaDiv.style.flex = "1";
    metaDiv.createEl("h2", { text: this.file.basename }).style.cssText = "margin:0 0 3px;font-size:18px;font-weight:500;color:var(--color-text-primary)";
    metaDiv.createEl("p", {
      text: [fm.date, fm.campaign, fm.system].filter(Boolean).join(" · "),
    }).style.cssText = "margin:0;font-size:13px;color:var(--color-text-secondary)";

    const controls = topBar.createDiv();
    controls.style.cssText = "display:flex;flex-direction:column;gap:6px;align-items:flex-end";

    // Mode toggle
    const modeToggle = controls.createDiv();
    modeToggle.style.cssText = "display:flex;border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);overflow:hidden";
    const capBtn = modeToggle.createEl("button", { text: "Capture" });
    const wuBtn = modeToggle.createEl("button", { text: "Write-up" });
    [capBtn, wuBtn].forEach(b => b.style.cssText = "font-size:12px;padding:5px 12px;background:none;border:none;cursor:pointer;font-family:var(--font-sans);color:var(--color-text-secondary)");
    if (this.mode === "capture") capBtn.style.cssText += ";background:var(--color-background-secondary);color:var(--color-text-primary);font-weight:500";
    else wuBtn.style.cssText += ";background:var(--color-background-secondary);color:var(--color-text-primary);font-weight:500";

    capBtn.onclick = () => { this.mode = "capture"; this.render(); };
    wuBtn.onclick = () => { this.mode = "writeup"; this.render(); };

    // Source + popout
    const btnRow = controls.createDiv();
    btnRow.style.cssText = "display:flex;gap:5px";
    const srcBtn = btnRow.createEl("button", { text: "Edit source" });
    srcBtn.onclick = () => { if (this.file) this.app.workspace.getLeaf("tab").openFile(this.file); };
    const popBtn = btnRow.createEl("button", { text: "⤢ Pop out" });
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // ── Content ──────────────────────────────────────────────────────────────
    if (this.mode === "capture") {
      this.renderCapture(container, body);
    } else {
      this.renderWriteup(container, body, fm);
    }
  }

  private renderCapture(container: HTMLElement, body: string): void {
    const grid = container.createDiv();
    grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";

    // What happened — full width
    this.captureBlock(grid, "What happened", "Quick bullet…", body, true);

    // Two column blocks
    this.captureBlock(grid, "Decisions", "What did the party decide?…", body);
    this.captureBlock(grid, "NPCs encountered", "NPC name…", body);
    this.captureBlock(grid, "Loot (unassigned)", "Item name…", body);
    this.captureBlock(grid, "Quotes & moments", "Quote or moment…", body);
    this.captureBlock(grid, "Loose threads", "Unresolved hook…", body);

    // XP — full width
    const xpBlock = this.captureBlockEl(grid, "XP & milestones", true);
    const xpContent = stripHintPlaceholder(readSection(body, "XP & milestones"));
    const xpTa = xpBlock.createEl("textarea");
    xpTa.value = xpContent;
    xpTa.placeholder = "XP gained, milestones reached…";
    xpTa.style.cssText = "width:100%;min-height:60px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
    xpTa.onblur = async () => {
      if (this.file) await writeNoteSection(this.app, this.file, "XP & milestones", xpTa.value);
    };
  }

  private captureBlock(
    grid: HTMLElement,
    title: string,
    placeholder: string,
    body: string,
    fullWidth = false
  ): void {
    const block = this.captureBlockEl(grid, title, fullWidth);
    const existing = readSection(body, title);
    const lines = existing.split("\n").filter(l => l.trim().startsWith("-")).map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);

    const list = block.createEl("ul");
    list.style.cssText = "list-style:none;padding:0;margin:0 0 6px";

    const renderItems = () => {
      list.empty();
      for (const line of lines) {
        const li = list.createEl("li");
        li.style.cssText = "display:flex;align-items:flex-start;gap:6px;padding:3px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px;color:var(--color-text-primary)";
        const dot = li.createSpan();
        dot.style.cssText = "width:5px;height:5px;border-radius:50%;background:var(--color-border-secondary);flex-shrink:0;margin-top:6px";
        li.createSpan({ text: line }).style.flex = "1";
        const del = li.createEl("button", { text: "×" });
        del.style.cssText = "font-size:12px;background:none;border:none;cursor:pointer;color:var(--color-text-tertiary);padding:0 2px";
        del.onclick = async () => {
          lines.splice(lines.indexOf(line), 1);
          renderItems();
          if (this.file) await writeNoteSection(this.app, this.file, title, lines.map(l => `- ${l}`).join("\n"));
        };
      }
    };
    renderItems();

    const inputRow = block.createDiv();
    inputRow.style.cssText = "display:flex;gap:5px";
    const inp = inputRow.createEl("input");
    inp.placeholder = placeholder;
    inp.style.cssText = "flex:1;font-size:13px;padding:4px 7px;color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md)";
    const addBtn = inputRow.createEl("button", { text: "Add" });
    addBtn.style.cssText = "font-size:12px;padding:4px 8px";
    addBtn.onclick = async () => {
      const val = inp.value.trim();
      if (!val) return;
      lines.push(val);
      renderItems();
      inp.value = "";
      if (this.file) await writeNoteSection(this.app, this.file, title, lines.map(l => `- ${l}`).join("\n"));
    };
    inp.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
  }

  private captureBlockEl(grid: HTMLElement, title: string, fullWidth = false): HTMLElement {
    const block = grid.createDiv();
    if (fullWidth) block.style.gridColumn = "1 / -1";
    block.style.cssText += ";border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);overflow:hidden";
    const head = block.createDiv();
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:7px 10px;background:var(--color-background-secondary);border-bottom:0.5px solid var(--color-border-tertiary)";
    head.createSpan({ text: title }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em";
    const body = block.createDiv();
    body.style.cssText = "padding:8px 10px;background:var(--color-background-primary)";
    return body;
  }

  private renderWriteup(container: HTMLElement, body: string, fm: Record<string, unknown>): void {
    const cols = container.createDiv();
    cols.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px";
    const left = cols.createDiv();
    const right = cols.createDiv();

    // Left: plot summary, decisions, moments
    this.writeupSection(left, "Plot summary", "What happened this session, in prose…", body, "What happened");
    this.writeupSection(left, "Decisions & why", "What the party decided and the reasoning…", body, "Decisions");
    this.writeupSection(left, "Memorable moments", "Quotes, beats, things worth keeping…", body, "Quotes & moments");

    // Right: loose threads, npcs, loot+xp
    this.writeupSection(right, "Loose threads", "Unresolved hooks for next time…", body, "Loose threads");
    this.writeupSection(right, "NPCs", "Notes on who the party met…", body, "NPCs encountered");

    // Loot + XP combined
    this.section(right, "Loot & XP", (b) => {
      const lootContent = readSection(body, "Loot (unassigned)");
      const lootLines = lootContent.split("\n").filter(l => l.trim()).map(l => l.replace(/^-\s*/, "").trim()).filter(Boolean);

      for (const item of lootLines) {
        const row = b.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px";
        row.createSpan({ text: item }).style.flex = "1";
        const badge = row.createSpan({ text: "unassigned" });
        badge.style.cssText = "font-size:11px;padding:1px 6px;border-radius:8px;background:#FAEEDA;color:#633806;cursor:pointer";
        badge.onclick = async () => {
          const who = await promptText(this.app, "Assign loot", `Assign "${item}" to:`);
          if (!who) return;
          badge.textContent = who;
          badge.style.background = "#EAF3DE";
          badge.style.color = "#27500A";
          badge.onclick = null;
        };
      }

      b.createDiv({ text: "XP & milestones" }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin:10px 0 4px";
      const xpContent = stripHintPlaceholder(readSection(body, "XP & milestones"));
      const ta = b.createEl("textarea");
      ta.value = xpContent;
      ta.placeholder = "XP gained, running total…";
      ta.style.cssText = "width:100%;min-height:60px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, "XP & milestones", ta.value);
      };
    });
  }

  private writeupSection(parent: HTMLElement, displayTitle: string, placeholder: string, body: string, sectionName: string): void {
    this.section(parent, displayTitle, (b) => {
      const content = stripHintPlaceholder(readSection(body, sectionName));
      const ta = b.createEl("textarea");
      ta.value = content;
      ta.placeholder = placeholder;
      ta.style.cssText = "width:100%;min-height:90px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, sectionName, ta.value);
      };
    });
  }

  private section(parent: HTMLElement, title: string, builder: (body: HTMLElement) => void): void {
    const wrap = parent.createDiv();
    wrap.style.cssText = "border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-lg);overflow:hidden;margin-bottom:10px";
    const head = wrap.createDiv();
    head.style.cssText = "display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--color-background-secondary);cursor:pointer;border-bottom:0.5px solid var(--color-border-tertiary)";
    head.createSpan({ text: title }).style.cssText = "font-size:13px;font-weight:500;color:var(--color-text-primary)";
    const toggle = head.createSpan({ text: "▾" });
    toggle.style.cssText = "font-size:12px;color:var(--color-text-tertiary)";
    const body = wrap.createDiv();
    body.style.cssText = "padding:10px 12px;background:var(--color-background-primary)";
    builder(body);
    head.onclick = () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      toggle.style.transform = hidden ? "" : "rotate(-90deg)";
    };
  }
}
