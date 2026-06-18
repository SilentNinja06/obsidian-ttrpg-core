import { App, Modal, Setting, Notice } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import type { CampaignConfig } from "../types";

/**
 * Switcher modal: lists all campaigns, lets you pick one, or create a new one.
 */
export class CampaignSwitcherModal extends Modal {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;
  private onSwitch: (id: string) => void;
  private onCreate: () => void;

  constructor(
    app: App,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string,
    onSwitch: (id: string) => void,
    onCreate: () => void
  ) {
    super(app);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
    this.onSwitch = onSwitch;
    this.onCreate = onCreate;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Switch campaign" });

    const activeId = this.campaignManager.getActiveId();
    const campaigns = Array.from(this.campaignManager.getAll().entries());

    if (campaigns.length === 0) {
      contentEl.createEl("p", { text: "No campaigns yet. Create your first one below." });
    }

    const list = contentEl.createDiv();
    list.style.cssText = "display:flex;flex-direction:column;gap:6px;margin-bottom:1rem";

    for (const [id, config] of campaigns) {
      const row = list.createEl("button");
      const isActive = id === activeId;
      row.style.cssText = `display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-m);cursor:pointer;text-align:left;font-family:var(--font-interface);border:1px solid ${isActive ? "var(--interactive-accent)" : "var(--background-modifier-border)"};background:${isActive ? "var(--background-modifier-hover)" : "var(--background-primary)"}`;

      const left = row.createDiv();
      left.createDiv({ text: config.name }).style.cssText = "font-weight:600;font-size:14px;color:var(--text-normal)";
      const sysName = this.systemLoader.get(config.system)?.name ?? config.system;
      left.createDiv({ text: `${sysName} · ${config.status}` }).style.cssText = "font-size:12px;color:var(--text-muted);margin-top:2px";

      if (isActive) {
        row.createSpan({ text: "● active" }).style.cssText = "font-size:11px;color:var(--interactive-accent);font-weight:600";
      }

      row.onclick = () => {
        this.onSwitch(id);
        this.close();
      };
    }

    const newBtn = contentEl.createEl("button", { text: "+ New campaign" });
    newBtn.style.cssText = "width:100%;padding:10px;font-weight:600;cursor:pointer";
    newBtn.onclick = () => {
      this.close();
      this.onCreate();
    };
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/**
 * Creation modal: collects name + system (required) and optional fields,
 * builds the campaign, and reports back the new id.
 */
export class CampaignCreateModal extends Modal {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;
  private onCreated: (id: string) => void;

  private name = "";
  private system = "";
  private players = "";
  private startDate = new Date().toISOString().split("T")[0];
  private description = "";

  constructor(
    app: App,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string,
    onCreated: (id: string) => void
  ) {
    super(app);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
    this.onCreated = onCreated;
    const systems = systemLoader.getAll();
    if (systems.length > 0) this.system = systems[0].id;
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "New campaign" });

    let nameInput: HTMLInputElement | null = null;

    new Setting(contentEl)
      .setName("Name")
      .setDesc("Required")
      .addText((t) => {
        t.setPlaceholder("The Shattered Veil").onChange((v) => { this.name = v; });
        nameInput = t.inputEl;
      });

    new Setting(contentEl)
      .setName("System")
      .setDesc("Required")
      .addDropdown((d) => {
        const systems = this.systemLoader.getAll();
        if (systems.length === 0) {
          d.addOption("", "No systems — add a .yaml to your systems folder");
        }
        for (const s of systems) d.addOption(s.id, s.name);
        d.setValue(this.system);
        d.onChange((v) => { this.system = v; });
      });

    contentEl.createEl("p", { text: "Optional" }).style.cssText = "font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:0.05em;margin:1rem 0 0.25rem";

    new Setting(contentEl)
      .setName("Players")
      .setDesc("Comma-separated")
      .addText((t) => t.setPlaceholder("You, Your cousin").onChange((v) => { this.players = v; }));

    new Setting(contentEl)
      .setName("Start date")
      .addText((t) => {
        t.setValue(this.startDate).onChange((v) => { this.startDate = v; });
        t.inputEl.type = "date";
      });

    new Setting(contentEl)
      .setName("Description")
      .addTextArea((t) => t.setPlaceholder("A short premise…").onChange((v) => { this.description = v; }));

    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Create campaign").setCta().onClick(() => this.submit()));

    if (nameInput) setTimeout(() => nameInput!.focus(), 50);
  }

  private async submit(): Promise<void> {
    if (!this.name.trim()) { new Notice("Please enter a campaign name."); return; }
    if (!this.system) { new Notice("Please select a system."); return; }

    const id = this.name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    if (this.campaignManager.getAll().has(id)) {
      new Notice(`A campaign named "${this.name}" already exists.`);
      return;
    }

    const config: CampaignConfig = {
      name: this.name.trim(),
      system: this.system,
      players: this.players.split(",").map((p) => p.trim()).filter(Boolean),
      activeSince: this.startDate,
      folderRoot: `${this.campaignsFolder}/${id}`,
      status: "active",
    };
    // Attach description if provided (extra field, tolerated by the type)
    if (this.description.trim()) (config as any).description = this.description.trim();

    try {
      await this.campaignManager.createCampaign(this.campaignsFolder, id, config);
      new Notice(`Created campaign: ${this.name}`);
      this.close();
      this.onCreated(id);
    } catch (e) {
      new Notice(`Failed to create campaign: ${(e as Error).message}`);
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
