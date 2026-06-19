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
import { NpcGenerator } from "./engine/NpcGenerator";
import { NpcGeneratorModal } from "./modals/NpcGeneratorModal";
import { BatchNpcModal } from "./modals/BatchNpcModal";
import { ConditionReferenceModal } from "./modals/ConditionReferenceModal";
import { RecapGenerator } from "./engine/RecapGenerator";
import { RecapModal } from "./modals/RecapModal";
import { AiProse } from "./engine/RecapProse";
import { LootManager } from "./engine/LootManager";
import { LootDistributionView, VIEW_TYPE_LOOT } from "./views/LootDistributionView";
import { DashboardView, VIEW_TYPE_DASHBOARD } from "./views/DashboardView";
import { CombatView, VIEW_TYPE_COMBAT } from "./views/CombatView";
import { CharacterView, VIEW_TYPE_CHARACTER } from "./views/CharacterView";
import { SessionNoteView, VIEW_TYPE_SESSION } from "./views/SessionNoteView";
import { LoreView, VIEW_TYPE_LORE } from "./views/LoreView";
import { PrepView, VIEW_TYPE_PREP } from "./views/PrepView";
import { RelationshipMapView, VIEW_TYPE_RELMAP } from "./views/RelationshipMapView";
import { TimelineView, VIEW_TYPE_TIMELINE } from "./views/TimelineView";
import { requireDataview } from "./utils/dataview";
import { DEFAULT_SETTINGS, TTRPGSettings } from "./types";

export default class TTRPGPlugin extends Plugin {
  settings: TTRPGSettings = DEFAULT_SETTINGS;
  systemLoader!: SystemLoader;
  campaignManager!: CampaignManager;
  templateEngine!: TemplateEngine;
  combatStore!: CombatStore;
  lootManager!: LootManager;

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
    this.lootManager = new LootManager(this.app, this.campaignManager, this.systemLoader, this.settings.defaultCampaignFolder);

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
    this.registerView(VIEW_TYPE_CHARACTER, (leaf) => new CharacterView(leaf, this.systemLoader, this.lootManager));
    this.registerView(VIEW_TYPE_SESSION, (leaf) => new SessionNoteView(leaf));
    this.registerView(VIEW_TYPE_LORE, (leaf) => new LoreView(leaf, this.lootManager, this.systemLoader));
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
    this.registerView(VIEW_TYPE_TIMELINE, (leaf) => new TimelineView(
      leaf,
      this.campaignManager,
      this.settings.defaultCampaignFolder
    ));
    this.registerView(VIEW_TYPE_LOOT, (leaf) => new LootDistributionView(
      leaf,
      this.campaignManager,
      this.systemLoader,
      this.lootManager,
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
    this.addCommand({ id: "open-timeline", name: "Open timeline", callback: () => this.activateViewMain(VIEW_TYPE_TIMELINE) });
    this.addCommand({ id: "generate-npc", name: "Generate NPC", callback: () => this.openNpcGenerator() });
    this.addCommand({ id: "generate-npc-batch", name: "Generate NPC batch", callback: () => this.openBatchGenerator() });
    this.addCommand({ id: "condition-reference", name: "Condition reference", callback: () => this.openConditionReference() });
    this.addCommand({ id: "generate-recap", name: "Generate session recap (PDF)", callback: () => this.openRecap() });
    this.addCommand({ id: "open-loot", name: "Open loot distribution", callback: () => this.activateViewMain(VIEW_TYPE_LOOT) });
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
    [VIEW_TYPE_DASHBOARD, VIEW_TYPE_COMBAT, VIEW_TYPE_CHARACTER, VIEW_TYPE_SESSION, VIEW_TYPE_LORE, VIEW_TYPE_PREP, VIEW_TYPE_RELMAP, VIEW_TYPE_TIMELINE, VIEW_TYPE_LOOT]
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

  openRecap(): void {
    const generator = new RecapGenerator(this.app, this.campaignManager, this.settings);
    const label = AiProse.isConfigured(this.settings)
      ? `AI (${this.settings.aiProvider})`
      : "Deterministic (offline)";
    new RecapModal(this.app, generator, label).open();
  }

  openConditionReference(highlight: string | null = null): void {
    const campaign = this.campaignManager.getActive();
    const schema = campaign ? this.systemLoader.get(campaign.system) : undefined;
    const conditions = schema?.conditions ?? [];
    const systemName = schema?.name ?? "Generic";
    new ConditionReferenceModal(this.app, conditions, systemName, highlight).open();
  }

  openQuickSearch(): void {
    new QuickSearchModal(
      this.app,
      this.campaignManager,
      this.settings.defaultCampaignFolder
    ).open();
  }

  openBatchGenerator(): void {
    const generator = new NpcGenerator(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder
    );
    new BatchNpcModal(this.app, generator, async (bodies) => {
      const toAdd = bodies.filter((b) => b.addToCombat);
      if (toAdd.length === 0) return;
      const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMBAT);
      let view: CombatView | null = leaves.length > 0 ? (leaves[0].view as CombatView) : null;
      if (!view) {
        const leaf = this.app.workspace.getRightLeaf(false);
        if (leaf) {
          await leaf.setViewState({ type: VIEW_TYPE_COMBAT, active: true });
          await new Promise((r) => setTimeout(r, 200));
          view = leaf.view as CombatView;
          this.app.workspace.revealLeaf(leaf);
        }
      } else {
        this.app.workspace.revealLeaf(leaves[0]);
      }
      if (view) {
        for (const b of toAdd) view.addExternalCombatant(b.name, b.hp, b.filePath || undefined);
      }
    }).open();
  }

  openNpcGenerator(): void {
    const generator = new NpcGenerator(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.settings.defaultCampaignFolder
    );
    new NpcGeneratorModal(this.app, generator, async (file, addToCombat) => {
      // Open the new NPC note
      await this.app.workspace.getLeaf(false).openFile(file);
      // Optionally add to an open combat tracker
      if (addToCombat) {
        const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_COMBAT);
        const cache = this.app.metadataCache.getFileCache(file);
        const hpKeys = this.systemLoader.get(this.campaignManager.getActive()?.system ?? "")?.entities?.character?.hp;
        const hp = hpKeys ? (cache?.frontmatter?.[hpKeys.max] as number) ?? 8 : 8;
        if (leaves.length > 0) {
          (leaves[0].view as CombatView).addExternalCombatant(file.basename, hp, file.path);
          this.app.workspace.revealLeaf(leaves[0]);
        } else {
          // Open combat tracker then add
          const leaf = this.app.workspace.getRightLeaf(false);
          if (leaf) {
            await leaf.setViewState({ type: VIEW_TYPE_COMBAT, active: true });
            setTimeout(() => {
              (leaf.view as CombatView).addExternalCombatant(file.basename, hp, file.path);
            }, 200);
          }
        }
      }
    }).open();
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

    // ── Session recap ─────────────────────────────────────────────────────────
    containerEl.createEl("h3", { text: "Session recap" });
    new Setting(containerEl)
      .setName("Narrative prose engine")
      .setDesc("Deterministic stitches your notes offline. AI uses an external model (configure below).")
      .addDropdown((d) => {
        d.addOption("deterministic", "Deterministic (offline)");
        d.addOption("ai", "AI (online)");
        d.setValue(this.plugin.settings.recapProseEngine);
        d.onChange(async (v) => {
          this.plugin.settings.recapProseEngine = v as "deterministic" | "ai";
          await this.plugin.saveSettings();
          this.display(); // re-render to update grey-out
        });
      });

    const aiOn = this.plugin.settings.recapProseEngine === "ai";
    const aiSection = containerEl.createDiv();
    aiSection.style.cssText = `opacity:${aiOn ? "1" : "0.5"};pointer-events:${aiOn ? "auto" : "none"};border-left:2px solid var(--background-modifier-border);padding-left:14px;margin-left:2px`;

    new Setting(aiSection)
      .setName("AI provider")
      .setDesc("Anthropic, OpenAI-compatible, or a custom endpoint")
      .addDropdown((d) => {
        d.addOption("anthropic", "Anthropic");
        d.addOption("openai", "OpenAI-compatible");
        d.addOption("custom", "Custom endpoint");
        d.setValue(this.plugin.settings.aiProvider);
        d.onChange(async (v) => { this.plugin.settings.aiProvider = v as any; await this.plugin.saveSettings(); this.display(); });
      });

    if (this.plugin.settings.aiProvider === "custom") {
      new Setting(aiSection)
        .setName("Endpoint URL")
        .setDesc("Full chat-completions URL for your custom/local model")
        .addText((t) => t.setValue(this.plugin.settings.aiEndpoint).onChange(async (v) => { this.plugin.settings.aiEndpoint = v.trim(); await this.plugin.saveSettings(); }));
    }

    new Setting(aiSection)
      .setName("API key")
      .setDesc("Stored locally in your vault settings")
      .addText((t) => { t.inputEl.type = "password"; t.setValue(this.plugin.settings.aiApiKey).onChange(async (v) => { this.plugin.settings.aiApiKey = v.trim(); await this.plugin.saveSettings(); }); });

    new Setting(aiSection)
      .setName("Model")
      .setDesc("e.g. claude-sonnet-4-6 or gpt-4o-mini")
      .addText((t) => t.setValue(this.plugin.settings.aiModel).onChange(async (v) => { this.plugin.settings.aiModel = v.trim(); await this.plugin.saveSettings(); }));

    if (aiOn && !AiProse.isConfigured(this.plugin.settings)) {
      aiSection.createEl("p", { text: "⚠ AI isn't fully configured — recaps will use the offline stitcher until the key (and endpoint, if custom) are set." })
        .style.cssText = "font-size:12px;color:var(--text-warning, #b5820b);margin-top:6px";
    }
  }
}
