import { App, stringifyYaml } from "obsidian";
import type { NoteType, SystemSchema, CampaignConfig } from "../types";

const FOLDER_MAP: Record<NoteType, string> = {
  character: "characters/npcs",
  location: "lore/places",
  faction: "lore/factions",
  session: "sessions",
  history: "lore/history",
  item: "inventory/party",
};

const ICON_MAP: Record<NoteType, string> = {
  character: "👤",
  location: "🏰",
  faction: "⚔️",
  session: "📋",
  history: "📜",
  item: "⚗️",
};

export class TemplateEngine {
  private app: App;

  constructor(app: App) {
    this.app = app;
  }

  folderFor(type: NoteType, campaignFolder: string, isPC = false): string {
    if (type === "character" && isPC) {
      return `${campaignFolder}/characters/pcs`;
    }
    return `${campaignFolder}/${FOLDER_MAP[type]}`;
  }

  buildFrontmatter(
    type: NoteType,
    name: string,
    campaignId: string,
    system: SystemSchema,
    extra: Record<string, unknown> = {}
  ): string {
    const base: Record<string, unknown> = {
      "ttrpg-type": type,
      system: system.id,
      campaign: campaignId,
      status: "active",
      tags: [type],
      "session-appearances": [],
    };

    if (type === "character") {
      const hpKeys = system.entities?.character?.hp;
      if (hpKeys) {
        base[hpKeys.current] = 0;
        base[hpKeys.max] = 0;
      }
      if (system.entities?.character?.stats) {
        for (const stat of system.entities.character.stats) {
          base[stat.key] = 0;
        }
      }
      base.conditions = [];
      base.relationships = [];
      base.player = "";
    }

    if (type === "session") {
      base["session-number"] = "01";
      base.date = new Date().toISOString().split("T")[0];
      base["duration-hours"] = 0;
      base["players-present"] = [];
      base["xp-gained"] = 0;
      base.status = "draft";
      delete base["session-appearances"];
    }

    if (type === "item") {
      base.status = "unassigned";
      base["held-by"] = "";
      base.rarity = "common";
    }

    Object.assign(base, extra);

    return `---\n${stringifyYaml(base)}---\n`;
  }

  buildBody(type: NoteType, name: string, system: SystemSchema): string {
    const icon = ICON_MAP[type];
    const headings: Record<NoteType, string[]> = {
      character: [
        `# ${icon} ${name}`,
        "",
        "## Core stats",
        "_Stat block rendered by the plugin from system schema._",
        "",
        "## Skills & abilities",
        "_List key skills and class or unit features._",
        "",
        "## Backstory",
        "_Where they came from and what shaped them._",
        "",
        "## Motivation",
        "_What drives them right now._",
        "",
        "## Secret",
        "_What they haven't told anyone._",
        "",
        "## Current goal",
        "_The thing they are actively pursuing._",
        "",
        "## Notes",
        "_Freeform session observations and arc developments._",
      ],
      location: [
        `# ${icon} ${name}`,
        "",
        "## Overview",
        "_One paragraph: what is this place and why does it matter._",
        "",
        "## Details",
        "_Region, type, notable features, who controls it._",
        "",
        "## Sub-locations",
        "_[[Sub-location 1]], [[Sub-location 2]]_",
        "",
        "## History",
        "_Key events tied to this place, oldest first._",
        "",
        "## Connected characters",
        "_[[Character]] — role or relationship to this place._",
        "",
        "## Notes",
        "_Atmosphere, DM observations, player impressions._",
      ],
      faction: [
        `# ${icon} ${name}`,
        "",
        "## Overview",
        "_What is this faction and what role do they play._",
        "",
        "## Goals",
        "_What they want, short and long term._",
        "",
        "## Resources",
        "_What power, wealth, or influence they command._",
        "",
        "## Leadership",
        "_[[Leader]], [[Second]], key figures._",
        "",
        "## Relationships",
        "_[[Allied Faction]] — ally / [[Enemy Faction]] — rival._",
        "",
        "## Notes",
        "_Internal tensions, secrets, DM notes._",
      ],
      session: [
        `# ${icon} ${name}`,
        "",
        "## What happened",
        "_Bullet points during play, prose write-up after._",
        "",
        "## Decisions",
        "_What the party decided and why._",
        "",
        "## NPCs encountered",
        "_[[NPC]] — brief note on the interaction._",
        "",
        "## Loot (unassigned)",
        "_Item — unassigned until distributed._",
        "",
        "## Loose threads",
        "_Unresolved hooks, open questions, things to follow up._",
        "",
        "## Quotes & moments",
        "_The stuff worth remembering._",
        "",
        "## XP & milestones",
        "_XP gained this session and running total._",
      ],
      history: [
        `# ${icon} ${name}`,
        "",
        "## What happened",
        "_The event itself — be specific about cause and outcome._",
        "",
        "## Why it matters",
        "_How this event shapes the present campaign._",
        "",
        "## Parties involved",
        "_[[Character or faction]] — their role in the event._",
        "",
        "## Consequences",
        "_What changed as a result._",
        "",
        "## Notes",
        "_Disputed accounts, unreliable narrators, DM secrets._",
      ],
      item: [
        `# ${icon} ${name}`,
        "",
        "## Description",
        "_What it looks like and what it does._",
        "",
        "## Mechanics",
        "_Stats, bonuses, charges, attunement requirements._",
        "",
        "## History",
        "_Where it came from, who made it, why it exists._",
        "",
        "## Notes",
        "_DM notes, player theories, unresolved questions._",
      ],
    };

    return headings[type].join("\n");
  }

  async createNote(
    type: NoteType,
    name: string,
    campaignFolder: string,
    campaignId: string,
    system: SystemSchema,
    isPC = false
  ): Promise<string> {
    const folder = this.folderFor(type, campaignFolder, isPC);
    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    const path = `${folder}/${slug}.md`;

    const frontmatter = this.buildFrontmatter(type, name, campaignId, system);
    const body = this.buildBody(type, name, system);
    const content = frontmatter + "\n" + body;

    await this.app.vault.create(path, content);
    return path;
  }
}
