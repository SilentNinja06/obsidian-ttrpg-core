import { App, TFile, parseYaml, stringifyYaml } from "obsidian";

/**
 * Read frontmatter and body from a markdown file.
 * Returns { fm: Record, body: string }
 */
export async function readNote(app: App, file: TFile): Promise<{
  fm: Record<string, unknown>;
  body: string;
}> {
  const raw = await app.vault.read(file);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!match) return { fm: {}, body: raw };
  let fm: Record<string, unknown> = {};
  try { fm = parseYaml(match[1]) ?? {}; } catch {}
  return { fm, body: match[2] ?? "" };
}

/**
 * Write updated frontmatter back to a file, preserving the body.
 */
export async function writeFrontmatter(
  app: App,
  file: TFile,
  fm: Record<string, unknown>
): Promise<void> {
  const raw = await app.vault.read(file);
  const match = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  const body = match ? (match[2] ?? "") : raw;
  const newContent = `---\n${stringifyYaml(fm)}---\n${body}`;
  await app.vault.modify(file, newContent);
}

/**
 * Write a single frontmatter key back to a file.
 */
export async function writeFrontmatterKey(
  app: App,
  file: TFile,
  key: string,
  value: unknown
): Promise<void> {
  const { fm, body } = await readNote(app, file);
  fm[key] = value;
  const newContent = `---\n${stringifyYaml(fm)}---\n${body}`;
  await app.vault.modify(file, newContent);
}

/**
 * Write multiple frontmatter keys in a single file operation.
 * Avoids the read-modify-write race that happens when calling
 * writeFrontmatterKey twice in a row.
 */
export async function writeFrontmatterKeys(
  app: App,
  file: TFile,
  updates: Record<string, unknown>
): Promise<void> {
  const { fm, body } = await readNote(app, file);
  for (const [k, v] of Object.entries(updates)) {
    fm[k] = v;
  }
  const newContent = `---\n${stringifyYaml(fm)}---\n${body}`;
  await app.vault.modify(file, newContent);
}

/**
 * Read a section of the markdown body by heading name.
 * Returns the content between this heading and the next same-level heading.
 */
export function readSection(body: string, heading: string): string {
  const lines = body.split("\n");
  let inSection = false;
  let headingLevel = 0;
  const result: string[] = [];

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (title.toLowerCase() === heading.toLowerCase()) {
        inSection = true;
        headingLevel = level;
        continue;
      }
      if (inSection && level <= headingLevel) {
        break;
      }
    }
    if (inSection) result.push(line);
  }

  return result.join("\n").trim();
}

/**
 * Write content into a section of the markdown body by heading name.
 * If the section doesn't exist, appends it.
 */
export function writeSection(body: string, heading: string, content: string): string {
  const lines = body.split("\n");
  let inSection = false;
  let headingLevel = 0;
  let sectionStart = -1;
  let sectionEnd = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      if (title.toLowerCase() === heading.toLowerCase()) {
        inSection = true;
        headingLevel = level;
        sectionStart = i + 1;
        continue;
      }
      if (inSection && level <= headingLevel) {
        sectionEnd = i;
        break;
      }
    }
  }

  if (sectionStart === -1) {
    // Section doesn't exist — append it
    return body.trimEnd() + `\n\n## ${heading}\n${content}\n`;
  }

  const end = sectionEnd === -1 ? lines.length : sectionEnd;
  const before = lines.slice(0, sectionStart);
  const after = lines.slice(end);
  const newLines = [...before, content, ...after];
  return newLines.join("\n");
}

/**
 * Write a section back to the file.
 */
export async function writeNoteSection(
  app: App,
  file: TFile,
  heading: string,
  content: string
): Promise<void> {
  const { fm, body } = await readNote(app, file);
  const newBody = writeSection(body, heading, content);
  const newContent = `---\n${stringifyYaml(fm)}---\n${newBody}`;
  await app.vault.modify(file, newContent);
}
