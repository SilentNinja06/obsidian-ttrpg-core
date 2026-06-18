import { App, FuzzySuggestModal, TFile, FuzzyMatch, Notice } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";

interface CharEntry {
  file: TFile;
  name: string;
  isPC: boolean;
  hpCur: number;
  hpMax: number;
}

/**
 * Pick an existing character note (PC or NPC) to add to combat,
 * choosing fresh (max) or last-known (current) HP.
 */
export class AddExistingModal extends FuzzySuggestModal<CharEntry> {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;
  private onPick: (file: TFile, name: string, hp: number, isPC: boolean) => void;
  private entries: CharEntry[] = [];
  private useFreshHp = false;

  constructor(
    app: App,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string,
    onPick: (file: TFile, name: string, hp: number, isPC: boolean) => void
  ) {
    super(app);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
    this.onPick = onPick;
    this.setPlaceholder("Add existing character to combat… (Tab toggles fresh/last-known HP)");
    this.buildIndex();

    // Tab toggles HP mode
    this.scope.register([], "Tab", (e) => {
      e.preventDefault();
      this.useFreshHp = !this.useFreshHp;
      this.updateInstructions();
      return false;
    });
    this.updateInstructions();
  }

  private updateInstructions(): void {
    this.setInstructions([
      { command: "↵", purpose: "add to combat" },
      { command: "Tab", purpose: `HP mode: ${this.useFreshHp ? "FRESH (max)" : "last-known"}` },
    ]);
  }

  private buildIndex(): void {
    const id = this.campaignManager.getActiveId();
    if (!id) return;
    const folder = `${this.campaignsFolder}/${id}/characters`;
    const campaign = this.campaignManager.getActive();
    const hpKeys = campaign ? this.systemLoader.get(campaign.system)?.entities?.character?.hp : undefined;

    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (fm?.["ttrpg-type"] !== "character") continue;
      const tags = (fm.tags as string[]) ?? [];
      const isPC = tags.includes("pc") || file.path.includes("/pcs/");
      const hpCur = hpKeys ? (fm[hpKeys.current] as number) ?? 0 : 0;
      const hpMax = hpKeys ? (fm[hpKeys.max] as number) ?? hpCur : hpCur;
      this.entries.push({ file, name: file.basename, isPC, hpCur, hpMax });
    }
    this.entries.sort((a, b) => a.name.localeCompare(b.name));
  }

  getItems(): CharEntry[] { return this.entries; }
  getItemText(e: CharEntry): string { return e.name; }

  renderSuggestion(match: FuzzyMatch<CharEntry>, el: HTMLElement): void {
    const e = match.item;
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 4px";
    el.createSpan({ text: e.isPC ? "🛡️" : "👤" });
    const wrap = el.createDiv();
    wrap.style.cssText = "flex:1";
    wrap.createDiv({ text: e.name }).style.cssText = "font-size:14px;color:var(--text-normal)";
    wrap.createDiv({ text: `${e.isPC ? "PC" : "NPC"} · ${e.hpCur}/${e.hpMax} HP` }).style.cssText = "font-size:12px;color:var(--text-muted)";
  }

  onChooseItem(e: CharEntry): void {
    const hp = this.useFreshHp ? e.hpMax : e.hpCur;
    this.onPick(e.file, e.name, hp || e.hpMax || 10, e.isPC);
  }
}
