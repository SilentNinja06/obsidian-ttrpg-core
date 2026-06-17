import { App, TFile, parseYaml, stringifyYaml } from "obsidian";
import type { CampaignConfig } from "../types";

export class CampaignManager {
  private app: App;
  private campaigns: Map<string, CampaignConfig> = new Map();
  private activeCampaignId: string = "";

  constructor(app: App) {
    this.app = app;
  }

  async loadAll(campaignsFolder: string): Promise<void> {
    this.campaigns.clear();
    const folder = this.app.vault.getFolderByPath(campaignsFolder);
    if (!folder) return;

    for (const child of folder.children) {
      if ("children" in child) {
        const subfolder = child as { name: string; children: unknown[] };
        const configFile = subfolder.children.find(
          (f) => f instanceof TFile && f.name === "campaign.yaml"
        ) as TFile | undefined;
        if (configFile) {
          await this.loadCampaign(subfolder.name, configFile);
        }
      }
    }
  }

  private async loadCampaign(id: string, file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const config = parseYaml(content) as CampaignConfig;
      this.campaigns.set(id, config);
    } catch (e) {
      console.error(`TTRPG: Failed to load campaign ${id}`, e);
    }
  }

  setActive(id: string): void {
    this.activeCampaignId = id;
  }

  getActive(): CampaignConfig | undefined {
    return this.campaigns.get(this.activeCampaignId);
  }

  getActiveId(): string {
    return this.activeCampaignId;
  }

  getAll(): Map<string, CampaignConfig> {
    return this.campaigns;
  }

  getCampaignFolder(campaignsFolder: string): string {
    return `${campaignsFolder}/${this.activeCampaignId}`;
  }

  async createCampaign(
    campaignsFolder: string,
    id: string,
    config: CampaignConfig
  ): Promise<void> {
    const folder = `${campaignsFolder}/${id}`;
    const subfolders = [
      "lore/factions",
      "lore/places",
      "lore/history",
      "characters/pcs",
      "characters/npcs",
      "characters/arcs",
      "inventory/party",
      "inventory/personal",
      "inventory/artifacts",
      "sessions",
      "combat/encounters",
      "combat/logs",
    ];

    for (const sub of subfolders) {
      await this.app.vault.createFolder(`${folder}/${sub}`).catch(() => {});
    }

    await this.app.vault.create(
      `${folder}/campaign.yaml`,
      stringifyYaml(config)
    );

    this.campaigns.set(id, config);
  }
}
