import { App, TFile, stringifyYaml, parseYaml } from "obsidian";

export async function readFrontmatter(app: App, file: TFile): Promise<Record<string, unknown>> {
  const content = await app.vault.read(file);
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  try { return (parseYaml(match[1]) as Record<string, unknown>) ?? {}; }
  catch { return {}; }
}

export async function readBody(app: App, file: TFile): Promise<string> {
  const content = await app.vault.read(file);
  return content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
}

export async function writeFrontmatter(
  app: App,
  file: TFile,
  fm: Record<string, unknown>
): Promise<void> {
  const content = await app.vault.read(file);
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const newContent = `---\n${stringifyYaml(fm)}---\n\n${body}`;
  await app.vault.modify(file, newContent);
}

export async function writeFrontmatterKey(
  app: App,
  file: TFile,
  key: string,
  value: unknown
): Promise<void> {
  const fm = await readFrontmatter(app, file);
  fm[key] = value;
  await writeFrontmatter(app, file, fm);
}

export async function writeBody(
  app: App,
  file: TFile,
  section: string,
  value: string
): Promise<void> {
  const content = await app.vault.read(file);
  const fmMatch = content.match(/^---\n[\s\S]*?\n---\n?/);
  const fmBlock = fmMatch ? fmMatch[0] : "";
  const body = content.replace(/^---\n[\s\S]*?\n---\n?/, "");

  const sectionRegex = new RegExp(
    `(## ${section}\\n)([\\s\\S]*?)(?=\\n## |$)`,
    "m"
  );
  const newBody = body.replace(sectionRegex, `$1${value}\n`);
  await app.vault.modify(file, fmBlock + newBody);
}

export function parseBodySections(body: string): Record<string, string> {
  const sections: Record<string, string> = {};
  const parts = body.split(/^## /m);
  for (const part of parts) {
    if (!part.trim()) continue;
    const lines = part.split("\n");
    const title = lines[0].trim();
    const content = lines
      .slice(1)
      .join("\n")
      .replace(/^_.*_\n?/gm, "") // strip placeholder italics
      .trim();
    sections[title] = content;
  }
  return sections;
}
