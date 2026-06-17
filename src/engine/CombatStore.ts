import { App, TFile, normalizePath } from "obsidian";
import type { Combatant } from "../types";

export interface CombatState {
  round: number;
  activeIdx: number;
  combatants: Combatant[];
  log: string[];
  savedAt: string;
}

/**
 * Persists combat state to JSON files in the campaign's combat folder.
 * - Current state autosaves to combat/_current.json
 * - Named encounters save to combat/encounters/<name>.json
 */
export class CombatStore {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  private currentPath(campaignFolder: string): string {
    return normalizePath(`${campaignFolder}/combat/_current.json`);
  }

  private encounterPath(campaignFolder: string, name: string): string {
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    return normalizePath(`${campaignFolder}/combat/encounters/${slug}.json`);
  }

  async saveCurrent(campaignFolder: string, state: CombatState): Promise<void> {
    await this.writeJson(this.currentPath(campaignFolder), state);
  }

  async loadCurrent(campaignFolder: string): Promise<CombatState | null> {
    return this.readJson(this.currentPath(campaignFolder));
  }

  async saveEncounter(campaignFolder: string, name: string, state: CombatState): Promise<void> {
    await this.writeJson(this.encounterPath(campaignFolder, name), state);
  }

  async loadEncounter(campaignFolder: string, name: string): Promise<CombatState | null> {
    return this.readJson(this.encounterPath(campaignFolder, name));
  }

  async listEncounters(campaignFolder: string): Promise<string[]> {
    const folder = this.app.vault.getFolderByPath(
      normalizePath(`${campaignFolder}/combat/encounters`)
    );
    if (!folder) return [];
    return folder.children
      .filter((f): f is TFile => f instanceof TFile && f.extension === "json")
      .map((f) => f.basename);
  }

  private async writeJson(path: string, data: unknown): Promise<void> {
    const content = JSON.stringify(data, null, 2);
    const existing = this.app.vault.getFileByPath(path);
    if (existing) {
      await this.app.vault.modify(existing, content);
    } else {
      // Ensure parent folder exists
      const parent = path.substring(0, path.lastIndexOf("/"));
      if (!this.app.vault.getFolderByPath(parent)) {
        await this.app.vault.createFolder(parent).catch(() => {});
      }
      await this.app.vault.create(path, content);
    }
  }

  private async readJson(path: string): Promise<any | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file) return null;
    try {
      const content = await this.app.vault.read(file);
      return JSON.parse(content);
    } catch {
      return null;
    }
  }

  /**
   * Pull party PCs from the campaign's characters/pcs folder and build
   * combatants from their frontmatter.
   */
  async loadPartyPCs(campaignFolder: string, hpKeys: { current: string; max: string } | undefined): Promise<Combatant[]> {
    const pcsFolder = this.app.vault.getFolderByPath(
      normalizePath(`${campaignFolder}/characters/pcs`)
    );
    if (!pcsFolder) return [];

    const combatants: Combatant[] = [];
    for (const child of pcsFolder.children) {
      if (!(child instanceof TFile) || child.extension !== "md") continue;
      const cache = this.app.metadataCache.getFileCache(child);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const hpCur = hpKeys ? (fm[hpKeys.current] as number) ?? 0 : 0;
      const hpMax = hpKeys ? (fm[hpKeys.max] as number) ?? hpCur : hpCur;
      combatants.push({
        id: Date.now() + Math.floor(Math.random() * 1000),
        name: child.basename,
        type: "pc",
        init: 0,
        hp: hpCur || hpMax,
        hpMax: hpMax || 10,
        conditions: (fm.conditions as string[]) ?? [],
        dead: false,
        filePath: child.path,
      });
    }
    return combatants;
  }
}
