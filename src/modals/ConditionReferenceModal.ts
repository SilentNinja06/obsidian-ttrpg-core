import { App, Modal } from "obsidian";
import type { ConditionDefinition } from "../types";

// Generic fallback conditions used when a system defines none.
export const GENERIC_CONDITIONS: ConditionDefinition[] = [
  { name: "Poisoned", effect: "Disadvantage or penalty on attacks and checks.", duration: "Varies / save" },
  { name: "Stunned", effect: "Can't act; attacks against are easier.", duration: "Until ended / save" },
  { name: "Prone", effect: "On the ground; penalties to attack and defense.", duration: "Until stands" },
  { name: "Blinded", effect: "Can't see; fails sight checks, attacks impaired.", duration: "Varies" },
  { name: "Frightened", effect: "Penalties near the fear source; can't approach it.", duration: "Until ended" },
  { name: "Restrained", effect: "Can't move; attacks against are easier.", duration: "Until escaped" },
  { name: "Unconscious", effect: "Out cold; helpless and prone.", duration: "Until healed" },
];

export class ConditionReferenceModal extends Modal {
  private conditions: ConditionDefinition[];
  private systemName: string;
  private highlight: string | null;

  constructor(app: App, conditions: ConditionDefinition[], systemName: string, highlight: string | null = null) {
    super(app);
    this.conditions = conditions.length ? conditions : GENERIC_CONDITIONS;
    this.systemName = systemName;
    this.highlight = highlight;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: `Conditions — ${this.systemName}` });

    // Search filter
    const search = contentEl.createEl("input");
    search.placeholder = "Filter conditions…";
    search.style.cssText = "width:100%;font-size:13px;padding:6px 8px;margin-bottom:10px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";

    const list = contentEl.createDiv();
    list.style.cssText = "max-height:50vh;overflow-y:auto";

    const renderList = (filter: string) => {
      list.empty();
      const f = filter.trim().toLowerCase();
      const shown = this.conditions.filter((c) => !f || c.name.toLowerCase().includes(f) || c.effect.toLowerCase().includes(f));
      if (shown.length === 0) {
        list.createEl("p", { text: "No matching conditions." }).style.cssText = "font-size:13px;color:var(--text-muted)";
        return;
      }
      for (const c of shown) {
        const card = list.createDiv();
        const isHi = this.highlight && c.name.toLowerCase() === this.highlight.toLowerCase();
        card.style.cssText = `padding:8px 10px;margin-bottom:6px;border:0.5px solid ${isHi ? "var(--interactive-accent)" : "var(--color-border-tertiary)"};border-radius:var(--radius-m);background:${isHi ? "var(--background-modifier-hover)" : "var(--background-primary)"}`;
        const head = card.createDiv();
        head.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px";
        head.createSpan({ text: c.name }).style.cssText = "font-size:14px;font-weight:600;color:var(--text-normal)";
        if (c.duration) {
          head.createSpan({ text: c.duration }).style.cssText = "font-size:11px;color:var(--text-muted);white-space:nowrap";
        }
        card.createDiv({ text: c.effect }).style.cssText = "font-size:13px;color:var(--text-muted);line-height:1.4";
      }
    };

    renderList("");
    search.oninput = () => renderList(search.value);
    if (this.highlight) {
      // Scroll the highlighted one into view shortly after open
      setTimeout(() => {
        const hi = list.querySelector('[style*="interactive-accent"]');
        hi?.scrollIntoView({ block: "center" });
      }, 50);
    }
    setTimeout(() => search.focus(), 50);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
