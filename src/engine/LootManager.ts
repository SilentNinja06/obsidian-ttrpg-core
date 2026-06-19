import { App, TFile, stringifyYaml, normalizePath, Notice } from "obsidian";
import type { CampaignManager } from "./CampaignManager";
import type { SystemLoader } from "./SystemLoader";
import { readNote, writeSection, readSection } from "../utils/fileIO";

export class LootManager {
  private app: App;
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;

  constructor(app: App, campaignManager: CampaignManager, systemLoader: SystemLoader, campaignsFolder: string) {
    this.app = app;
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
  }

  private campaignFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}`;
  }

  /** List party PC names (basenames). */
  partyMembers(): string[] {
    const folder = `${this.campaignFolder()}/characters/pcs`;
    return this.app.vault.getMarkdownFiles()
      .filter((f) => f.path.startsWith(folder))
      .map((f) => f.basename);
  }

  /** Currency keys/labels from the active system schema. */
  currencyKeys(): { key: string; label: string }[] {
    const campaign = this.campaignManager.getActive();
    if (!campaign) return [];
    const currency = this.systemLoader.get(campaign.system)?.currency ?? [];
    return currency.map((c) => ({ key: c.key, label: c.label }));
  }

  /**
   * Promote a piece of loot to a real item note with held-by set.
   * holder = PC name, or "" / "Party stash" for unassigned-to-stash.
   * If the loot came from a session bullet, removes that bullet.
   */
  async assignLoot(
    itemName: string,
    holder: string,
    sourceSessionPath?: string
  ): Promise<TFile | null> {
    const campaignId = this.campaignManager.getActiveId();
    const campaign = this.campaignManager.getActive();
    if (!campaignId || !campaign) return null;

    // Decide folder: held items go to inventory/personal, stash to inventory/party
    const toStash = !holder || holder === "Party stash";
    const subfolder = toStash ? "inventory/party" : "inventory/personal";
    const folder = `${this.campaignFolder()}/${subfolder}`;
    if (!this.app.vault.getFolderByPath(normalizePath(folder))) {
      await this.app.vault.createFolder(normalizePath(folder)).catch(() => {});
    }

    const slug = itemName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    let path = `${folder}/${slug}.md`;

    // If an item note already exists, just update held-by
    const existing = this.app.vault.getFileByPath(path);
    if (existing instanceof TFile) {
      const { fm, body } = await readNote(this.app, existing);
      // Refuse to reassign destroyed/lost items
      if (!this.isAssignable(fm)) {
        new Notice(`${itemName} is ${fm["item-state"]} and can't be reassigned.`);
        return existing;
      }
      fm["held-by"] = toStash ? "" : holder;
      fm.status = toStash ? "unassigned" : "assigned";
      fm["item-state"] = toStash ? "unassigned" : "held";
      await this.app.vault.modify(existing, `---\n${stringifyYaml(fm)}---\n${body}`);
    } else {
      const fm: Record<string, unknown> = {
        "ttrpg-type": "item",
        system: campaign.system,
        campaign: campaignId,
        status: toStash ? "unassigned" : "assigned",
        "item-state": toStash ? "unassigned" : "held",
        "held-by": toStash ? "" : holder,
        equipped: false,
        rarity: "common",
        tags: ["item"],
      };
      const body = [
        `# ⚗️ ${itemName}`,
        "",
        "## Description",
        "_What it looks like and what it does._",
        "",
        "## Mechanics",
        "_Stats, bonuses, charges, attunement._",
        "",
        "## History",
        "_Where it came from._",
      ].join("\n");
      const file = await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n${body}`);
      path = file.path;
    }

    // Remove the originating session bullet if provided
    if (sourceSessionPath) {
      await this.removeLootBullet(sourceSessionPath, itemName);
    }

    return this.app.vault.getFileByPath(path);
  }

  /** Remove a loot bullet (by text match) from a session note's Loot section. */
  async removeLootBullet(sessionPath: string, itemName: string): Promise<void> {
    const file = this.app.vault.getFileByPath(sessionPath);
    if (!(file instanceof TFile)) return;
    const { fm, body } = await readNote(this.app, file);
    const section = readSection(body, "Loot (unassigned)");
    const kept = section
      .split("\n")
      .filter((l) => {
        const t = l.replace(/^-\s*/, "").trim();
        return t && t !== itemName;
      });
    const newBody = writeSection(body, "Loot (unassigned)", kept.join("\n"));
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${newBody}`);
  }

  /**
   * Distribute currency. mode = "split" | "stash" | "person".
   * Writes to the party stash note or a person's sheet frontmatter.
   */
  async distributeCurrency(
    currencyKey: string,
    amount: number,
    mode: "split" | "stash" | "person",
    person?: string
  ): Promise<string> {
    const members = this.partyMembers();

    if (mode === "split") {
      if (members.length === 0) return "No party members to split among.";
      const each = Math.floor(amount / members.length);
      const remainder = amount % members.length;
      for (const m of members) {
        await this.addCurrencyToSheet(m, currencyKey, each);
      }
      let msg = `Split ${amount} ${currencyKey}: ${each} each to ${members.length} members`;
      if (remainder > 0) msg += ` (${remainder} ${currencyKey} remainder to stash)`;
      if (remainder > 0) await this.addCurrencyToStash(currencyKey, remainder);
      return msg;
    } else if (mode === "person" && person) {
      await this.addCurrencyToSheet(person, currencyKey, amount);
      return `Gave ${amount} ${currencyKey} to ${person}`;
    } else {
      await this.addCurrencyToStash(currencyKey, amount);
      return `Added ${amount} ${currencyKey} to party stash`;
    }
  }

  private async addCurrencyToSheet(pcName: string, key: string, amount: number): Promise<void> {
    const folder = `${this.campaignFolder()}/characters/pcs`;
    const file = this.app.vault.getMarkdownFiles().find(
      (f) => f.path.startsWith(folder) && f.basename === pcName
    );
    if (!file) return;
    const { fm, body } = await readNote(this.app, file);
    const cur = typeof fm[key] === "number" ? (fm[key] as number) : 0;
    fm[key] = cur + amount;
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${body}`);
  }

  /** All item notes held by a given character (by held-by name). Reads fresh from disk. */
  async itemsHeldBy(pcName: string): Promise<{ file: TFile; fm: Record<string, unknown> }[]> {
    const folder = `${this.campaignFolder()}/inventory`;
    const candidates = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));
    const result: { file: TFile; fm: Record<string, unknown> }[] = [];
    for (const f of candidates) {
      const { fm } = await readNote(this.app, f);
      if (fm?.["ttrpg-type"] === "item" && fm?.["held-by"] === pcName) {
        result.push({ file: f, fm });
      }
    }
    return result;
  }

  async setEquipped(file: TFile, equipped: boolean): Promise<void> {
    const { fm, body } = await readNote(this.app, file);
    fm.equipped = equipped;
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${body}`);
  }

  async setQuantity(file: TFile, qty: number): Promise<void> {
    const { fm, body } = await readNote(this.app, file);
    fm.quantity = qty;
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${body}`);
  }

  async unassignItem(file: TFile): Promise<void> {
    const { fm, body } = await readNote(this.app, file);
    const state = (fm["item-state"] as string) || "held";
    // Only normal-state items revert to unassigned. Destroyed/lost/stolen/stashed
    // keep their lifecycle state when they leave an inventory.
    if (state === "held" || state === "damaged" || state === "unassigned" || !state) {
      fm["held-by"] = "";
      fm.status = "unassigned";
      fm["item-state"] = "unassigned";
      fm.equipped = false;
    } else {
      // honor the special state, just remove equipped flag
      fm.equipped = false;
    }
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${body}`);
  }

  /**
   * Quick-add an item directly to a character. If promote is false, creates a
   * minimal item note; if true, creates a full-bodied note. Either way held-by is set.
   */
  async quickAddItem(pcName: string, itemName: string, promote: boolean): Promise<TFile | null> {
    const campaignId = this.campaignManager.getActiveId();
    const campaign = this.campaignManager.getActive();
    if (!campaignId || !campaign) return null;

    const folder = `${this.campaignFolder()}/inventory/personal`;
    if (!this.app.vault.getFolderByPath(normalizePath(folder))) {
      await this.app.vault.createFolder(normalizePath(folder)).catch(() => {});
    }
    const slug = itemName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    const path = `${folder}/${slug}.md`;
    if (this.app.vault.getFileByPath(path)) {
      // Already exists — just reassign
      const existing = this.app.vault.getFileByPath(path) as TFile;
      const { fm, body } = await readNote(this.app, existing);
      fm["held-by"] = pcName;
      fm.status = "assigned";
      await this.app.vault.modify(existing, `---\n${stringifyYaml(fm)}---\n${body}`);
      return existing;
    }

    const fm: Record<string, unknown> = {
      "ttrpg-type": "item",
      system: campaign.system,
      campaign: campaignId,
      status: "assigned",
      "held-by": pcName,
      equipped: false,
      quantity: 1,
      rarity: "common",
      tags: ["item"],
    };
    const body = promote
      ? [`# ⚗️ ${itemName}`, "", "## Description", "_What it looks like and does._", "", "## Mechanics", "_Stats, bonuses, charges._", "", "## History", "_Where it came from._"].join("\n")
      : `# ⚗️ ${itemName}`;
    return await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n${body}`);
  }

  /** Change an item's lifecycle state, applying state-dependent rules and logging. */
  async setItemState(
    file: TFile,
    state: string,
    extra: { location?: string; stolenBy?: string; note?: string } = {}
  ): Promise<void> {
    const { fm, body } = await readNote(this.app, file);
    const prev = (fm["item-state"] as string) || (fm.status as string) || "unassigned";

    fm["item-state"] = state;

    // State-dependent field handling
    if (state === "destroyed") {
      fm["held-by"] = "";       // destroyed clears the holder
      fm.equipped = false;
      fm.status = "destroyed";
    } else if (state === "lost") {
      // keep held-by; mark not equipped
      fm.equipped = false;
      fm.status = "lost";
    } else if (state === "stashed") {
      fm["stash-location"] = extra.location ?? fm["stash-location"] ?? "";
      fm.equipped = false;
      fm.status = "stashed";
    } else if (state === "stolen") {
      fm["stolen-by"] = extra.stolenBy ?? fm["stolen-by"] ?? "";
      fm.equipped = false;
      fm.status = "stolen";
    } else if (state === "hidden") {
      fm["held-by"] = "";
      fm.equipped = false;
      fm.status = "hidden";
    } else if (state === "held") {
      fm.status = "assigned";
    } else if (state === "unassigned") {
      fm["held-by"] = "";
      fm.equipped = false;
      fm.status = "unassigned";
    } else if (state === "custom") {
      fm["state-note"] = extra.note ?? fm["state-note"] ?? "";
    }

    // Destroyed clears the damaged flag (it's gone); other states keep it.
    if (state === "destroyed") fm.damaged = false;

    let detail = "";
    if (state === "stashed" && extra.location) detail = ` @ ${extra.location}`;
    if (state === "stolen" && extra.stolenBy) detail = ` by ${extra.stolenBy}`;
    if (state === "custom" && extra.note) detail = `: ${extra.note}`;

    const newBody = this.appendStateLog(body, `${prev} → ${state}${detail}`);
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${newBody}`);
  }

  /** Recover a stolen/lost/stashed item back to Held (if held-by) or Unassigned. */
  async recoverItem(file: TFile): Promise<void> {
    const { fm } = await readNote(this.app, file);
    const held = (fm["held-by"] as string) || "";
    await this.setItemState(file, held ? "held" : "unassigned");
  }

  /** Set or clear the damaged flag — independent of lifecycle state (except destroyed). */
  async setDamaged(file: TFile, damaged: boolean): Promise<void> {
    const { fm, body } = await readNote(this.app, file);
    if ((fm["item-state"] as string) === "destroyed") return; // can't damage/repair a destroyed item
    fm.damaged = damaged;
    const newBody = this.appendStateLog(body, damaged ? "marked damaged" : "repaired");
    await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${newBody}`);
  }

  /** Repair a damaged item (clears the damaged flag). */
  async repairItem(file: TFile): Promise<void> {
    await this.setDamaged(file, false);
  }

  /** True if an item can be assigned/held (not destroyed or lost). */
  isAssignable(fm: Record<string, unknown>): boolean {
    const state = (fm["item-state"] as string) || "";
    return state !== "destroyed" && state !== "lost";
  }

  private appendStateLog(body: string, line: string): string {
    const stamp = new Date().toLocaleString();
    const entry = `- ${stamp} — ${line}`;
    const existing = readSection(body, "State log");
    const prior = existing.split("\n").filter((l) => l.trim().startsWith("-")).join("\n");
    const merged = prior ? `${prior}\n${entry}` : entry;
    return writeSection(body, "State log", merged);
  }

  private async addCurrencyToStash(key: string, amount: number): Promise<void> {
    const folder = `${this.campaignFolder()}/inventory/party`;
    if (!this.app.vault.getFolderByPath(normalizePath(folder))) {
      await this.app.vault.createFolder(normalizePath(folder)).catch(() => {});
    }
    const path = `${folder}/party-stash.md`;
    let file = this.app.vault.getFileByPath(path);
    if (!(file instanceof TFile)) {
      const fm: Record<string, unknown> = {
        "ttrpg-type": "item",
        campaign: this.campaignManager.getActiveId(),
        status: "stash",
        tags: ["stash"],
      };
      file = await this.app.vault.create(path, `---\n${stringifyYaml(fm)}---\n\n# 💰 Party Stash\n`);
    }
    const { fm, body } = await readNote(this.app, file as TFile);
    const cur = typeof fm[key] === "number" ? (fm[key] as number) : 0;
    fm[key] = cur + amount;
    await this.app.vault.modify(file as TFile, `---\n${stringifyYaml(fm)}---\n${body}`);
  }
}
