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

export interface SystemSchema {
  id: string;
  name: string;
  version: number;
  entities: Record<string, EntityDefinition>;
  combat: CombatDefinition;
  currency?: CurrencyDefinition[];
  arcFields?: { key: string; label: string }[];
  npcFields?: { key: string; label: string }[];
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
}

// ─── Plugin settings ─────────────────────────────────────────────────────────

export interface TTRPGSettings {
  defaultCampaignFolder: string;
  systemsFolder: string;
  activeCampaign: string;
  sidebarDefaultOpen: boolean;
}

export const DEFAULT_SETTINGS: TTRPGSettings = {
  defaultCampaignFolder: "ttrpg/campaigns",
  systemsFolder: "ttrpg/systems",
  activeCampaign: "",
  sidebarDefaultOpen: true,
};
