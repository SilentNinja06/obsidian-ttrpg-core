import { App, TFile } from "obsidian";
import { readNote, writeFrontmatterKey } from "./fileIO";

export interface ParsedRelationship {
  target: string;   // target note basename
  label: string;    // relationship label (ally, enemy, etc.) or ""
  raw: string;      // original string
}

export const RELATIONSHIP_LABELS = [
  "ally", "enemy", "family", "friend", "rival", "mentor", "contact",
  "member", "leader", "located-in", "owns", "knows", "wary-of",
];

/** Parse a stored relationship string like "[[Bob]] (ally)" into parts. */
export function parseRelationship(raw: string): ParsedRelationship {
  const linkMatch = raw.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
  const target = linkMatch ? linkMatch[1].trim() : raw.replace(/\(.*\)/, "").trim();
  const labelMatch = raw.match(/\(([^)]+)\)\s*$/);
  const label = labelMatch ? labelMatch[1].trim() : "";
  return { target, label, raw };
}

/** Format a relationship for storage as "[[Target]] (label)". */
export function formatRelationship(target: string, label: string): string {
  const base = `[[${target}]]`;
  return label ? `${base} (${label})` : base;
}

/** Sensible inverse for common relationship labels (for reciprocal links). */
export const INVERSE_LABELS: Record<string, string> = {
  ally: "ally",
  enemy: "enemy",
  family: "family",
  friend: "friend",
  rival: "rival",
  mentor: "student",
  student: "mentor",
  contact: "contact",
  knows: "knows",
  member: "leader",
  leader: "member",
  owns: "owned-by",
  "owned-by": "owns",
  "located-in": "contains",
  contains: "located-in",
  "wary-of": "wary-of",
};

export function inverseLabel(label: string): string {
  if (!label) return "";
  return INVERSE_LABELS[label] ?? label;
}

/**
 * Add a relationship entry to a target note's frontmatter relationships list,
 * pointing back at `fromName`. Used for reciprocal links. No-op if already present.
 */
export async function addReciprocal(
  app: App,
  targetFile: TFile,
  fromName: string,
  label: string
): Promise<void> {
  // Read fresh from disk (not the cache) so we don't clobber a recent write,
  // and use the same write path as every other relationship edit.
  const { fm } = await readNote(app, targetFile);
  const existing: string[] = Array.isArray(fm.relationships) ? [...(fm.relationships as string[])] : [];
  const already = existing.some((r) => {
    const m = r.match(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/);
    const t = m ? m[1].trim() : r.replace(/\(.*\)/, "").trim();
    return t.toLowerCase() === fromName.toLowerCase();
  });
  if (already) return;
  existing.push(formatRelationship(fromName, label));
  await writeFrontmatterKey(app, targetFile, "relationships", existing);
}

/** Resolve a note basename to a TFile within a campaign folder. */
export function resolveByName(app: App, name: string, campaignFolder: string): TFile | null {
  const clean = name.trim().toLowerCase();
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(campaignFolder));
  return files.find((f) => f.basename.toLowerCase() === clean) ?? null;
}

/** All linkable entities (characters, factions, locations, items) in a campaign. */
export function linkableEntities(app: App, campaignFolder: string): { file: TFile; name: string; type: string }[] {
  const files = app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(campaignFolder));
  const out: { file: TFile; name: string; type: string }[] = [];
  for (const f of files) {
    const type = app.metadataCache.getFileCache(f)?.frontmatter?.["ttrpg-type"] as string;
    if (["character", "faction", "location", "history", "item"].includes(type)) {
      out.push({ file: f, name: f.basename, type });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
