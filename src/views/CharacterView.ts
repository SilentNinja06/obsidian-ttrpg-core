import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { SystemLoader } from "../engine/SystemLoader";
import type { LootManager } from "../engine/LootManager";
import { readNote, writeFrontmatterKey, writeFrontmatterKeys, writeNoteSection, readSection } from "../utils/fileIO";
import { InputModal, promptText } from "../modals/InputModal";

export const VIEW_TYPE_CHARACTER = "ttrpg-character";

export class CharacterView extends ItemView {
  private systemLoader: SystemLoader;
  private lootManager: LootManager | null;
  file: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, systemLoader: SystemLoader, lootManager?: LootManager) {
    super(leaf);
    this.systemLoader = systemLoader;
    this.lootManager = lootManager ?? null;
  }

  getViewType(): string { return VIEW_TYPE_CHARACTER; }
  getDisplayText(): string { return this.file?.basename ?? "Character"; }
  getIcon(): string { return "user"; }

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
    const system = this.systemLoader.get(fm.system as string);
    const stats = system?.entities?.character?.stats ?? [];
    const hpKey = system?.entities?.character?.hp;
    const schemaFields = system?.entities?.character?.fields ?? [];

    container.addClass("ttrpg-view");
    container.style.padding = "1rem";
    container.style.overflowY = "auto";

    // ── Source button ────────────────────────────────────────────────────────
    const topBar = container.createDiv();
    topBar.style.cssText = "display:flex;justify-content:flex-end;gap:6px;margin-bottom:0.75rem";
    const sourceBtn = topBar.createEl("button", { text: "Edit source" });
    sourceBtn.onclick = () => {
      if (this.file) this.app.workspace.getLeaf("tab").openFile(this.file);
    };
    const popBtn = topBar.createEl("button", { text: "⤢ Pop out" });
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // ── Header ───────────────────────────────────────────────────────────────
    const header = container.createDiv();
    header.style.cssText = "display:flex;gap:14px;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary)";
    const avatar = header.createDiv();
    avatar.style.cssText = "width:48px;height:48px;border-radius:50%;background:var(--color-background-info);display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:500;color:var(--color-text-info);flex-shrink:0;border:0.5px solid var(--color-border-tertiary)";
    avatar.textContent = (this.file.basename ?? "?").slice(0, 2).toUpperCase();

    const meta = header.createDiv();
    meta.style.flex = "1";
    meta.createEl("h2", { text: this.file.basename }).style.cssText = "margin:0 0 3px;font-size:18px;font-weight:500";
    meta.createEl("p", {
      text: [fm.class, fm.level ? `Level ${fm.level}` : "", fm.race, fm.alignment].filter(Boolean).join(" · "),
    }).style.cssText = "margin:0 0 6px;font-size:13px;color:var(--color-text-secondary)";

    const tagsRow = meta.createDiv();
    tagsRow.style.cssText = "display:flex;gap:5px;flex-wrap:wrap;margin-bottom:6px";
    for (const tag of (fm.tags as string[] ?? [])) {
      this.pill(tagsRow, tag, "#E1F5EE", "#085041");
    }
    for (const cond of (fm.conditions as string[] ?? [])) {
      this.pill(tagsRow, cond, "#FAEEDA", "#633806");
    }

    // HP strip
    if (hpKey) {
      const hpCur = (fm[hpKey.current] as number) ?? 0;
      const hpMax = (fm[hpKey.max] as number) ?? 1;
      const pct = Math.max(0, Math.round((hpCur / hpMax) * 100));
      const strip = meta.createDiv();
      strip.style.cssText = "display:flex;align-items:center;gap:8px;margin-bottom:4px";
      const barWrap = strip.createDiv();
      barWrap.style.cssText = "flex:1;height:7px;background:var(--color-background-secondary);border-radius:4px;overflow:hidden;border:0.5px solid var(--color-border-tertiary)";
      const bar = barWrap.createDiv();
      bar.style.cssText = `height:100%;border-radius:4px;transition:width 0.3s;width:${pct}%;background:${pct > 50 ? "#1D9E75" : pct > 25 ? "#BA7517" : "#E24B4A"}`;
      const hpLabel = strip.createSpan({ text: `${hpCur} / ${hpMax} HP` });
      hpLabel.style.cssText = "font-size:12px;color:var(--color-text-secondary);white-space:nowrap;cursor:pointer";
      hpLabel.title = "Click to set current / max HP";
      hpLabel.onclick = () => {
        new InputModal(
          this.app,
          "Set HP",
          [
            { key: "current", label: "Current HP", type: "number", default: hpCur },
            { key: "max", label: "Max HP", type: "number", default: hpMax },
          ],
          async (vals) => {
            if (!vals || !this.file) return;
            const nc = (vals.current as number) || 0;
            const nm = (vals.max as number) || 0;
            await writeFrontmatterKeys(this.app, this.file, {
              [hpKey.current]: nc,
              [hpKey.max]: nm,
            });
            await this.render();
          }
        ).open();
      };
    }

    // ── Two columns ──────────────────────────────────────────────────────────
    const cols = container.createDiv();
    cols.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:start";
    const left = cols.createDiv();
    const right = cols.createDiv();

    // Details (class, level, race, AC, etc. from schema)
    if (schemaFields.length) {
      this.section(left, "Details", (b) => {
        const grid = b.createDiv();
        grid.style.cssText = "display:grid;grid-template-columns:1fr 1fr;gap:8px";
        for (const field of schemaFields) {
          const isNum = field.type === "integer";
          const cell = grid.createDiv();
          cell.createDiv({ text: field.label }).style.cssText = "font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.03em;margin-bottom:2px";
          const cur = fm[field.key];
          const display = (cur === undefined || cur === null || cur === "") ? "—" : String(cur);
          const val = cell.createDiv({ text: display });
          val.style.cssText = "font-size:14px;color:var(--color-text-primary);background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:4px 8px;cursor:pointer;min-height:24px";
          val.title = `Click to set ${field.label}`;
          val.onclick = () => {
            const input = createEl("input");
            input.type = isNum ? "number" : "text";
            if (isNum) {
              const n = typeof cur === "number" ? cur : parseFloat(String(cur ?? ""));
              input.value = !isNaN(n) && n !== 0 ? String(n) : "";
              input.placeholder = "0";
            } else {
              input.value = (cur === undefined || cur === null) ? "" : String(cur);
            }
            input.style.cssText = "width:100%;font-size:14px;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--color-border-primary);border-radius:4px;padding:3px 6px";
            val.replaceWith(input);
            input.focus();
            input.select();
            let done = false;
            const commit = async () => {
              if (done) return; done = true;
              const newVal = isNum ? (input.value === "" ? 0 : (parseInt(input.value) || 0)) : input.value;
              fm[field.key] = newVal;
              if (this.file) await writeFrontmatterKey(this.app, this.file, field.key, newVal);
              await this.render();
            };
            input.onblur = commit;
            input.onkeydown = (e) => { if (e.key === "Enter") commit(); };
          };
        }
      });
    }

    // Stat block
    if (stats.length) {
      this.section(left, "Stat block", (body) => {
        const grid = body.createDiv();
        grid.style.cssText = "display:grid;grid-template-columns:repeat(3,1fr);gap:6px";
        for (const stat of stats) {
          const val = (fm[stat.key] as number) ?? 0;
          const mod = Math.floor((val - 10) / 2);
          const box = grid.createDiv();
          box.style.cssText = "background:var(--color-background-secondary);border:0.5px solid var(--color-border-tertiary);border-radius:var(--border-radius-md);padding:6px 4px;text-align:center";
          const valEl = box.createDiv({ text: String(val) });
          valEl.style.cssText = "font-size:18px;font-weight:500;color:var(--color-text-primary)";
          box.createDiv({ text: (mod >= 0 ? "+" : "") + mod }).style.cssText = "font-size:11px;color:var(--color-text-secondary)";
          box.createDiv({ text: stat.label }).style.cssText = "font-size:10px;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.03em";

          // Make stat editable on click
          valEl.style.cursor = "pointer";
          valEl.title = `Click to edit ${stat.label}`;
          valEl.onclick = () => {
            const input = createEl("input");
            input.type = "number";
            // Blank a 0 so typing doesn't yield "02"/"20"; show real values to edit
            input.value = val === 0 ? "" : String(val);
            input.placeholder = "0";
            input.style.cssText = "width:100%;font-size:16px;text-align:center;background:var(--background-primary);color:var(--text-normal);border:1px solid var(--color-border-primary);border-radius:4px";
            valEl.replaceWith(input);
            input.focus();
            input.select();
            input.onblur = async () => {
              const newVal = input.value === "" ? 0 : (parseInt(input.value) || 0);
              fm[stat.key] = newVal;
              if (this.file) await writeFrontmatterKey(this.app, this.file, stat.key, newVal);
              await this.render();
            };
          };
        }
      });
    }

    // Skills & abilities
    const skillsContent = readSection(body, "Skills & abilities");
    this.editableSection(left, "Skills & abilities", skillsContent, "Skills & abilities");

    // Combat log (read-only — populated by the combat tracker)
    const combatLogContent = readSection(body, "Combat log");
    if (combatLogContent.trim()) {
      this.section(left, "Combat log", (b) => {
        const lines = combatLogContent.split("\n").filter(l => l.trim().startsWith("-"));
        // Show newest first
        for (const line of lines.reverse()) {
          const entry = b.createDiv({ text: line.replace(/^-\s*/, "") });
          entry.style.cssText = "font-size:12px;color:var(--color-text-secondary);padding:3px 0;border-bottom:0.5px solid var(--color-border-tertiary);line-height:1.4";
        }
        if (lines.length === 0) {
          b.createEl("p", { text: "No combat events yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
        }
      });
    }

    // Backstory & arc (right)
    const arcFields = system?.arcFields ?? [
      { key: "motivation", label: "Motivation" },
      { key: "secret", label: "Secret" },
      { key: "current-goal", label: "Current goal" },
    ];
    this.section(right, "Backstory & arc", (b) => {
      for (const field of arcFields) {
        const f = b.createDiv();
        f.style.marginBottom = "10px";
        f.createDiv({ text: field.label }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px";
        const val = b.createDiv({ text: (fm[field.key] as string) || "—" });
        val.style.cssText = "font-size:13px;color:var(--color-text-primary);background:var(--color-background-secondary);border-radius:var(--border-radius-md);padding:6px 8px;border:0.5px solid var(--color-border-tertiary);cursor:pointer;min-height:28px";
        val.title = "Click to edit";
        val.onclick = () => {
          const ta = createEl("textarea");
          ta.value = (fm[field.key] as string) || "";
          ta.style.cssText = "width:100%;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-primary);border-radius:var(--border-radius-md);padding:6px 8px;resize:vertical;min-height:60px";
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
      const notesContent = readSection(body, "Notes");
      b.createDiv({ text: "Notes" }).style.cssText = "font-size:11px;font-weight:500;color:var(--color-text-tertiary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:3px;margin-top:6px";
      const ta = b.createEl("textarea");
      ta.value = notesContent;
      ta.placeholder = "Freeform session observations…";
      ta.style.cssText = "width:100%;min-height:80px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, "Notes", ta.value);
      };
    });

    // Inventory & loadout (reads item notes where held-by = this character)
    if (this.lootManager) {
      await this.renderInventory(right);
    }

    // Relationships
    this.section(right, "Relationships", (b) => {
      const rels = (fm.relationships as string[] ?? []);
      if (rels.length === 0) {
        b.createEl("p", { text: "No relationships yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
      }
      for (const rel of rels) {
        const row = b.createDiv();
        row.style.cssText = "font-size:13px;color:var(--color-text-primary);padding:4px 0;border-bottom:0.5px solid var(--color-border-tertiary)";
        row.textContent = rel;
      }
      const addRow = b.createDiv();
      addRow.style.cssText = "display:flex;gap:5px;margin-top:6px";
      const inp = addRow.createEl("input");
      inp.placeholder = "[[Character name]]";
      inp.style.cssText = "flex:1;font-size:13px;padding:4px 7px;color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md)";
      const addBtn = addRow.createEl("button", { text: "Add" });
      addBtn.onclick = async () => {
        const val = inp.value.trim();
        if (!val || !this.file) return;
        const newRels = [...rels, val];
        fm.relationships = newRels;
        await writeFrontmatterKey(this.app, this.file, "relationships", newRels);
        inp.value = "";
        await this.render();
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
    });
  }

  private async renderInventory(parent: HTMLElement): Promise<void> {
    if (!this.file || !this.lootManager) return;
    const pcName = this.file.basename;
    const items = await this.lootManager.itemsHeldBy(pcName);

    // Sort: equipped first, then by name — using the fresh fm we just read
    items.sort((a, b) => {
      const ea = a.fm.equipped ? 0 : 1;
      const eb = b.fm.equipped ? 0 : 1;
      if (ea !== eb) return ea - eb;
      return a.file.basename.localeCompare(b.file.basename);
    });

    this.section(parent, `Inventory${items.length ? ` (${items.length})` : ""}`, (b) => {
      if (items.length === 0) {
        b.createEl("p", { text: "Nothing carried yet." }).style.cssText = "font-size:13px;color:var(--color-text-tertiary)";
      }

      for (const { file, fm } of items) {
        const equipped = !!fm.equipped;
        const qty = typeof fm.quantity === "number" ? fm.quantity : 1;

        const row = b.createDiv();
        row.style.cssText = `display:flex;align-items:center;gap:8px;padding:6px 0;border-bottom:0.5px solid var(--color-border-tertiary)`;

        const star = row.createSpan({ text: equipped ? "★" : "☆" });
        star.style.cssText = `font-size:15px;cursor:pointer;color:${equipped ? "#BA7517" : "var(--color-text-tertiary)"}`;
        star.title = equipped ? "Equipped — click to unequip" : "Click to equip";
        star.onclick = async () => {
          await this.lootManager!.setEquipped(file, !equipped);
          await this.render();
        };

        const name = row.createEl("a", { text: file.basename });
        name.style.cssText = `flex:1;font-size:13px;cursor:pointer;color:${equipped ? "var(--color-text-primary)" : "var(--color-text-secondary)"};font-weight:${equipped ? "600" : "400"}`;
        name.onclick = (e) => { e.preventDefault(); this.app.workspace.getLeaf(false).openFile(file); };

        const qtyEl = row.createSpan({ text: `×${qty}` });
        qtyEl.style.cssText = "font-size:12px;color:var(--color-text-tertiary);cursor:pointer";
        qtyEl.title = "Click to change quantity";
        qtyEl.onclick = async () => {
          const v = await promptText(this.app, "Quantity", `Quantity of ${file.basename}:`, String(qty));
          if (v === null) return;
          const n = parseInt(v) || 1;
          await this.lootManager!.setQuantity(file, n);
          await this.render();
        };

        const drop = row.createEl("button", { text: "drop" });
        drop.style.cssText = "font-size:11px;padding:2px 6px;color:var(--color-text-tertiary)";
        drop.title = "Unassign — returns to unassigned loot";
        drop.onclick = async () => {
          await this.lootManager!.unassignItem(file);
          await this.render();
        };
      }

      const addRow = b.createDiv();
      addRow.style.cssText = "display:flex;gap:5px;margin-top:8px;align-items:center";
      const inp = addRow.createEl("input");
      inp.placeholder = "Add item…";
      inp.style.cssText = "flex:1;font-size:13px;padding:4px 7px;color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md)";
      const addBtn = addRow.createEl("button", { text: "+ Add" });
      addBtn.style.cssText = "font-size:12px;padding:4px 8px";
      addBtn.onclick = async () => {
        const val = inp.value.trim();
        if (!val) return;
        await this.lootManager!.quickAddItem(pcName, val, false);
        inp.value = "";
        await this.render();
      };
      inp.onkeydown = (e) => { if (e.key === "Enter") addBtn.click(); };
      const promoteBtn = addRow.createEl("button", { text: "+ Full note" });
      promoteBtn.style.cssText = "font-size:12px;padding:4px 8px";
      promoteBtn.title = "Add as a full item note with description sections";
      promoteBtn.onclick = async () => {
        const val = inp.value.trim();
        if (!val) return;
        const newFile = await this.lootManager!.quickAddItem(pcName, val, true);
        inp.value = "";
        await this.render();
        if (newFile) this.app.workspace.getLeaf(false).openFile(newFile);
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
    toggle.style.cssText = "font-size:12px;color:var(--color-text-tertiary);transition:transform 0.2s";
    const body = wrap.createDiv();
    body.style.cssText = "padding:10px 12px;background:var(--color-background-primary)";
    builder(body);
    head.onclick = () => {
      const hidden = body.style.display === "none";
      body.style.display = hidden ? "" : "none";
      toggle.style.transform = hidden ? "" : "rotate(-90deg)";
    };
  }

  private editableSection(parent: HTMLElement, title: string, content: string, sectionName: string): void {
    this.section(parent, title, (b) => {
      const ta = b.createEl("textarea");
      ta.value = content;
      ta.placeholder = `${title}…`;
      ta.style.cssText = "width:100%;min-height:80px;font-size:13px;font-family:var(--font-sans);color:var(--text-normal);background:var(--background-primary);border:0.5px solid var(--color-border-secondary);border-radius:var(--border-radius-md);padding:8px;resize:vertical";
      ta.onblur = async () => {
        if (this.file) await writeNoteSection(this.app, this.file, sectionName, ta.value);
      };
    });
  }

  private pill(parent: HTMLElement, text: string, bg: string, color: string): void {
    const span = parent.createSpan({ text });
    span.style.cssText = `font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;background:${bg};color:${color}`;
  }
}
