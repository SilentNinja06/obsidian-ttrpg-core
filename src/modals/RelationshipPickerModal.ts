import { App, Modal, Setting } from "obsidian";
import { linkableEntities, RELATIONSHIP_LABELS } from "../utils/relationships";

export class RelationshipPickerModal extends Modal {
  private campaignFolder: string;
  private excludeName: string;
  private onPick: (target: string, label: string, reciprocal: boolean) => void;
  private target = "";
  private label = "";
  private filter = "";
  private reciprocal = true;

  constructor(app: App, campaignFolder: string, excludeName: string, onPick: (target: string, label: string, reciprocal: boolean) => void) {
    super(app);
    this.campaignFolder = campaignFolder;
    this.excludeName = excludeName;
    this.onPick = onPick;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Add relationship" });

    const entities = linkableEntities(this.app, this.campaignFolder)
      .filter((e) => e.name !== this.excludeName);

    // Label selector
    new Setting(contentEl)
      .setName("Relationship")
      .setDesc("How are they connected?")
      .addDropdown((d) => {
        d.addOption("", "(no label)");
        for (const l of RELATIONSHIP_LABELS) d.addOption(l, l);
        d.setValue(this.label);
        d.onChange((v) => { this.label = v; });
      })
      .addText((t) => {
        t.setPlaceholder("or custom…");
        t.onChange((v) => { if (v.trim()) this.label = v.trim(); });
        t.inputEl.style.maxWidth = "110px";
      });

    // Reciprocal toggle
    new Setting(contentEl)
      .setName("Also add the reverse")
      .setDesc("Add the matching relationship on the other note too")
      .addToggle((t) => t.setValue(this.reciprocal).onChange((v) => { this.reciprocal = v; }));

    // Search filter
    const search = contentEl.createEl("input");
    search.placeholder = "Filter by name…";
    search.style.cssText = "width:100%;font-size:13px;padding:6px 8px;margin:8px 0;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";

    const list = contentEl.createDiv();
    list.style.cssText = "max-height:45vh;overflow-y:auto;display:flex;flex-direction:column;gap:3px";

    const typeIcon: Record<string, string> = { character: "👤", faction: "⚔️", location: "🏰", history: "📜", item: "⚗️" };

    const renderList = () => {
      list.empty();
      const f = this.filter.trim().toLowerCase();
      const shown = entities.filter((e) => !f || e.name.toLowerCase().includes(f));
      if (shown.length === 0) {
        list.createEl("p", { text: "No matching notes." }).style.cssText = "font-size:13px;color:var(--text-muted)";
        return;
      }
      for (const e of shown) {
        const row = list.createEl("button");
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:7px 10px;cursor:pointer;border:0.5px solid var(--color-border-secondary);border-radius:8px;background:transparent;text-align:left;width:100%";
        row.createSpan({ text: typeIcon[e.type] ?? "📄" });
        row.createSpan({ text: e.name }).style.cssText = "flex:1;font-size:13px;color:var(--text-normal)";
        row.createSpan({ text: e.type }).style.cssText = "font-size:11px;color:var(--text-muted)";
        row.onclick = () => { this.onPick(e.name, this.label, this.reciprocal); this.close(); };
      }
    };
    renderList();
    search.oninput = () => { this.filter = search.value; renderList(); };
    setTimeout(() => search.focus(), 50);
  }

  onClose(): void { this.contentEl.empty(); }
}
