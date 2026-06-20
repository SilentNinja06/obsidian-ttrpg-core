import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { LootManager } from "../engine/LootManager";
import type { SystemLoader } from "../engine/SystemLoader";
import { readNote, writeFrontmatterKey, writeNoteSection, readSection, stripHintPlaceholder } from "../utils/fileIO";
import { collectBacklinks } from "../utils/queries";
import { RelationshipPickerModal } from "../modals/RelationshipPickerModal";
import { parseRelationship, formatRelationship, resolveByName, addReciprocal, inverseLabel } from "../utils/relationships";
import { promptText, confirmAction } from "../modals/InputModal";

export const VIEW_TYPE_LORE = "ttrpg-lore";

const ICON_MAP: Record<string, string> = { location: "🏰", faction: "⚔️", history: "📜" };

const CORE_FIELDS: Record<string, { key: string; label: string }[]> = {
  location: [
    { key: "region", label: "Region" },
    { key: "type", label: "Type" },
    { key: "controlled-by", label: "Controlled by" },
    { key: "notable-features", label: "Notable features" },
  ],
  faction: [
    { key: "alignment", label: "Alignment" },
    { key: "goals", label: "Goals" },
    { key: "resources", label: "Resources" },
    { key: "leadership", label: "Leadership" },
  ],
  history: [
    { key: "era", label: "Era" },
    { key: "timeline-order", label: "Timeline order (number)" },
    { key: "location", label: "Location" },
    { key: "parties-involved", label: "Parties involved" },
    { key: "outcome", label: "Outcome" },
  ],
  item: [
    { key: "rarity", label: "Rarity" },
    { key: "attunement", label: "Attunement" },
  ],
};

const STATUS_OPTIONS = ["active", "unknown", "destroyed", "hidden"];
const STATUS_COLORS: Record<string, [string, string]> = {
  active: ["#EAF3DE", "#27500A"],
  unknown: ["#FAEEDA", "#633806"],
  destroyed: ["#FCEBEB", "#791F1F"],
  hidden: ["#EEEDFE", "#3C3489"],
};

export class LoreView extends ItemView {
  file: TFile | null = null;
  private lootManager: LootManager | null;
  private systemLoader: SystemLoader | null;

  constructor(leaf: WorkspaceLeaf, lootManager?: LootManager, systemLoader?: SystemLoader) {
    super(leaf);
    this.lootManager = lootManager ?? null;
    this.systemLoader = systemLoader ?? null;
  }

  getViewType(): string { return VIEW_TYPE_LORE; }
  getDisplayText(): string { return this.file?.basename ?? "Lore"; }
  getIcon(): string { return "map"; }

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
    const type = (fm["ttrpg-type"] as string) ?? "location";
    container.style.cssText = "padding:1rem;overflow-y:auto;font-family:var(--font-sans)";

    // ── Top bar ──────────────────────────────────────────────────────────────
    const topBar = container.createDiv();
    topBar.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-bottom:0.75rem";
    const srcBtn = topBar.createEl("button", { text: "Edit source" });
    srcBtn.onclick = () => { if (this.file) this.app.workspace.getLeaf("tab").openFile(this.file); };
    const popBtn = topBar.createEl("button", { text: "⤢ Pop out" });
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // ── Header ───────────────────────────────────────────────────────────────
    const header = container.createDiv();
    header.style.cssText = "display:flex;gap:14px;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary)";
    const icon = header.createDiv({ text: ICON_MAP[type] ?? "📄" });
    icon.style.cssText = "width:48px;height:48px;border-radius:var(--border-radius-md);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;border:0.5px solid var(--color-border-tertiary);background:var(--color-background-secondary)";

    const meta = header.createDiv();
    meta.style.flex = "1";
    meta.createEl("h2", { text: this.file.basename }).style.cssText = "margin:0 0 3px;font-size:18px;font-weight:500";
    meta.createEl("p", { text: `${type} · ${fm.campaign ?? ""}` }).style.cssText = "margin:0 0 6px;font-size:13px;color:var(--color-text-secondary)";

    const tagsRow = meta.createDiv();
    tagsRow.style.cssText = "display:flex;gap:5px;flex-wrap:wrap";
    const typePill = tagsRow.createSpan({ text: type });
    typePill.style.cssText = "font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;background:#EEEDFE;color:#3C3489";
    const status = (fm.status as string) ?? "active";
    const [sbg, sc] = STATUS_COLORS[status] ?? STATUS_COLORS.active;
    const statusPill = tagsRow.createSpan({ text: status });
    statusPill.style.cssText = `font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;background:${sbg};color:${sc}`;

    // ── Two columns ──────────────────────────────────────────────────────────
    const cols = container.createDiv();
    cols.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start";
    const left = cols.createDiv();
    const right = cols.createDiv();

    // Details (left)
    this.section(left, "Details", (b) => {
      if (type === "item") {
        this.renderItemLifecycle(b, fm);
      } else {
        // Lore status selector (location/faction/history only)
        const statusRow = b.createDiv();
        statusRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:10px";
        statusRow.createSpan({ text: "Status:" }).style.cssText = "font-size:11px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em";
        for (const opt of STATUS_OPTIONS) {
          const btn = statusRow.createEl("button", { text: opt });
          const isSel = opt === status;
          const [bg, c] = STATUS_COLORS[opt];
          btn.style.cssText = `font-size:12px;padding:3px 10px;border-radius:10px;cursor:pointer;font-family:var(--font-sans);border:0.5px solid var(--color-border-secondary);background:${isSel ? bg : "transparent"};color:${isSel ? c : "var(--color-text-secondary)"}`;
          btn.onclick = async () => {
            fm.status = opt;
            if (this.file) await writeFrontmatterKey(this.app, this.file, "status", opt);
            await this.render();
          };
        }
      }

      // Editable fields
      for (const field of (CORE_FIELDS[type] ?? [])) {
        const f = b.createDiv();
        f.style.marginBottom = "10px";
        f.createDiv({ text: field.label }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px";
        const val = f.createDiv({ text: (fm[field.key] as string) || "—" });
        val.style.cssText = "font-size:13px;color:var(--color-text-primary);background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:6px 8px;border:0.5px solid var(--color-border-tertiary);cursor:pointer;min-height:28px";
        val.title = "Click to edit";
        val.onclick = () => {
          const ta = createEl("textarea");
          ta.value = (fm[field.key] as string) || "";
          ta.style.cssText = "width:100%;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-primary);border-radius:var(--border-radius-md);padding:6px 8px;resize:vertical;min-height:50px";
          val.replaceWith(ta);
          ta.focus();
          ta.onblur = async () => {
            fm[field.key] = ta.value;
            if (this.file) await writeFrontmatterKey(this.app, this.file, field.key, ta.value);
            await this.render();
          };
        };
      }

      // Freeform notes
      b.createDiv({ text: "Notes" }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;margin-top:6px";
      const notesContent = stripHintPlaceholder(readSection(body, "Notes"));
      const ta = b.createEl("textarea");
      ta.value = notesContent;
      ta.placeholder = "DM notes, atmosphere, observations…";
      ta.style.cssText = "width:100%;min-height:80px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, "Notes", ta.value);
      };
    });

    // Overview prose (left)
    this.section(left, "Overview", (b) => {
      const content = stripHintPlaceholder(readSection(body, "Overview"));
      const ta = b.createEl("textarea");
      ta.value = content;
      ta.placeholder = "What is this and why does it matter…";
      ta.style.cssText = "width:100%;min-height:80px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, "Overview", ta.value);
      };
    });

    // Auto-detected backlinks
    const backlinks = this.file ? collectBacklinks(this.app, this.file) : [];
    const sessionBacklinks = backlinks.filter((b) => b.type === "session");
    const otherBacklinks = backlinks.filter((b) => b.type !== "session");

    // Session appearances (right) — auto from backlinks
    this.section(right, "Session appearances", (b) => {
      if (sessionBacklinks.length === 0) {
        b.createEl("p", { text: "No sessions reference this yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
      }
      for (const sess of sessionBacklinks) {
        const pill = b.createEl("a", { text: sess.name });
        pill.style.cssText = "display:inline-block;font-size:12px;padding:3px 8px;margin:2px;border-radius:10px;background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);color:var(--color-text-secondary);cursor:pointer";
        pill.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getFileByPath(sess.path);
          if (f) this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    });

    // Connections (right) — auto from backlinks, grouped by type
    this.section(right, "Connections", (b) => {
      if (otherBacklinks.length === 0) {
        b.createEl("p", { text: "No characters, factions, or places link here yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
      }
      const typeIcons: Record<string, string> = { character: "👤", faction: "⚔️", location: "🏰", history: "📜", item: "⚗️" };
      for (const conn of otherBacklinks) {
        const row = b.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px";
        row.createSpan({ text: typeIcons[conn.type] ?? "📄" });
        const link = row.createEl("a", { text: conn.name });
        link.style.cssText = "flex:1;color:#185FA5;cursor:pointer";
        link.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getFileByPath(conn.path);
          if (f) this.app.workspace.getLeaf(false).openFile(f);
        };
        row.createSpan({ text: conn.type }).style.cssText = "font-size:11px;padding:1px 6px;border-radius:8px;background:var(--color-background-secondary);color:var(--color-text-secondary)";
      }
      b.createEl("p", { text: "Connections appear automatically when other notes link here with [[wikilinks]]." }).style.cssText = "font-size:11px;color:var(--color-text-tertiary);margin-top:8px;font-style:italic";
    });

    // Relationships (right) — editable structured links (not for items)
    if (type !== "item") {
      this.section(right, "Relationships", (b) => {
        const rels = (fm.relationships as string[] ?? []);
        if (rels.length === 0) {
          b.createEl("p", { text: "No relationships yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
        }
        for (const rel of rels) {
          const parsed = parseRelationship(rel);
          const row = b.createDiv();
          row.style.cssText = "display:flex;align-items:center;gap:7px;padding:5px 0;border-bottom:0.5px solid var(--color-border-tertiary)";
          const name = row.createEl("a", { text: parsed.target });
          name.style.cssText = "flex:1;font-size:13px;color:#185FA5;cursor:pointer";
          name.onclick = (e) => {
            e.preventDefault();
            const f = resolveByName(this.app, parsed.target, this.campaignRoot());
            if (f) this.app.workspace.getLeaf(false).openFile(f);
          };
          if (parsed.label) {
            const badge = row.createSpan({ text: parsed.label });
            badge.style.cssText = "font-size:10px;padding:1px 7px;border-radius:8px;font-weight:600;background:#E1ECF7;color:#1A4971";
          }
          const del = row.createEl("button", { text: "✕" });
          del.style.cssText = "font-size:11px;padding:1px 6px;color:var(--color-text-tertiary);background:none";
          del.title = "Remove";
          del.onclick = async () => {
            if (!this.file) return;
            const newRels = rels.filter((r) => r !== rel);
            fm.relationships = newRels;
            await writeFrontmatterKey(this.app, this.file, "relationships", newRels);
            await this.render();
          };
        }
        const addBtn = b.createEl("button", { text: "+ Add relationship" });
        addBtn.style.cssText = "font-size:12px;padding:4px 10px;margin-top:8px";
        addBtn.onclick = () => {
          if (!this.file) return;
          new RelationshipPickerModal(this.app, this.campaignRoot(), this.file.basename, async (target, label, reciprocal) => {
            const entry = formatRelationship(target, label);
            const newRels = [...rels, entry];
            fm.relationships = newRels;
            if (this.file) await writeFrontmatterKey(this.app, this.file, "relationships", newRels);
            if (reciprocal) {
              const targetFile = resolveByName(this.app, target, this.campaignRoot());
              if (targetFile) await addReciprocal(this.app, targetFile, this.file!.basename, inverseLabel(label));
            }
            await this.render();
          }).open();
        };
      });
    }
  }

  private campaignRoot(): string {
    const path = this.file?.path ?? "";
    const m = path.match(/^(.*\/campaigns\/[^/]+)\//);
    return m ? m[1] : "";
  }

  private async changeItemState(state: string, extra: { location?: string; stolenBy?: string; note?: string } = {}): Promise<void> {
    if (!this.file || !this.lootManager) return;
    await this.lootManager.setItemState(this.file, state, extra);
    await this.render();
  }

  private renderItemLifecycle(b: HTMLElement, fm: Record<string, unknown>): void {
    const ITEM_STATES = ["hidden", "unassigned", "held", "stashed", "lost", "stolen", "destroyed", "custom"];
    const STATE_COLORS: Record<string, [string, string]> = {
      hidden: ["#EEEDFE", "#3C3489"],
      unassigned: ["#F0EBE4", "#5C4A2E"],
      held: ["#E1ECF7", "#1A4971"],
      stashed: ["#E1F5EE", "#085041"],
      lost: ["#F0EBE4", "#5C4A2E"],
      stolen: ["#FCEBEB", "#791F1F"],
      destroyed: ["#FCEBEB", "#791F1F"],
      custom: ["#EEEDFE", "#3C3489"],
    };

    // Migrate legacy item-state "damaged" → damaged flag + normal state
    if ((fm["item-state"] as string) === "damaged") {
      fm.damaged = true;
      fm["item-state"] = fm["held-by"] ? "held" : "unassigned";
      if (this.file) {
        this.lootManager?.setDamaged(this.file, true);
      }
    }

    const state = (fm["item-state"] as string) || (fm["held-by"] ? "held" : "unassigned");
    const heldBy = (fm["held-by"] as string) || "";

    // Held-by line
    const heldLine = b.createDiv();
    heldLine.style.cssText = "font-size:13px;color:var(--color-text-primary);margin-bottom:8px";
    heldLine.createSpan({ text: "Held by: " }).style.cssText = "color:var(--color-text-tertiary);font-weight:600";
    heldLine.createSpan({ text: heldBy || "—" });

    // State label
    b.createDiv({ text: "Lifecycle state" }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:4px";

    const stateRow = b.createDiv();
    stateRow.style.cssText = "display:flex;gap:5px;flex-wrap:wrap;margin-bottom:8px";
    const permanent = state === "destroyed";
    for (const opt of ITEM_STATES) {
      const isSel = opt === state;
      const [bg, c] = STATE_COLORS[opt];
      const btn = stateRow.createEl("button", { text: opt });
      btn.style.cssText = `font-size:12px;padding:3px 9px;border-radius:10px;cursor:${permanent ? "not-allowed" : "pointer"};border:0.5px solid var(--color-border-secondary);background:${isSel ? bg : "transparent"};color:${isSel ? c : "var(--color-text-secondary)"};opacity:${permanent && !isSel ? "0.4" : "1"}`;
      if (permanent && !isSel) { btn.disabled = true; }
      btn.onclick = async () => {
        if (permanent) return;
        if (opt === "stashed") {
          const loc = await promptText(this.app, "Stash location", "Where is it stashed?", (fm["stash-location"] as string) || "");
          await this.changeItemState("stashed", { location: loc ?? "" });
        } else if (opt === "stolen") {
          const who = await promptText(this.app, "Stolen by", "Who stole it? (optional)", (fm["stolen-by"] as string) || "");
          await this.changeItemState("stolen", { stolenBy: who ?? "" });
        } else if (opt === "custom") {
          const note = await promptText(this.app, "Custom state", "Describe the state:", (fm["state-note"] as string) || "");
          await this.changeItemState("custom", { note: note ?? "" });
        } else if (opt === "destroyed") {
          const held = (fm["held-by"] as string) || "";
          const msg = held
            ? `Destroy "${this.file?.basename}"? This is permanent — it will be removed from ${held}'s inventory and can't be recovered or reassigned.`
            : `Destroy "${this.file?.basename}"? This is permanent and can't be recovered or reassigned.`;
          const ok = await confirmAction(this.app, "Destroy item", msg, "Destroy", true);
          if (ok) await this.changeItemState("destroyed");
        } else {
          await this.changeItemState(opt);
        }
      };
    }

    // Extra info for current state
    if (state === "stashed" && fm["stash-location"]) {
      this.infoLine(b, "Location", String(fm["stash-location"]));
    }
    if (state === "stolen" && fm["stolen-by"]) {
      this.infoLine(b, "Stolen by", String(fm["stolen-by"]));
    }
    if (state === "custom" && fm["state-note"]) {
      this.infoLine(b, "Note", String(fm["state-note"]));
    }

    // Damaged flag (independent of lifecycle state) + Recover / Repair actions
    const damaged = !!fm.damaged;
    const isDestroyed = state === "destroyed";

    // Damaged indicator line
    if (damaged && !isDestroyed) {
      this.infoLine(b, "Condition", "Damaged");
    }

    const actionRow = b.createDiv();
    actionRow.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;margin:8px 0";

    if (state === "stolen" || state === "lost" || state === "stashed") {
      const recover = actionRow.createEl("button", { text: "↩ Recover" });
      recover.style.cssText = "font-size:12px;padding:4px 10px";
      recover.onclick = async () => { if (this.lootManager && this.file) { await this.lootManager.recoverItem(this.file); await this.render(); } };
    }

    // Damage/Repair toggle — works on top of any non-destroyed lifecycle state
    if (!isDestroyed) {
      if (damaged) {
        const repair = actionRow.createEl("button", { text: "🔧 Repair" });
        repair.style.cssText = "font-size:12px;padding:4px 10px";
        repair.onclick = async () => { if (this.lootManager && this.file) { await this.lootManager.repairItem(this.file); await this.render(); } };
      } else {
        const damage = actionRow.createEl("button", { text: "🔨 Mark damaged" });
        damage.style.cssText = "font-size:12px;padding:4px 10px";
        damage.onclick = async () => { if (this.lootManager && this.file) { await this.lootManager.setDamaged(this.file, true); await this.render(); } };
      }
    }

    if (isDestroyed) {
      actionRow.createEl("span", { text: "Destroyed — permanent." }).style.cssText = "font-size:12px;color:var(--color-text-danger);font-style:italic";
    }

    b.createEl("p", { text: "Equip/carry is managed from the character sheet's Inventory." })
      .style.cssText = "font-size:11px;color:var(--color-text-tertiary);font-style:italic;margin:4px 0 0";
  }

  private infoLine(b: HTMLElement, label: string, value: string): void {
    const line = b.createDiv();
    line.style.cssText = "font-size:13px;color:var(--color-text-primary);margin-bottom:4px";
    line.createSpan({ text: `${label}: ` }).style.cssText = "color:var(--color-text-tertiary);font-weight:600";
    line.createSpan({ text: value });
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
