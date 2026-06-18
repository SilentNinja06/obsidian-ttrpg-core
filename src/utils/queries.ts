import { App, TFile } from "obsidian";
import { readNote, readSection } from "./fileIO";

export interface ThreadItem {
  text: string;
  sessionName: string;
  sessionPath: string;
}

export interface LootItem {
  name: string;
  source: string;       // session name or inventory note name
  sourcePath: string;
  fromInventory: boolean;
}

export interface BacklinkItem {
  name: string;
  path: string;
  type: string;         // ttrpg-type of the linking note
}

/**
 * Scan all session notes in a campaign and collect every bullet under the
 * "Loose threads" heading, tagged with which session it came from.
 */
export async function collectOpenThreads(
  app: App,
  campaignFolder: string
): Promise<ThreadItem[]> {
  const sessionsFolder = `${campaignFolder}/sessions`;
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(sessionsFolder));
  const threads: ThreadItem[] = [];

  for (const file of files) {
    const { body } = await readNote(app, file);
    const section = readSection(body, "Loose threads");
    if (!section.trim()) continue;
    const lines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      // Skip the placeholder italic stub
      .filter((l) => !l.startsWith("_") && !l.startsWith("<!--"));

    for (const line of lines) {
      threads.push({ text: line, sessionName: file.basename, sessionPath: file.path });
    }
  }
  return threads;
}

/**
 * Collect unassigned loot from BOTH:
 *  - inventory notes with status: unassigned in frontmatter
 *  - "Loot (unassigned)" bullets in session notes
 */
export async function collectUnassignedLoot(
  app: App,
  campaignFolder: string
): Promise<LootItem[]> {
  const loot: LootItem[] = [];

  // 1. Inventory notes with status: unassigned
  const invFolder = `${campaignFolder}/inventory`;
  const invFiles = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(invFolder));
  for (const file of invFiles) {
    const cache = app.metadataCache.getFileCache(file);
    const fm = cache?.frontmatter;
    if (fm && fm["ttrpg-type"] === "item" && fm.status === "unassigned") {
      loot.push({ name: file.basename, source: file.basename, sourcePath: file.path, fromInventory: true });
    }
  }

  // 2. Session note loot bullets
  const sessFolder = `${campaignFolder}/sessions`;
  const sessFiles = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(sessFolder));
  for (const file of sessFiles) {
    const { body } = await readNote(app, file);
    const section = readSection(body, "Loot (unassigned)");
    if (!section.trim()) continue;
    const lines = section
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("-"))
      .map((l) => l.replace(/^-\s*/, "").trim())
      .filter(Boolean)
      .filter((l) => !l.startsWith("_") && !l.startsWith("<!--"))
      // A bullet that already shows an assignment ("→ Kira") is no longer unassigned
      .filter((l) => !/→\s*\S+/.test(l) || /unassigned/i.test(l));

    for (const line of lines) {
      loot.push({ name: line, source: file.basename, sourcePath: file.path, fromInventory: false });
    }
  }

  return loot;
}

/**
 * Find every note that links to the given target file via [[wikilinks]],
 * returning their name, path, and ttrpg-type. Split into session appearances
 * vs other connections by the caller.
 */
export function collectBacklinks(app: App, target: TFile): BacklinkItem[] {
  const results: BacklinkItem[] = [];
  // @ts-ignore — resolvedLinks is { sourcePath: { targetPath: count } }
  const resolved = app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;

  for (const [sourcePath, links] of Object.entries(resolved)) {
    if (links[target.path]) {
      const sourceFile = app.vault.getFileByPath(sourcePath);
      if (!(sourceFile instanceof TFile)) continue;
      const cache = app.metadataCache.getFileCache(sourceFile);
      const type = (cache?.frontmatter?.["ttrpg-type"] as string) ?? "note";
      results.push({ name: sourceFile.basename, path: sourcePath, type });
    }
  }
  return results;
}
