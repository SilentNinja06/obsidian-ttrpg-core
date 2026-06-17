import { App, Modal, Setting, Notice } from "obsidian";
import type { NoteType, SystemSchema, CampaignConfig } from "../types";
import type { TemplateEngine } from "../engine/TemplateEngine";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";

export class NoteCreationModal extends Modal {
  private templateEngine: TemplateEngine;
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;

  private selectedType: NoteType = "character";
  private selectedCampaign: string = "";
  private selectedSystem: string = "";
  private noteName: string = "";
  private isPC: boolean = false;

  constructor(
    app: App,
    templateEngine: TemplateEngine,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string,
    defaultType?: NoteType
  ) {
    super(app);
    this.templateEngine = templateEngine;
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
    if (defaultType) this.selectedType = defaultType;

    const activeCampaign = campaignManager.getActiveId();
    if (activeCampaign) {
      this.selectedCampaign = activeCampaign;
      const config = campaignManager.getActive();
      if (config) this.selectedSystem = config.system;
    }
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ttrpg-modal");

    contentEl.createEl("h2", { text: "New note" });
    contentEl.createEl("p", {
      text: "Answer a few questions — the plugin handles the rest.",
      cls: "ttrpg-modal-sub",
    });

    // Name
    new Setting(contentEl)
      .setName("Name")
      .setDesc("e.g. Skrix, The Iron Citadel, Session 05…")
      .addText((text) => {
        text.setPlaceholder("Note name").onChange((val) => {
          this.noteName = val;
          this.updatePathPreview(pathPreview);
        });
        setTimeout(() => text.inputEl.focus(), 50);
      });

    // Type
    new Setting(contentEl).setName("Type").setDesc("What kind of note is this?");
    const typeGrid = contentEl.createDiv("ttrpg-type-grid");
    const types: { type: NoteType; icon: string; label: string }[] = [
      { type: "character", icon: "👤", label: "Character" },
      { type: "location", icon: "🏰", label: "Location" },
      { type: "faction", icon: "⚔️", label: "Faction" },
      { type: "session", icon: "📋", label: "Session" },
      { type: "history", icon: "📜", label: "History" },
      { type: "item", icon: "⚗️", label: "Item" },
    ];
    const typeButtons: HTMLElement[] = [];
    for (const { type, icon, label } of types) {
      const btn = typeGrid.createEl("button", { cls: "ttrpg-type-btn" });
      btn.createSpan({ text: icon, cls: "ttrpg-type-icon" });
      btn.createSpan({ text: label, cls: "ttrpg-type-label" });
      if (type === this.selectedType) btn.addClass("selected");
      btn.onclick = () => {
        this.selectedType = type;
        typeButtons.forEach((b) => b.removeClass("selected"));
        btn.addClass("selected");
        this.updatePathPreview(pathPreview);
      };
      typeButtons.push(btn);
    }

    // PC toggle (shows when character is selected)
    new Setting(contentEl)
      .setName("Player character?")
      .setDesc("Toggle on for PCs — they go in characters/pcs/ instead of npcs/")
      .addToggle((toggle) => {
        toggle.onChange((val) => {
          this.isPC = val;
          this.updatePathPreview(pathPreview);
        });
      });

    // Campaign
    const campaigns = Array.from(this.campaignManager.getAll().entries());
    new Setting(contentEl)
      .setName("Campaign")
      .addDropdown((drop) => {
        if (campaigns.length === 0) {
          drop.addOption("", "No campaigns found");
        }
        for (const [id, config] of campaigns) {
          drop.addOption(id, config.name);
        }
        drop.setValue(this.selectedCampaign);
        drop.onChange((val) => {
          this.selectedCampaign = val;
          const config = this.campaignManager.getAll().get(val);
          if (config) this.selectedSystem = config.system;
          this.updatePathPreview(pathPreview);
        });
      });

    // System
    const systems = this.systemLoader.getAll();
    new Setting(contentEl)
      .setName("System")
      .addDropdown((drop) => {
        if (systems.length === 0) {
          drop.addOption("", "No systems found — add a .yaml to your systems folder");
        }
        for (const schema of systems) {
          drop.addOption(schema.id, schema.name);
        }
        drop.setValue(this.selectedSystem);
        drop.onChange((val) => {
          this.selectedSystem = val;
        });
      });

    // Path preview
    const previewSetting = new Setting(contentEl).setName("Will be created at");
    const pathPreview = previewSetting.controlEl.createEl("code", {
      cls: "ttrpg-path-preview",
    });
    this.updatePathPreview(pathPreview);

    // Footer buttons
    new Setting(contentEl)
      .addButton((btn) => {
        btn.setButtonText("Cancel").onClick(() => this.close());
      })
      .addButton((btn) => {
        btn
          .setButtonText("Create note →")
          .setCta()
          .onClick(() => this.submit());
      });
  }

  private updatePathPreview(el: HTMLElement): void {
    const campaignSlug = this.selectedCampaign || "campaign";
    const nameSlug = this.noteName
      ? this.noteName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "")
      : "untitled";
    const schema = this.systemLoader.get(this.selectedSystem);
    const folder = schema
      ? this.templateEngine.folderFor(this.selectedType, "", this.isPC).replace(/^\//, "")
      : FOLDER_LABELS[this.selectedType];

    el.textContent = `${this.campaignsFolder}/${campaignSlug}/${folder}/${nameSlug}.md`;
  }

  private async submit(): Promise<void> {
    if (!this.noteName.trim()) {
      new Notice("Please enter a name for the note.");
      return;
    }
    if (!this.selectedCampaign) {
      new Notice("Please select a campaign.");
      return;
    }
    const schema = this.systemLoader.get(this.selectedSystem);
    if (!schema) {
      new Notice("Please select a valid system.");
      return;
    }

    const campaignFolder = `${this.campaignsFolder}/${this.selectedCampaign}`;

    try {
      const path = await this.templateEngine.createNote(
        this.selectedType,
        this.noteName.trim(),
        campaignFolder,
        this.selectedCampaign,
        schema,
        this.isPC
      );
      this.close();
      const file = this.app.vault.getFileByPath(path);
      if (file) {
        await this.app.workspace.getLeaf(false).openFile(file);
      }
      new Notice(`Created: ${this.noteName}`);
    } catch (e) {
      new Notice(`Failed to create note: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

const FOLDER_LABELS: Record<NoteType, string> = {
  character: "characters/npcs",
  location: "lore/places",
  faction: "lore/factions",
  session: "sessions",
  history: "lore/history",
  item: "inventory/party",
};
