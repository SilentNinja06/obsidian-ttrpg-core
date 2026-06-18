import { App, Modal, Setting, Notice, TFile } from "obsidian";
import type { NpcGenerator } from "../engine/NpcGenerator";
import type { ArchetypeDefinition } from "../types";

export class NpcGeneratorModal extends Modal {
  private generator: NpcGenerator;
  private onCreated: (file: TFile, addToCombat: boolean) => void;

  private name = "";
  private archetype: ArchetypeDefinition | null = null;
  private addToCombat = false;
  private storyImportant = true;

  constructor(app: App, generator: NpcGenerator, onCreated: (file: TFile, addToCombat: boolean) => void) {
    super(app);
    this.generator = generator;
    this.onCreated = onCreated;
    this.name = generator.randomName();
    const archetypes = generator.getArchetypes();
    if (archetypes.length) this.archetype = archetypes[0];
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Generate NPC" });

    const archetypes = this.generator.getArchetypes();

    // Name with re-roll
    const nameSetting = new Setting(contentEl)
      .setName("Name")
      .addText((t) => {
        t.setValue(this.name).onChange((v) => { this.name = v; });
        (this as any)._nameInput = t;
      })
      .addExtraButton((b) => {
        b.setIcon("dice").setTooltip("Re-roll name").onClick(() => {
          this.name = this.generator.randomName();
          (this as any)._nameInput.setValue(this.name);
        });
      });

    // Archetype
    if (archetypes.length) {
      new Setting(contentEl)
        .setName("Archetype")
        .setDesc("Weights the rolled stats")
        .addDropdown((d) => {
          for (const a of archetypes) d.addOption(a.id, a.label);
          d.setValue(this.archetype?.id ?? archetypes[0].id);
          d.onChange((v) => {
            this.archetype = archetypes.find((a) => a.id === v) ?? null;
          });
        });
    } else {
      contentEl.createEl("p", {
        text: "This system has no archetypes defined — stats will be rolled balanced. Add an 'archetypes' block to the system YAML for weighted generation.",
      }).style.cssText = "font-size:12px;color:var(--text-muted)";
    }

    // Story-critical toggle
    new Setting(contentEl)
      .setName("Story-critical")
      .setDesc("On: stored in characters/npcs/ · Off: characters/fodder/ (disposable)")
      .addToggle((t) => t.setValue(this.storyImportant).onChange((v) => { this.storyImportant = v; }));

    // Add to combat toggle
    new Setting(contentEl)
      .setName("Add to combat tracker")
      .setDesc("Drop this NPC straight into the active combat")
      .addToggle((t) => t.setValue(this.addToCombat).onChange((v) => { this.addToCombat = v; }));

    // Buttons
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Generate").setCta().onClick(() => this.submit()));
  }

  private async submit(): Promise<void> {
    if (!this.name.trim()) { new Notice("Please enter a name."); return; }
    const file = await this.generator.createNpc(this.name.trim(), this.archetype, this.storyImportant);
    if (file) {
      this.close();
      this.onCreated(file, this.addToCombat);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
