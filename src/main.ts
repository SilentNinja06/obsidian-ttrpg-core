import {
  Plugin,
  WorkspaceLeaf,
  TFile,
  Notice,
  PluginSettingTab,
  App,
  Setting,
} from "obsidian";

import { SystemLoader } from "./engine/SystemLoader";
import { CampaignManager } from "./engine/CampaignManager";
import { TemplateEngine } from "./engine/TemplateEngine";
import { NoteCreationModal } from "./modals/NoteCreationModal";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./views/DashboardView";
import { CombatView, VIEW_TYPE_COMBAT } from "./views/CombatView";
import {
  CharacterView,
  VIEW_TYPE_CHARACTER,
  SessionNoteView,
  VIEW_TYPE_SESSION,
  LoreView,
  VIEW_TYPE_LORE,
} from "./views/CharacterView";
import { requireDataview } from "./utils/dataview";
import { DEFAULT_SETTINGS, TTRPGSettings } from "./types";

export default class TTRPGPlugin extends Plugin {
  settings: TTRPGSettings = DEFAULT_SETTINGS;
  systemLoader!: SystemLoader;
  campaignManager!: CampaignManager;
  templateEngine!: TemplateEngine;

  async onload(): Promise<void> {
    await this.loadSettings();

    this.app.workspace.onLayoutReady(() => {
      try {
        requireDataview(this.app);
      } catch (e) {
        new Notice((e as Error).message, 8000);
      }
    });

    this.systemLoader = new SystemLoader(this.app);
    this.campaignManager = new CampaignManager(this.app);
    this.templateEngine = new TemplateEngine(this.app);

    this.app.workspace.onLayoutReady(async () => {
      await this.systemLoader.loadAll(this.settings.systemsFolder);
      await this.campaignManager.loadAll(this.settings.defaultCampaignFolder);
      if (this.settings.activeCampaign) {
        this.campaignManager.setActive(this.settings.activeCampaign);
      }
      // Re-render any already-open dashboard leaves
      const existingLeaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
      for (const leaf of existingLeaves) {
        await (leaf.view as DashboardView).render();
      }
      // Auto-open dashboard now that data is ready
      if (this.settings.sidebarDefaultOpen && existingLeaves.length === 0) {
        await this.activateView(VIEW_TYPE_DASHBOARD);
      }
    });

    this.registerView(VIEW_TYPE_DASHBOARD, (leaf) =>
      new DashboardView(
        leaf,
        this.campaignManager,
        this.systemLoader,
        this.templateEngine,
        this.settings.defaultCampaignFolder,
        NoteCreationModal
      )
    );
    this.registerView(VIEW_TYPE_COMBAT, (leaf) => new CombatView(leaf));
    this.registerView(VIEW_TYPE_CHARACTER, (leaf) => new CharacterView(leaf, this.systemLoader));
    this.registerView(VIEW_TYPE_SESSION, (leaf) => new SessionNoteView(leaf));
    this.registerView(VIEW_TYPE_LORE, (leaf) => new LoreView(leaf));

    this.addRibbonIcon("shield", "TTRPG Dashboard", () => {
      this.activateView(VIEW_TYPE_DASHBOARD);
    });

    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => this.activateView(VIEW_TYPE_DASHBOARD) });
    this.addCommand({ id: "open-combat", name: "Open combat tracker", callback: () => this.activateView(VIEW_TYPE_COMBAT) });
    this.addCommand({ id: "new-note", name: "New note", callback: () => this.openNewNoteModal() });
    this.addCommand({ id: "new-note-character", name: "New character", callback: () => this.openNewNoteModal("character") });
    this.addCommand({ id: "new-note-session", name: "New session note", callback: () => this.openNewNoteModal("session") });
    this.addCommand({ id: "new-note-location", name: "New location", callback: () => this.openNewNoteModal("location") });
    this.addCommand({ id: "new-note-faction", name: "New faction", callback: () => this.openNewNoteModal("faction") });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        this.maybeOpenTTRPGView(file);
      })
    );

    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (!(file instanceof TFile)) return;
        if (!file.path.startsWith(this.settings.defaultCampaignFolder)) return;
        setTimeout(async () => {
          const content = await this.app.vault.read(file);
          if (content.trim() === "") this.openNewNoteModal();
        }, 200);
      })
    );

    this.addSettingTab(new TTRPGSettingTab(this.app, this));

  }

  async onunload(): Promise<void> {
    [VIEW_TYPE_DASHBOARD, VIEW_TYPE_COMBAT, VIEW_TYPE_CHARACTER, VIEW_TYPE_SESSION, VIEW_TYPE_LORE]
      .forEach((t) => this.app.workspace.detachLeavesOfType(t));
  }

  async activateView(type: string): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(type);
    let leaf: WorkspaceLeaf | null = existing.length > 0 ? existing[0] : workspace.getRightLeaf(false);
    if (!leaf) return;
    if (existing.length === 0) await leaf.setViewState({ type, active: true });
    workspace.revealLeaf(leaf);
  }

  private maybeOpenTTRPGView(file: TFile): void {
    const cache = this.app.metadataCache.getFileCache(file);
    const type = cache?.frontmatter?.["ttrpg-type"];
    if (!type) return;
    const map: Record<string, string> = {
      character: VIEW_TYPE_CHARACTER,
      session: VIEW_TYPE_SESSION,
      location: VIEW_TYPE_LORE,
      faction: VIEW_TYPE_LORE,
      history: VIEW_TYPE_LORE,
    };
    const viewType = map[type];
    if (!viewType) return;
    const existing = this.app.workspace.getLeavesOfType(viewType);
    if (existing.length > 0) {
      const view = existing[0].view as any;
      if (typeof view.setFile === "function") {
        view.setFile(file);
        this.app.workspace.revealLeaf(existing[0]);
      }
    }
  }

  openNewNoteModal(type?: string): void {
    new NoteCreationModal(
      this.app,
      this.templateEngine,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder,
      type as any
    ).open();
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }
}

class TTRPGSettingTab extends PluginSettingTab {
  plugin: TTRPGPlugin;
  constructor(app: App, plugin: TTRPGPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl("h2", { text: "TTRPG Campaign Manager" });
    new Setting(containerEl).setName("Campaigns folder").addText((t) => t.setValue(this.plugin.settings.defaultCampaignFolder).onChange(async (v) => { this.plugin.settings.defaultCampaignFolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Systems folder").addText((t) => t.setValue(this.plugin.settings.systemsFolder).onChange(async (v) => { this.plugin.settings.systemsFolder = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Active campaign").setDesc("Must match a folder name inside your campaigns folder").addText((t) => t.setValue(this.plugin.settings.activeCampaign).onChange(async (v) => {
    this.plugin.settings.activeCampaign = v;
    this.plugin.campaignManager.setActive(v);
    await this.plugin.saveSettings();
    const leaves = this.plugin.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    for (const leaf of leaves) { await (leaf.view as any).render(); }
  }));
    new Setting(containerEl).setName("Open dashboard on startup").addToggle((t) => t.setValue(this.plugin.settings.sidebarDefaultOpen).onChange(async (v) => { this.plugin.settings.sidebarDefaultOpen = v; await this.plugin.saveSettings(); }));
    new Setting(containerEl).setName("Reload systems").addButton((b) => b.setButtonText("Reload").onClick(async () => { await this.plugin.systemLoader.loadAll(this.plugin.settings.systemsFolder); new Notice("Systems reloaded"); }));
  }
}
