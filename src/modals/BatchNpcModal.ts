import { App, Modal, Setting, Notice } from "obsidian";
import type { NpcGenerator, BatchEntry, GeneratedBody } from "../engine/NpcGenerator";
import type { ArchetypeDefinition } from "../types";

export class BatchNpcModal extends Modal {
  private generator: NpcGenerator;
  private onDone: (bodies: GeneratedBody[]) => void;

  private baseName = "";
  private storyImportant = false;
  private individualNotes = false;
  private addToCombat = true;
  private counts: Record<string, number> = {};

  constructor(app: App, generator: NpcGenerator, onDone: (bodies: GeneratedBody[]) => void) {
    super(app);
    this.generator = generator;
    this.onDone = onDone;
    for (const a of generator.getArchetypes()) this.counts[a.id] = 0;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Generate NPC batch" });

    const archetypes = this.generator.getArchetypes();
    if (archetypes.length === 0) {
      contentEl.createEl("p", {
        text: "This system has no archetypes defined. Add an 'archetypes' block to the system YAML to use batch generation.",
      });
      new Setting(contentEl).addButton((b) => b.setButtonText("Close").onClick(() => this.close()));
      return;
    }

    new Setting(contentEl)
      .setName("Base name")
      .setDesc("e.g. Goblin → Goblin Brute 1, Goblin Caster 1…")
      .addText((t) => {
        t.setPlaceholder("Goblin").onChange((v) => { this.baseName = v; });
        setTimeout(() => t.inputEl.focus(), 50);
      });

    contentEl.createEl("p", { text: "How many of each archetype?" })
      .style.cssText = "font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin:1rem 0 0.25rem";

    for (const a of archetypes) {
      new Setting(contentEl)
        .setName(a.label)
        .addText((t) => {
          t.inputEl.type = "number";
          t.inputEl.min = "0";
          t.inputEl.placeholder = "0";
          t.setValue("").onChange((v) => { this.counts[a.id] = parseInt(v) || 0; });
          t.inputEl.style.width = "60px";
        });
    }

    contentEl.createEl("hr").style.cssText = "border:none;border-top:0.5px solid var(--background-modifier-border);margin:1rem 0";

    new Setting(contentEl)
      .setName("Story-critical")
      .setDesc("On: stored in characters/npcs/ · Off: stored in characters/fodder/ (disposable)")
      .addToggle((t) => t.setValue(this.storyImportant).onChange((v) => { this.storyImportant = v; }));

    new Setting(contentEl)
      .setName("Individual notes")
      .setDesc("On: a note per NPC · Off: one shared note per archetype group")
      .addToggle((t) => t.setValue(this.individualNotes).onChange((v) => { this.individualNotes = v; }));

    new Setting(contentEl)
      .setName("Add to combat tracker")
      .setDesc("Adds each generated body as a combatant")
      .addToggle((t) => t.setValue(this.addToCombat).onChange((v) => { this.addToCombat = v; }));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Generate batch").setCta().onClick(() => this.submit()));
  }

  private async submit(): Promise<void> {
    if (!this.baseName.trim()) { new Notice("Please enter a base name."); return; }
    const entries: BatchEntry[] = Object.entries(this.counts)
      .filter(([, c]) => c > 0)
      .map(([archetypeId, count]) => ({ archetypeId, count }));
    if (entries.length === 0) { new Notice("Set a count of at least 1 for one archetype."); return; }

    const total = entries.reduce((sum, e) => sum + e.count, 0);
    const bodies = await this.generator.createBatch(
      this.baseName.trim(),
      entries,
      this.storyImportant,
      this.individualNotes
    );

    // Apply the add-to-combat default to all bodies
    for (const b of bodies) b.addToCombat = this.addToCombat;

    new Notice(`Generated ${total} NPC${total === 1 ? "" : "s"}`);
    this.close();
    this.onDone(bodies);
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
