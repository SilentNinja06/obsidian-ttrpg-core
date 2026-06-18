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
import { CombatStore } from "./engine/CombatStore";
import { NoteCreationModal } from "./modals/NoteCreationModal";
import { CampaignSwitcherModal, CampaignCreateModal } from "./modals/CampaignModal";
import { QuickSearchModal } from "./modals/QuickSearchModal";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./views/DashboardView";
import { CombatView, VIEW_TYPE_COMBAT } from "./views/CombatView";
import { CharacterView, VIEW_TYPE_CHARACTER } from "./views/CharacterView";
import { SessionNoteView, VIEW_TYPE_SESSION } from "./views/SessionNoteView";
import { LoreView, VIEW_TYPE_LORE } from "./views/LoreView";
import { PrepView, VIEW_TYPE_PREP } from "./views/PrepView";
import { RelationshipMapView, VIEW_TYPE_RELMAP } from "./views/RelationshipMapView";
import { requireDataview } from "./utils/dataview";
import { DEFAULT_SETTINGS, TTRPGSettings } from "./types";

export default class TTRPGPlugin extends Plugin {
  settings: TTRPGSettings = DEFAULT_SETTINGS;
  systemLoader!: SystemLoader;
  campaignManager!: CampaignManager;
  templateEngine!: TemplateEngine;
  combatStore!: CombatStore;

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
    this.combatStore = new CombatStore(this.app);

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
    this.registerView(VIEW_TYPE_COMBAT, (leaf) => new CombatView(
      leaf,
      this.combatStore,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder
    ));
    this.registerView(VIEW_TYPE_CHARACTER, (leaf) => new CharacterView(leaf, this.systemLoader));
    this.registerView(VIEW_TYPE_SESSION, (leaf) => new SessionNoteView(leaf));
    this.registerView(VIEW_TYPE_LORE, (leaf) => new LoreView(leaf));
    this.registerView(VIEW_TYPE_PREP, (leaf) => new PrepView(
      leaf,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder
    ));
    this.registerView(VIEW_TYPE_RELMAP, (leaf) => new RelationshipMapView(
      leaf,
      this.campaignManager,
      this.settings.defaultCampaignFolder
    ));

    this.addRibbonIcon("shield", "TTRPG Dashboard", () => {
      this.activateView(VIEW_TYPE_DASHBOARD);
    });

    this.addCommand({ id: "open-dashboard", name: "Open dashboard", callback: () => this.activateView(VIEW_TYPE_DASHBOARD) });
    this.addCommand({ id: "open-combat", name: "Open combat tracker", callback: () => this.activateView(VIEW_TYPE_COMBAT) });
    this.addCommand({ id: "switch-campaign", name: "Switch campaign", callback: () => this.openCampaignSwitcher() });
    this.addCommand({ id: "new-campaign", name: "New campaign", callback: () => this.openCampaignCreate() });
    this.addCommand({ id: "quick-search", name: "Quick search (jump to note)", callback: () => this.openQuickSearch() });
    this.addCommand({ id: "open-prep", name: "Open session prep", callback: () => this.activateView(VIEW_TYPE_PREP) });
    this.addCommand({ id: "open-relmap", name: "Open relationship map", callback: () => this.activateViewMain(VIEW_TYPE_RELMAP) });
    this.addCommand({ id: "new-note", name: "New note", callback: () => this.openNewNoteModal() });
    this.addCommand({ id: "new-note-character", name: "New character", callback: () => this.openNewNoteModal("character") });
    this.addCommand({ id: "new-note-session", name: "New session note", callback: () => this.openNewNoteModal("session") });
    this.addCommand({ id: "new-note-location", name: "New location", callback: () => this.openNewNoteModal("location") });
    this.addCommand({ id: "new-note-faction", name: "New faction", callback: () => this.openNewNoteModal("faction") });

    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!file) return;
        // Small delay so the markdown leaf is fully settled before we swap it
        window.setTimeout(() => this.maybeOpenTTRPGView(file), 30);
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
    [VIEW_TYPE_DASHBOARD, VIEW_TYPE_COMBAT, VIEW_TYPE_CHARACTER, VIEW_TYPE_SESSION, VIEW_TYPE_LORE, VIEW_TYPE_PREP, VIEW_TYPE_RELMAP]
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

  async activateViewMain(type: string): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(type);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getLeaf("tab");
    await leaf.setViewState({ type, active: true });
    workspace.revealLeaf(leaf);
  }

  private suppressNextOpen = false;

  private isSwapping = false;

  private async maybeOpenTTRPGView(file: TFile): Promise<void> {
    if (this.suppressNextOpen) {
      this.suppressNextOpen = false;
      return;
    }
    if (this.isSwapping) return;

    // Read frontmatter directly — the metadata cache may not be populated yet
    // for freshly created files.
    let type: string | undefined;
    const cache = this.app.metadataCache.getFileCache(file);
    type = cache?.frontmatter?.["ttrpg-type"] as string | undefined;
    if (!type) {
      try {
        const raw = await this.app.vault.read(file);
        const m = raw.match(/^---\n([\s\S]*?)\n---/);
        if (m) {
          const tm = m[1].match(/ttrpg-type:\s*(\S+)/);
          if (tm) type = tm[1].trim();
        }
      } catch (e) {
        return;
      }
    }
    if (!type) return;

    const map: Record<string, string> = {
      character: VIEW_TYPE_CHARACTER,
      session: VIEW_TYPE_SESSION,
      location: VIEW_TYPE_LORE,
      faction: VIEW_TYPE_LORE,
      history: VIEW_TYPE_LORE,
      item: VIEW_TYPE_LORE,
    };
    const viewType = map[type];
    if (!viewType) return;

    // Find the leaf currently showing this markdown file
    let targetLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const vs = leaf.getViewState();
      if (vs.type === "markdown" && (vs.state as any)?.file === file.path) {
        targetLeaf = leaf;
      }
    });

    if (!targetLeaf) {
      targetLeaf = this.app.workspace.getMostRecentLeaf();
    }
    if (!targetLeaf) return;

    this.isSwapping = true;
    try {
      await (targetLeaf as WorkspaceLeaf).setViewState({
        type: viewType,
        active: true,
        state: { file: file.path },
      });
      const view = (targetLeaf as WorkspaceLeaf).view as any;
      if (typeof view.setFile === "function") {
        view.setFile(file);
      }
    } finally {
      window.setTimeout(() => { this.isSwapping = false; }, 50);
    }
  }

  /** Called by the Edit source buttons to open raw markdown without re-interception */
  openSource(file: TFile): void {
    this.suppressNextOpen = true;
    this.app.workspace.getLeaf("tab").openFile(file);
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

  private async switchCampaign(id: string): Promise<void> {
    this.campaignManager.setActive(id);
    this.settings.activeCampaign = id;
    await this.saveSettings();
    await this.activateView(VIEW_TYPE_DASHBOARD);
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_DASHBOARD);
    for (const leaf of leaves) await (leaf.view as DashboardView).render();
  }

  openCampaignSwitcher(): void {
    new CampaignSwitcherModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder,
      (id) => this.switchCampaign(id),
      () => this.openCampaignCreate()
    ).open();
  }

  openCampaignCreate(): void {
    new CampaignCreateModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder,
      (id) => this.switchCampaign(id)
    ).open();
  }

  openQuickSearch(): void {
    new QuickSearchModal(
      this.app,
      this.campaignManager,
      this.settings.defaultCampaignFolder
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
