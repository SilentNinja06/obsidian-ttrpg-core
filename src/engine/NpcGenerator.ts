import { App, Notice, TFile, stringifyYaml } from "obsidian";
import type { SystemSchema, ArchetypeDefinition } from "../types";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";

// Simple fantasy-neutral name pools — works for most settings, easy to extend.
const FIRST_NAMES = [
  // Anglo / Western-fantasy
  "Aldric", "Bryn", "Cael", "Eira", "Fenn", "Gisla", "Hale", "Iona", "Joren", "Kessa",
  "Lome", "Mira", "Narin", "Pell", "Quill", "Rhea", "Sel", "Toran", "Ula", "Vesk",
  "Wren", "Yara", "Zorin", "Brax", "Calla", "Dorn", "Esha", "Garrick", "Hew", "Isolde",
  "Jarl", "Kara", "Loys", "Maren", "Nessa", "Orrin", "Perrin", "Rowan", "Sable", "Tamsin",
  "Edric", "Falk", "Greta", "Hadrian", "Imryl", "Joss", "Kestrel", "Lira", "Mabon", "Nyx",
  "Osric", "Petra", "Ravyn", "Sten", "Thea", "Ulric", "Veda", "Wystan", "Yorick", "Zephyr",
  // Norse / northern
  "Sigrun", "Halvard", "Brynja", "Eivind", "Gunnhild", "Torsten", "Ingrid", "Leif", "Astrid", "Knut",
  "Vigdis", "Sten", "Hilde", "Bjorn", "Solveig", "Ragnar", "Freydis", "Olaf", "Runa", "Eirik",
  // Latin / southern
  "Marcus", "Livia", "Cassia", "Aurelio", "Drusilla", "Florian", "Octavia", "Severin", "Valeria", "Lucan",
  "Tessaly", "Quintus", "Sabina", "Cyprian", "Aelia", "Demos", "Lucia", "Tiberio", "Vesper", "Cato",
  // Arabic / desert
  "Zafira", "Nadir", "Layla", "Rashid", "Samira", "Tariq", "Yasmin", "Hakim", "Noor", "Faris",
  "Amani", "Jalal", "Soraya", "Bashir", "Inara", "Karim", "Dalia", "Omar", "Leena", "Hamza",
  // Slavic / eastern
  "Dragan", "Mirela", "Bohdan", "Katya", "Vukan", "Zlata", "Radomir", "Nadia", "Stasik", "Vesna",
  // East-Asian-inspired
  "Renji", "Suyin", "Haruko", "Jiro", "Meilin", "Kaito", "Ayane", "Toshi", "Linh", "Daiki",
  // Earthy / rustic
  "Bardolf", "Maddock", "Tibbet", "Ollam", "Hodge", "Wenna", "Cobb", "Bram", "Gilly", "Tansy",
];

const SURNAMES = [
  // Place / nature
  "Ashveil", "Thorne", "Greycastle", "Vane", "Dunmoor", "Blackwater", "Ferris", "Holt",
  "Marsh", "Quintaine", "Rooke", "Stonefield", "Vance", "Whitlock", "Calder", "Drey",
  "Ravenscar", "Oakhollow", "Briarwood", "Fenwick", "Coldmere", "Highbarrow", "Ironwood", "Mossbank",
  "Stormcrow", "Wyndham", "Thistledown", "Ashford", "Duskwood", "Frostvale", "Greenhollow", "Hawkridge",
  "Larkspur", "Nightingale", "Pinebrook", "Redfern", "Silverbrook", "Thornfield", "Westmere", "Wolfsbane",
  // Trade / station
  "Carver", "Mason", "Fletcher", "Tanner", "Cooper", "Smith", "Slate", "Weaver", "Hooper", "Chandler",
  "Sawyer", "Brewer", "Glover", "Skinner", "Wright", "Thatcher", "Salter", "Currier",
  // Harder / martial
  "Bloodgood", "Hardwick", "Grimm", "Steele", "Marlowe", "Drakemont", "Vael", "Korr",
  "Volkov", "Strand", "Ostrega", "Maric", "Sarkany", "Dragovic", "Ferrant", "Auclair",
  "Belmonte", "Sforza", "Valois", "Castellan", "del Marr", "Voss", "Hargrave", "Aldermoor",
];

const MONIKERS = [
  "the Quiet", "of the Marsh", "Half-Hand", "the Younger", "Two-Coats", "the Patient",
  "Saltborn", "the Crooked", "Far-Walker", "Ash-Eyed", "the Last", "Coin-Counter",
  "the Unlucky", "Threefingers", "of the Low Road", "the Grey", "Stormborn", "the Bent",
  "Ironjaw", "the Veiled", "One-Eye", "the Bold", "Snakecharmer", "the Forgotten",
  "Coldhands", "the Wanderer", "of No House", "the Silent", "Brokenblade", "the Tall",
  "Quickfoot", "the Pious", "Wineblood", "the Mad", "of the Ruin", "Greycloak",
  "the Kind", "Deadeye", "the Cruel", "of the Deep", "Lighthand", "the Wretched",
  "the Sly", "Owl-Eyed", "the Generous", "Stonefist", "the Drowned", "of the Hollow",
  "the Nameless", "Goldtooth", "the Withered", "Nightwalker", "the Steadfast", "Mire-Born",
];

export class NpcGenerator {
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

  randomName(): string {
    const first = pick(FIRST_NAMES);
    // 60% surname, 40% moniker
    if (Math.random() < 0.6) return `${first} ${pick(SURNAMES)}`;
    return `${first} ${pick(MONIKERS)}`;
  }

  getArchetypes(): ArchetypeDefinition[] {
    const campaign = this.campaignManager.getActive();
    if (!campaign) return [];
    return this.systemLoader.get(campaign.system)?.archetypes ?? [];
  }

  /**
   * Roll stats for an NPC, weighting toward the archetype's boost/dump lists
   * while respecting each stat's min/max from the schema.
   */
  rollStats(schema: SystemSchema, archetype: ArchetypeDefinition | null): Record<string, number> {
    const stats = schema.entities?.character?.stats ?? [];
    const result: Record<string, number> = {};

    for (const stat of stats) {
      const min = stat.min ?? 1;
      const max = stat.max ?? 20;
      const span = max - min;

      let roll: number;
      if (archetype && archetype.boost.includes(stat.key)) {
        // Boosted: bias toward the top third
        roll = min + Math.round(span * (0.6 + Math.random() * 0.4));
      } else if (archetype && archetype.dump.includes(stat.key)) {
        // Dumped: bias toward the bottom third
        roll = min + Math.round(span * (Math.random() * 0.35));
      } else {
        // Neutral: middle-weighted
        roll = min + Math.round(span * (0.3 + Math.random() * 0.4));
      }
      result[stat.key] = Math.max(min, Math.min(max, roll));
    }
    return result;
  }

  randomTrait(archetype: ArchetypeDefinition | null): string {
    if (archetype && archetype.traits.length) return pick(archetype.traits);
    return "Unremarkable at first glance";
  }

  /**
   * Build and write a full NPC note. Returns the created file.
   */
  async createNpc(
    name: string,
    archetype: ArchetypeDefinition | null,
    storyImportant: boolean = true
  ): Promise<TFile | null> {
    const campaign = this.campaignManager.getActive();
    const campaignId = this.campaignManager.getActiveId();
    if (!campaign || !campaignId) {
      new Notice("No active campaign.");
      return null;
    }
    const schema = this.systemLoader.get(campaign.system);
    if (!schema) {
      new Notice("System schema not found.");
      return null;
    }

    const stats = this.rollStats(schema, archetype);
    const trait = this.randomTrait(archetype);
    const hpKeys = schema.entities?.character?.hp;

    const fm: Record<string, unknown> = {
      "ttrpg-type": "character",
      system: schema.id,
      campaign: campaignId,
      status: storyImportant ? "active" : "transient",
      tags: storyImportant ? ["npc"] : ["npc", "fodder"],
      "session-appearances": [],
      conditions: [],
      relationships: [],
      player: "",
      archetype: archetype?.label ?? "",
      trait,
      ...stats,
    };
    if (hpKeys) {
      // Give a modest HP based on a toughness-ish stat if present, else default
      const toughKey = stats["con"] !== undefined ? "con" : stats["t"] !== undefined ? "t" : stats["endurance"] !== undefined ? "endurance" : null;
      const baseHp = toughKey ? Math.max(4, stats[toughKey]) : 8;
      fm[hpKeys.current] = baseHp;
      fm[hpKeys.max] = baseHp;
    }

    const slug = name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
    const subfolder = storyImportant ? "characters/npcs" : "characters/fodder";
    const folder = `${this.campaignsFolder}/${campaignId}/${subfolder}`;
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }
    const path = `${folder}/${slug}.md`;

    if (this.app.vault.getFileByPath(path)) {
      new Notice(`An NPC named "${name}" already exists.`);
      return this.app.vault.getFileByPath(path) as TFile;
    }

    const body = [
      `# 👤 ${name}`,
      "",
      `> *${trait}*`,
      archetype ? `> Archetype: ${archetype.label}` : "",
      "",
      "## Core stats",
      "_Stat block rendered by the plugin from system schema._",
      "",
      "## Role",
      "_What they do, who they serve._",
      "",
      "## Notes",
      "_Improv notes, what the party learned._",
    ].filter((l) => l !== "").join("\n");

    const content = `---\n${stringifyYaml(fm)}---\n\n${body}`;
    const file = await this.app.vault.create(path, content);
    return file;
  }

  /**
   * Generate a batch of NPCs across mixed archetypes.
   * - baseName: e.g. "Goblin"
   * - entries: archetype id + count
   * - storyimportant: if false, store in characters/fodder/ ; if true, characters/npcs/
   * - individualNotes: one note per body, or one shared note per archetype group
   * Returns the generated bodies (for combat insertion).
   */
  async createBatch(
    baseName: string,
    entries: BatchEntry[],
    storyImportant: boolean,
    individualNotes: boolean
  ): Promise<GeneratedBody[]> {
    const campaign = this.campaignManager.getActive();
    const campaignId = this.campaignManager.getActiveId();
    if (!campaign || !campaignId) { new Notice("No active campaign."); return []; }
    const schema = this.systemLoader.get(campaign.system);
    if (!schema) { new Notice("System schema not found."); return []; }

    const hpKeys = schema.entities?.character?.hp;
    const subfolder = storyImportant ? "characters/npcs" : "characters/fodder";
    const folder = `${this.campaignsFolder}/${campaignId}/${subfolder}`;
    // Ensure folder exists
    if (!this.app.vault.getFolderByPath(folder)) {
      await this.app.vault.createFolder(folder).catch(() => {});
    }

    const archetypes = schema.archetypes ?? [];
    const bodies: GeneratedBody[] = [];

    for (const entry of entries) {
      const archetype = archetypes.find((a) => a.id === entry.archetypeId) ?? null;
      const archLabel = archetype ? capitalize(archetype.id) : "NPC";

      // Per-archetype-group shared note (when not individual)
      let sharedNotePath = "";
      if (!individualNotes) {
        const groupName = `${baseName} ${archLabel} x${entry.count}`;
        const slug = groupName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
        sharedNotePath = `${folder}/${slug}.md`;
        if (!this.app.vault.getFileByPath(sharedNotePath)) {
          const stats = this.rollStats(schema, archetype);
          const trait = this.randomTrait(archetype);
          const fm: Record<string, unknown> = {
            "ttrpg-type": "character",
            system: schema.id,
            campaign: campaignId,
            status: storyImportant ? "active" : "transient",
            tags: storyImportant ? ["npc"] : ["npc", "fodder"],
            count: entry.count,
            archetype: archetype?.label ?? "",
            trait,
            conditions: [],
            ...stats,
          };
          if (hpKeys) {
            const hp = this.deriveHp(stats);
            fm[hpKeys.current] = hp;
            fm[hpKeys.max] = hp;
          }
          const body = `# 👤 ${groupName}\n\n> *${trait}*\n> Archetype: ${archetype?.label ?? "NPC"} · Group of ${entry.count}\n\n## Role\n_Combat group._\n\n## Notes\n_Improv notes._`;
          await this.app.vault.create(sharedNotePath, `---\n${stringifyYaml(fm)}---\n\n${body}`);
        }
      }

      for (let i = 1; i <= entry.count; i++) {
        const bodyName = `${baseName} ${archLabel} ${i}`;
        const stats = this.rollStats(schema, archetype);
        const hp = hpKeys ? this.deriveHp(stats) : 8;

        let filePath = sharedNotePath;
        if (individualNotes) {
          const trait = this.randomTrait(archetype);
          const slug = bodyName.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
          filePath = `${folder}/${slug}.md`;
          if (!this.app.vault.getFileByPath(filePath)) {
            const fm: Record<string, unknown> = {
              "ttrpg-type": "character",
              system: schema.id,
              campaign: campaignId,
              status: storyImportant ? "active" : "transient",
              tags: storyImportant ? ["npc"] : ["npc", "fodder"],
              archetype: archetype?.label ?? "",
              trait,
              conditions: [],
              ...stats,
            };
            if (hpKeys) { fm[hpKeys.current] = hp; fm[hpKeys.max] = hp; }
            const noteBody = `# 👤 ${bodyName}\n\n> *${trait}*\n> Archetype: ${archetype?.label ?? "NPC"}\n\n## Role\n_NPC._\n\n## Notes\n_Improv notes._`;
            await this.app.vault.create(filePath, `---\n${stringifyYaml(fm)}---\n\n${noteBody}`);
          }
        }

        bodies.push({ name: bodyName, hp, filePath, addToCombat: true });
      }
    }

    return bodies;
  }

  private deriveHp(stats: Record<string, number>): number {
    const toughKey = stats["con"] !== undefined ? "con" : stats["t"] !== undefined ? "t" : stats["endurance"] !== undefined ? "endurance" : null;
    return toughKey ? Math.max(4, stats[toughKey]) : 8;
  }
}

export interface BatchEntry {
  archetypeId: string;
  count: number;
}

export interface GeneratedBody {
  name: string;
  hp: number;
  filePath: string;
  addToCombat: boolean;
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
