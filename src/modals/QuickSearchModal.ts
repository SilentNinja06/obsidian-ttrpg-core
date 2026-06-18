import { App, FuzzySuggestModal, TFile, FuzzyMatch } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";

interface SearchEntry {
  file: TFile;
  name: string;
  type: string;
  subtitle: string;
}

const TYPE_ICONS: Record<string, string> = {
  character: "👤",
  location: "🏰",
  faction: "⚔️",
  session: "📋",
  history: "📜",
  item: "⚗️",
};

/**
 * Campaign-scoped fuzzy search. Indexes all TTRPG notes in the active
 * campaign and jumps to the chosen one.
 */
export class QuickSearchModal extends FuzzySuggestModal<SearchEntry> {
  private campaignManager: CampaignManager;
  private campaignsFolder: string;
  private entries: SearchEntry[] = [];

  constructor(app: App, campaignManager: CampaignManager, campaignsFolder: string) {
    super(app);
    this.campaignManager = campaignManager;
    this.campaignsFolder = campaignsFolder;
    this.setPlaceholder("Jump to a character, location, session…");
    this.buildIndex();
  }

  private buildIndex(): void {
    const id = this.campaignManager.getActiveId();
    if (!id) return;
    const folder = `${this.campaignsFolder}/${id}`;
    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));

    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const type = (fm?.["ttrpg-type"] as string) ?? "note";
      // Build a helpful subtitle from common fields
      const subParts: string[] = [];
      if (fm?.class) subParts.push(String(fm.class));
      if (fm?.level) subParts.push(`Lvl ${fm.level}`);
      if (fm?.region) subParts.push(String(fm.region));
      if (fm?.status && type !== "character") subParts.push(String(fm.status));
      const subtitle = subParts.join(" · ") || this.folderLabel(file.path, folder);

      this.entries.push({ file, name: file.basename, type, subtitle });
    }

    // Sort: characters and locations first, then by name
    const typeOrder = ["character", "location", "faction", "session", "history", "item", "note"];
    this.entries.sort((a, b) => {
      const ta = typeOrder.indexOf(a.type);
      const tb = typeOrder.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name);
    });
  }

  private folderLabel(path: string, root: string): string {
    const rel = path.slice(root.length + 1);
    const parts = rel.split("/");
    return parts.length > 1 ? parts[parts.length - 2] : "";
  }

  getItems(): SearchEntry[] {
    return this.entries;
  }

  getItemText(entry: SearchEntry): string {
    return `${entry.name} ${entry.type} ${entry.subtitle}`;
  }

  renderSuggestion(match: FuzzyMatch<SearchEntry>, el: HTMLElement): void {
    const entry = match.item;
    el.style.cssText = "display:flex;align-items:center;gap:10px;padding:6px 4px";
    const icon = el.createSpan({ text: TYPE_ICONS[entry.type] ?? "📄" });
    icon.style.fontSize = "16px";
    const textWrap = el.createDiv();
    textWrap.style.cssText = "display:flex;flex-direction:column;min-width:0";
    textWrap.createDiv({ text: entry.name }).style.cssText = "font-size:14px;color:var(--text-normal)";
    if (entry.subtitle) {
      textWrap.createDiv({ text: entry.subtitle }).style.cssText = "font-size:12px;color:var(--text-muted)";
    }
    const typeTag = el.createSpan({ text: entry.type });
    typeTag.style.cssText = "margin-left:auto;font-size:11px;padding:1px 7px;border-radius:8px;background:var(--background-secondary);color:var(--text-muted)";
  }

  onChooseItem(entry: SearchEntry): void {
    this.app.workspace.getLeaf(false).openFile(entry.file);
  }
}
