import { App, Modal } from "obsidian";
import type { ConditionDefinition } from "../types";
import { GENERIC_CONDITIONS } from "./ConditionReferenceModal";

/**
 * A checklist-style picker: shows every condition the system defines as a
 * toggleable chip, pre-checking the ones currently active. Also allows a
 * custom condition to be typed in. Returns the selected list.
 */
export class ConditionPickerModal extends Modal {
  private all: ConditionDefinition[];
  private selected: Set<string>;
  private targetName: string;
  private onSave: (conditions: string[]) => void;

  constructor(
    app: App,
    conditions: ConditionDefinition[],
    current: string[],
    targetName: string,
    onSave: (conditions: string[]) => void
  ) {
    super(app);
    this.all = conditions.length ? conditions : GENERIC_CONDITIONS;
    this.selected = new Set(current.map((c) => c.toLowerCase()));
    this.targetName = targetName;
    this.onSave = onSave;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Conditions — ${this.targetName}` });
    contentEl.createEl("p", {
      text: "Tap to toggle. Hover for the effect.",
    }).style.cssText = "font-size:12px;color:var(--text-muted);margin:0 0 12px";

    // Build a lookup so custom (non-schema) current conditions still show
    const known = new Set(this.all.map((c) => c.name.toLowerCase()));
    const customCurrent = Array.from(this.selected).filter((s) => !known.has(s));

    const chipWrap = contentEl.createDiv();
    chipWrap.style.cssText = "display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px";

    const makeChip = (name: string, effect: string | null, duration: string | null) => {
      const isSel = this.selected.has(name.toLowerCase());
      const chip = chipWrap.createEl("button", { text: name });
      chip.style.cssText = `font-size:13px;padding:5px 11px;border-radius:14px;cursor:pointer;border:0.5px solid ${isSel ? "var(--interactive-accent)" : "var(--color-border-secondary)"};background:${isSel ? "var(--interactive-accent)" : "transparent"};color:${isSel ? "var(--text-on-accent)" : "var(--text-normal)"};font-family:var(--font-interface)`;
      if (effect) chip.title = duration ? `${effect}\n(${duration})` : effect;
      chip.onclick = () => {
        const key = name.toLowerCase();
        if (this.selected.has(key)) this.selected.delete(key);
        else this.selected.add(key);
        // Re-render to update chip styling
        this.onOpen();
      };
      return chip;
    };

    for (const c of this.all) makeChip(c.name, c.effect, c.duration ?? null);
    for (const custom of customCurrent) {
      // Show custom conditions with a different hint
      makeChip(capitalize(custom), "Custom condition", null);
    }

    // Custom add row
    const addRow = contentEl.createDiv();
    addRow.style.cssText = "display:flex;gap:6px;margin-bottom:14px";
    const input = addRow.createEl("input");
    input.placeholder = "Add custom condition…";
    input.style.cssText = "flex:1;font-size:13px;padding:5px 8px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";
    const addBtn = addRow.createEl("button", { text: "Add" });
    addBtn.onclick = () => {
      const v = input.value.trim();
      if (v) {
        this.selected.add(v.toLowerCase());
        input.value = "";
        this.onOpen();
      }
    };
    input.onkeydown = (e) => { if (e.key === "Enter") { e.preventDefault(); addBtn.click(); } };

    // Footer
    const footer = contentEl.createDiv();
    footer.style.cssText = "display:flex;justify-content:space-between;gap:8px";
    const clearBtn = footer.createEl("button", { text: "Clear all" });
    clearBtn.onclick = () => { this.selected.clear(); this.onOpen(); };

    const rightBtns = footer.createDiv();
    rightBtns.style.cssText = "display:flex;gap:8px";
    const cancelBtn = rightBtns.createEl("button", { text: "Cancel" });
    cancelBtn.onclick = () => this.close();
    const saveBtn = rightBtns.createEl("button", { text: "Save", cls: "mod-cta" });
    saveBtn.onclick = () => {
      // Preserve display casing: use schema names where known, else capitalized custom
      const nameByKey = new Map<string, string>();
      for (const c of this.all) nameByKey.set(c.name.toLowerCase(), c.name);
      const result = Array.from(this.selected).map((k) => nameByKey.get(k) ?? capitalize(k));
      this.onSave(result);
      this.close();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
