// ─── System schema types ────────────────────────────────────────────────────

export interface StatDefinition {
  key: string;
  label: string;
  type: "integer" | "string" | "boolean";
  min?: number;
  max?: number;
}

export interface EntityDefinition {
  stats?: StatDefinition[];
  hp?: { current: string; max: string };
  fields?: { key: string; label: string; type: string }[];
}

export interface CombatDefinition {
  dice: string;
  initiative: string;
  turnOrder: "highest-first" | "lowest-first" | "alternating";
  hpTracking: boolean;
  moraleTest?: string;
}

export interface CurrencyDefinition {
  key: string;
  label: string;
}

export interface ConditionDefinition {
  name: string;
  effect: string;
  duration?: string;
}

export interface ArchetypeDefinition {
  id: string;
  label: string;
  boost: string[];   // stat keys to raise
  dump: string[];    // stat keys to lower
  traits: string[];  // flavor traits to pick from
}

export interface SystemSchema {
  id: string;
  name: string;
  version: number;
  entities: Record<string, EntityDefinition>;
  combat: CombatDefinition;
  currency?: CurrencyDefinition[];
  arcFields?: { key: string; label: string }[];
  npcFields?: { key: string; label: string }[];
  archetypes?: ArchetypeDefinition[];
  conditions?: ConditionDefinition[];
}

// ─── Campaign types ──────────────────────────────────────────────────────────

export interface CampaignConfig {
  name: string;
  system: string;
  players: string[];
  activeSince: string;
  folderRoot: string;
  status: "active" | "hiatus" | "complete";
}

// ─── Entity / note types ─────────────────────────────────────────────────────

export type NoteType =
  | "character"
  | "location"
  | "faction"
  | "session"
  | "history"
  | "item";

export interface NoteFrontmatter {
  "ttrpg-type": NoteType;
  system: string;
  campaign: string;
  status: string;
  tags: string[];
  [key: string]: unknown;
}

export interface Combatant {
  id: number;
  name: string;
  type: "pc" | "npc";
  init: number;
  hp: number;
  hpMax: number;
  conditions: string[];
  dead: boolean;
  filePath?: string; // set for PCs loaded from character sheets, enables HP write-back
}

// ─── Plugin settings ─────────────────────────────────────────────────────────

export interface TTRPGSettings {
  defaultCampaignFolder: string;
  systemsFolder: string;
  activeCampaign: string;
  sidebarDefaultOpen: boolean;
  recapProseEngine: "deterministic" | "ai";
  aiProvider: "anthropic" | "openai" | "custom";
  aiEndpoint: string;
  aiApiKey: string;
  aiModel: string;
}

export const DEFAULT_SETTINGS: TTRPGSettings = {
  defaultCampaignFolder: "ttrpg/campaigns",
  systemsFolder: "ttrpg/systems",
  activeCampaign: "",
  sidebarDefaultOpen: true,
  recapProseEngine: "deterministic",
  aiProvider: "anthropic",
  aiEndpoint: "",
  aiApiKey: "",
  aiModel: "claude-sonnet-4-6",
};
