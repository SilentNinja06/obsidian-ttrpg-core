import { ItemView, WorkspaceLeaf, App, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import type { TemplateEngine } from "../engine/TemplateEngine";
import type { NoteCreationModal } from "../modals/NoteCreationModal";
import type { NoteType } from "../types";
import { CampaignSwitcherModal, CampaignCreateModal } from "../modals/CampaignModal";
import { collectOpenThreads, collectUnassignedLoot } from "../utils/queries";

export const VIEW_TYPE_DASHBOARD = "ttrpg-dashboard";

export class DashboardView extends ItemView {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private templateEngine: TemplateEngine;
  private campaignsFolder: string;
  private ModalClass: typeof NoteCreationModal;

  constructor(
    leaf: WorkspaceLeaf,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    templateEngine: TemplateEngine,
    campaignsFolder: string,
    ModalClass: typeof NoteCreationModal
  ) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.templateEngine = templateEngine;
    this.campaignsFolder = campaignsFolder;
    this.ModalClass = ModalClass;
  }

  getViewType(): string {
    return VIEW_TYPE_DASHBOARD;
  }

  getDisplayText(): string {
    return "TTRPG Dashboard";
  }

  getIcon(): string {
    return "shield";
  }

  async onOpen(): Promise<void> {
    // Load campaigns fresh each time the view opens so timing doesn't matter
    await this.campaignManager.loadAll(this.campaignsFolder);
    const activeId = this.campaignManager.getActiveId();
    if (!activeId) {
      // Try to set from the plugin settings directly — but only if that
      // campaign still exists on disk (it may have been deleted).
      const plugin = (this.app as any).plugins?.plugins?.['ttrpg-core'];
      const wanted = plugin?.settings?.activeCampaign;
      if (wanted && this.campaignManager.getAll().has(wanted)) {
        this.campaignManager.setActive(wanted);
      } else if (wanted && plugin) {
        // Stale setting — clear it so we don't keep pointing at a dead campaign
        plugin.settings.activeCampaign = this.campaignManager.getActiveId();
        await plugin.saveSettings?.();
      }
    }
    await this.render();
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ttrpg-dashboard");

    const campaign = this.campaignManager.getActive();
    const campaignId = this.campaignManager.getActiveId() || "";

    if (!campaign || !campaignId) {
      container.createEl("p", {
        text: "No active campaign.",
        cls: "ttrpg-empty",
      });
      const all = this.campaignManager.getAll();
      const btnRow = container.createDiv();
      btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px";
      if (all.size > 0) {
        const switchBtn = btnRow.createEl("button", { text: "Choose campaign" });
        switchBtn.onclick = () => this.openSwitcher();
      }
      const createBtn = btnRow.createEl("button", { text: "+ New campaign" });
      createBtn.onclick = () => this.openCreate();
      return;
    }

    // Header
    const header = container.createDiv("ttrpg-dash-header");
    const titleEl = header.createEl("h2", { text: campaign.name });
    titleEl.style.cssText = "cursor:pointer;display:inline-flex;align-items:center;gap:6px";
    titleEl.title = "Click to switch campaign";
    const caret = titleEl.createSpan({ text: " ⌄" });
    caret.style.cssText = "font-size:14px;color:var(--color-text-tertiary)";
    titleEl.onclick = () => this.openSwitcher();
    header.createEl("p", {
      text: `${this.systemLoader.get(campaign.system)?.name ?? campaign.system} · ${campaign.status}`,
      cls: "ttrpg-muted",
    });

    // Action buttons
    const actions = header.createDiv("ttrpg-dash-actions");

    // Helper to build a labeled group of buttons
    const makeGroup = (label: string): HTMLElement => {
      const group = actions.createDiv("ttrpg-action-group");
      group.style.cssText = "margin-bottom:10px";
      const lbl = group.createEl("div", { text: label });
      lbl.style.cssText = "font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:0.06em;color:var(--color-text-tertiary);margin-bottom:5px";
      const row = group.createDiv();
      row.style.cssText = "display:flex;gap:6px;flex-wrap:wrap";
      return row;
    };

    // ── At the table (live play) ──
    const playRow = makeGroup("At the table");
    const newSessionBtn = playRow.createEl("button", { text: "+ New session" });
    newSessionBtn.onclick = () => this.openNewNote("session");

    const combatBtn = playRow.createEl("button", { text: "⚔️ Combat tracker" });
    combatBtn.onclick = () => this.openCombat();

    const npcBtn = playRow.createEl("button", { text: "🎲 Generate NPC" });
    npcBtn.onclick = () => {
      const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
      if (plugin?.openNpcGenerator) plugin.openNpcGenerator();
    };

    const batchBtn = playRow.createEl("button", { text: "🎲 NPC batch" });
    batchBtn.onclick = () => {
      const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
      if (plugin?.openBatchGenerator) plugin.openBatchGenerator();
    };

    const lootBtn = playRow.createEl("button", { text: "💰 Distribute loot" });
    lootBtn.onclick = async () => {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "ttrpg-loot", active: true });
      this.app.workspace.revealLeaf(leaf);
    };

    // ── Prep & reference (between sessions) ──
    const prepRow = makeGroup("Prep & reference");
    const prepBtn = prepRow.createEl("button", { text: "📋 Session prep" });
    prepBtn.onclick = () => {
      this.app.workspace.getRightLeaf(false)?.setViewState({ type: "ttrpg-prep", active: true });
    };

    const searchBtn = prepRow.createEl("button", { text: "🔍 Search" });
    searchBtn.onclick = () => {
      const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
      if (plugin?.openQuickSearch) plugin.openQuickSearch();
    };

    const mapBtn = prepRow.createEl("button", { text: "🔗 Relationship map" });
    mapBtn.onclick = async () => {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "ttrpg-relmap", active: true });
      this.app.workspace.revealLeaf(leaf);
    };

    const timelineBtn = prepRow.createEl("button", { text: "🕐 Timeline" });
    timelineBtn.onclick = async () => {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "ttrpg-timeline", active: true });
      this.app.workspace.revealLeaf(leaf);
    };

    const recapBtn = prepRow.createEl("button", { text: "📄 Session recap" });
    recapBtn.onclick = () => {
      const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
      if (plugin?.openRecap) plugin.openRecap();
    };

    const dungeonBtn = prepRow.createEl("button", { text: "🗺️ Dungeon map" });
    dungeonBtn.onclick = async () => {
      const leaf = this.app.workspace.getLeaf("tab");
      await leaf.setViewState({ type: "ttrpg-dungeon", active: true });
      this.app.workspace.revealLeaf(leaf);
    };

    const popoutBtn = prepRow.createEl("button", { text: "⤢ Pop out" });
    popoutBtn.onclick = () => {
      this.app.workspace.moveLeafToPopout(this.leaf);
    };

    // Quick create grid
    const qcSection = container.createDiv("ttrpg-section");
    qcSection.createEl("h3", { text: "Quick create" });
    const grid = qcSection.createDiv("ttrpg-quick-grid");
    const types: { type: NoteType; icon: string; label: string }[] = [
      { type: "character", icon: "👤", label: "Character" },
      { type: "location", icon: "🏰", label: "Location" },
      { type: "faction", icon: "⚔️", label: "Faction" },
      { type: "session", icon: "📋", label: "Session" },
      { type: "history", icon: "📜", label: "History" },
      { type: "item", icon: "⚗️", label: "Item" },
    ];
    for (const { type, icon, label } of types) {
      const btn = grid.createEl("button", { cls: "ttrpg-quick-btn" });
      btn.createSpan({ text: icon });
      btn.createSpan({ text: label });
      btn.onclick = () => this.openNewNote(type);
    }

    // Open threads (live from session notes)
    const campaignFolder = `${this.campaignsFolder}/${campaignId}`;
    const threads = await collectOpenThreads(this.app, campaignFolder);
    const threadsSection = container.createDiv("ttrpg-section");
    threadsSection.createEl("h3", { text: `Open threads${threads.length ? ` (${threads.length})` : ""}` });
    if (threads.length === 0) {
      threadsSection.createEl("p", { text: "No open threads.", cls: "ttrpg-muted" });
    } else {
      const list = threadsSection.createDiv();
      for (const thread of threads.slice(0, 12)) {
        const row = list.createDiv();
        row.style.cssText = "display:flex;align-items:flex-start;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px";
        const dot = row.createSpan();
        dot.style.cssText = "width:6px;height:6px;border-radius:50%;background:#BA7517;flex-shrink:0;margin-top:5px";
        row.createSpan({ text: thread.text }).style.cssText = "flex:1;color:var(--color-text-primary);line-height:1.4";
        const src = row.createEl("a", { text: thread.sessionName });
        src.style.cssText = "font-size:11px;color:var(--color-text-tertiary);white-space:nowrap;cursor:pointer";
        src.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getFileByPath(thread.sessionPath);
          if (f) this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }

    // Unassigned loot (live — inventory notes + session loot bullets)
    const loot = await collectUnassignedLoot(this.app, campaignFolder);
    const lootSection = container.createDiv("ttrpg-section");
    lootSection.createEl("h3", { text: `Unassigned loot${loot.length ? ` (${loot.length})` : ""}` });
    if (loot.length === 0) {
      lootSection.createEl("p", { text: "No unassigned loot.", cls: "ttrpg-muted" });
    } else {
      const list = lootSection.createDiv();
      for (const item of loot.slice(0, 12)) {
        const row = list.createDiv();
        row.style.cssText = "display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:0.5px solid var(--color-border-tertiary);font-size:13px";
        row.createSpan({ text: item.name }).style.cssText = "flex:1;color:var(--color-text-primary)";
        const src = row.createEl("a", { text: item.source });
        src.style.cssText = "font-size:11px;color:var(--color-text-tertiary);white-space:nowrap;cursor:pointer";
        src.onclick = (e) => {
          e.preventDefault();
          const f = this.app.vault.getFileByPath(item.sourcePath);
          if (f) this.app.workspace.getLeaf(false).openFile(f);
        };
      }
    }

    // Recent files
    const recentSection = container.createDiv("ttrpg-section");
    recentSection.createEl("h3", { text: "Recent activity" });
    const recentFiles = this.app.vault
      .getMarkdownFiles()
      .filter((f) => f.path.startsWith(campaignFolder))
      .sort((a, b) => b.stat.mtime - a.stat.mtime)
      .slice(0, 8);

    if (recentFiles.length === 0) {
      recentSection.createEl("p", { text: "No notes yet.", cls: "ttrpg-muted" });
    } else {
      const list = recentSection.createEl("ul", { cls: "ttrpg-recent-list" });
      for (const file of recentFiles) {
        const li = list.createEl("li");
        const link = li.createEl("a", { text: file.basename, cls: "ttrpg-link" });
        link.onclick = (e) => {
          e.preventDefault();
          this.app.workspace.getLeaf(false).openFile(file);
        };
        li.createSpan({
          text: this.formatRelativeTime(file.stat.mtime),
          cls: "ttrpg-muted ttrpg-when",
        });
      }
    }
  }

  private openNewNote(type: NoteType): void {
    const modal = new this.ModalClass(
      this.app,
      this.templateEngine,
      this.campaignManager,
      this.systemLoader,
      this.campaignsFolder,
      type
    );
    modal.open();
  }

  private openCombat(): void {
    this.app.workspace.getRightLeaf(false)?.setViewState({
      type: "ttrpg-combat",
      active: true,
    });
  }

  private async switchTo(id: string): Promise<void> {
    this.campaignManager.setActive(id);
    const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
    if (plugin) {
      plugin.settings.activeCampaign = id;
      await plugin.saveSettings();
    }
    await this.render();
  }

  async openSwitcher(): Promise<void> {
    // Re-scan disk so deleted/added campaigns are reflected (the in-memory list
    // can go stale if folders are changed outside the plugin).
    await this.campaignManager.loadAll(this.campaignsFolder);
    new CampaignSwitcherModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.campaignsFolder,
      (id) => this.switchTo(id),
      () => this.openCreate(),
      () => this.render()
    ).open();
  }

  openCreate(): void {
    new CampaignCreateModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.campaignsFolder,
      (id) => this.switchTo(id)
    ).open();
  }

  private formatRelativeTime(mtime: number): string {
    const diff = Date.now() - mtime;
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }
}
