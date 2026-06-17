import { App, TFile, parseYaml } from "obsidian";
import type { SystemSchema } from "../types";

export class SystemLoader {
  private app: App;
  private systems: Map<string, SystemSchema> = new Map();

  constructor(app: App) {
    this.app = app;
  }

  async loadAll(systemsFolder: string): Promise<void> {
    this.systems.clear();
    const folder = this.app.vault.getFolderByPath(systemsFolder);
    if (!folder) return;

    for (const child of folder.children) {
      if (child instanceof TFile && child.extension === "yaml") {
        await this.loadFile(child);
      }
    }
  }

  private async loadFile(file: TFile): Promise<void> {
    try {
      const content = await this.app.vault.read(file);
      const schema = parseYaml(content) as SystemSchema;
      if (schema?.id) {
        this.systems.set(schema.id, schema);
      }
    } catch (e) {
      console.error(`TTRPG: Failed to load system schema ${file.path}`, e);
    }
  }

  get(id: string): SystemSchema | undefined {
    return this.systems.get(id);
  }

  getAll(): SystemSchema[] {
    return Array.from(this.systems.values());
  }

  ids(): string[] {
    return Array.from(this.systems.keys());
  }
}
