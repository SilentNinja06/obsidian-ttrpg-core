import { ItemView, WorkspaceLeaf, App, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import type { TemplateEngine } from "../engine/TemplateEngine";
import type { NoteCreationModal } from "../modals/NoteCreationModal";
import type { NoteType } from "../types";
import { CampaignSwitcherModal, CampaignCreateModal } from "../modals/CampaignModal";

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
      // Try to set from the plugin settings directly
      const plugin = (this.app as any).plugins?.plugins?.['ttrpg-core'];
      if (plugin?.settings?.activeCampaign) {
        await this.campaignManager.loadAll(this.campaignsFolder);
        this.campaignManager.setActive(plugin.settings.activeCampaign);
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
    const newSessionBtn = actions.createEl("button", { text: "+ New session" });
    newSessionBtn.onclick = () => this.openNewNote("session");

    const combatBtn = actions.createEl("button", { text: "Combat tracker" });
    combatBtn.onclick = () => this.openCombat();

    const popoutBtn = actions.createEl("button", { text: "⤢ Pop out" });
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

    // Recent files
    const recentSection = container.createDiv("ttrpg-section");
    recentSection.createEl("h3", { text: "Recent activity" });
    const campaignFolder = `${this.campaignsFolder}/${campaignId}`;
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

  openSwitcher(): void {
    new CampaignSwitcherModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.campaignsFolder,
      (id) => this.switchTo(id),
      () => this.openCreate()
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
