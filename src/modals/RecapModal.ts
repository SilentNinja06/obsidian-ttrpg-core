import { App, Modal, Setting, Notice } from "obsidian";
import type { RecapGenerator, RecapScope, RecapStyle } from "../engine/RecapGenerator";

export class RecapModal extends Modal {
  private generator: RecapGenerator;
  private recapScope: RecapScope = "last";
  private style: RecapStyle = "narrative";
  private proseEngineLabel: string;

  constructor(app: App, generator: RecapGenerator, proseEngineLabel: string) {
    super(app);
    this.generator = generator;
    this.proseEngineLabel = proseEngineLabel;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Generate session recap" });

    new Setting(contentEl)
      .setName("Scope")
      .setDesc("Recap just the last session or the whole campaign")
      .addDropdown((d) => {
        d.addOption("last", "Last session");
        d.addOption("campaign", "Campaign to date");
        d.setValue(this.recapScope);
        d.onChange((v) => { this.recapScope = v as RecapScope; });
      });

    new Setting(contentEl)
      .setName("Style")
      .setDesc("Narrative prose or a structured bulleted digest")
      .addDropdown((d) => {
        d.addOption("narrative", "Narrative prose");
        d.addOption("bulleted", "Bulleted digest");
        d.setValue(this.style);
        d.onChange((v) => { this.style = v as RecapStyle; });
      });

    contentEl.createEl("p", {
      text: `Narrative prose engine: ${this.proseEngineLabel}. Change it in plugin settings.`,
    }).style.cssText = "font-size:12px;color:var(--text-muted);margin-top:4px";

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Generate PDF").setCta().onClick(async () => {
        b.setButtonText("Generating…").setDisabled(true);
        try {
          await this.generator.generate(this.recapScope, this.style);
          this.close();
        } catch (e) {
          new Notice(`Recap failed: ${(e as Error).message.slice(0, 120)}`);
          b.setButtonText("Generate PDF").setDisabled(false);
        }
      }));
  }

  onClose(): void { this.contentEl.empty(); }
}
