import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Combatant } from "../types";
import { InputModal, promptText, confirmAction } from "../modals/InputModal";
import type { CombatStore } from "../engine/CombatStore";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import { AddExistingModal } from "../modals/AddExistingModal";
import { ConditionPickerModal } from "../modals/ConditionPickerModal";
import { TFile, stringifyYaml } from "obsidian";
import { writeFrontmatterKey, readNote, writeSection } from "../utils/fileIO";

export const VIEW_TYPE_COMBAT = "ttrpg-combat";

export class CombatView extends ItemView {
  private combatants: Combatant[] = [];
  private round: number = 1;
  private activeIdx: number = 0;
  private pendingDice: { value: number; label: string } | null = null;
  private log: string[] = ["Combat started — round 1"];

  private store: CombatStore;
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private campaignsFolder: string;
  private loaded = false;

  constructor(
    leaf: WorkspaceLeaf,
    store: CombatStore,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    campaignsFolder: string
  ) {
    super(leaf);
    this.store = store;
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_COMBAT; }
  getDisplayText(): string { return "Combat Tracker"; }
  getIcon(): string { return "swords"; }

  private campaignFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}`;
  }

  private hpKeys(): { current: string; max: string } | undefined {
    const campaign = this.campaignManager.getActive();
    if (!campaign) return undefined;
    return this.systemLoader.get(campaign.system)?.entities?.character?.hp;
  }

  private initiativeDie(): number {
    const campaign = this.campaignManager.getActive();
    const dice = campaign ? this.systemLoader.get(campaign.system)?.combat?.dice : undefined;
    const m = dice?.match(/d(\d+)/i);
    return m ? parseInt(m[1]) : 20;
  }

  private openAddExisting(): void {
    new AddExistingModal(
      this.app,
      this.campaignManager,
      this.systemLoader,
      this.campaignsFolder,
      (file, name, hp, isPC) => {
        this.combatants.push({
          id: Date.now() + Math.floor(Math.random() * 1000),
          name,
          type: isPC ? "pc" : "npc",
          init: 0,
          hp,
          hpMax: hp,
          conditions: [],
          dead: false,
          filePath: file.path,
        });
        this.addLog(`<strong>${name}</strong> added to combat (${hp} HP)`);
        this.renderCombatants();
        this.autosave();
      }
    ).open();
  }

  /** Add an NPC combatant from an external source (e.g. NPC generator). */
  addExternalCombatant(name: string, hp: number, filePath?: string): void {
    this.combatants.push({
      id: Date.now() + Math.floor(Math.random() * 1000),
      name,
      type: "npc",
      init: 0,
      hp,
      hpMax: hp,
      conditions: [],
      dead: false,
      filePath,
    });
    this.addLog(`<strong>${name}</strong> added to combat`);
    this.renderCombatants();
    this.autosave();
  }

  private rollNpcInitiative(): void {
    const sides = this.initiativeDie();
    let rolled = 0;
    for (const c of this.combatants) {
      if (c.type === "npc") {
        c.init = Math.floor(Math.random() * sides) + 1;
        rolled++;
      }
    }
    if (rolled === 0) {
      this.addLog("No NPCs to roll initiative for");
    } else {
      this.addLog(`Rolled d${sides} initiative for ${rolled} NPC${rolled === 1 ? "" : "s"} — enter PC rolls manually`);
    }
    this.activeIdx = 0;
    this.renderCombatants();
    this.autosave();
  }

  private snapshot() {
    return {
      round: this.round,
      activeIdx: this.activeIdx,
      combatants: this.combatants,
      log: this.log,
      savedAt: new Date().toISOString(),
    };
  }

  private async autosave(): Promise<void> {
    const id = this.campaignManager.getActiveId();
    if (!id) return;
    await this.store.saveCurrent(this.campaignFolder(), this.snapshot());
  }

  private async saveEncounter(): Promise<void> {
    const name = await promptText(this.app, "Save encounter", "Encounter name:", "");
    if (!name) return;
    await this.store.saveEncounter(this.campaignFolder(), name, this.snapshot());
    this.addLog(`Encounter saved as "${name}"`);
  }

  private async loadEncounterDialog(): Promise<void> {
    const names = await this.store.listEncounters(this.campaignFolder());
    if (names.length === 0) {
      this.addLog("No saved encounters found");
      return;
    }
    new InputModal(
      this.app,
      "Load encounter",
      [{ key: "name", label: "Encounter", type: "dropdown", options: names, default: names[0] }],
      async (vals) => {
        if (!vals) return;
        const state = await this.store.loadEncounter(this.campaignFolder(), String(vals.name));
        if (state) {
          this.round = state.round;
          this.activeIdx = state.activeIdx;
          this.combatants = state.combatants;
          this.log = state.log ?? [];
          this.render();
          this.autosave();
        }
      }
    ).open();
  }

  private async clearCombat(): Promise<void> {
    // Only confirm if there's a meaningful encounter to lose (NPCs added,
    // rounds advanced, or any HP/condition changes mid-fight).
    const hasNpcs = this.combatants.some((c) => c.type === "npc");
    const inProgress = this.round > 1 || this.activeIdx > 0;
    if (hasNpcs || inProgress) {
      const ok = await confirmAction(
        this.app,
        "Clear combat",
        "Clear the current encounter? This removes all combatants and resets to your party at full strength. Saved encounters aren't affected.",
        "Clear",
        true
      );
      if (!ok) return;
    }
    const pcs = await this.store.loadPartyPCs(this.campaignFolder(), this.hpKeys());
    this.combatants = pcs;
    this.round = 1;
    this.activeIdx = 0;
    this.log = pcs.length > 0
      ? [`Cleared — reloaded ${pcs.length} party member${pcs.length === 1 ? "" : "s"}`]
      : ["Combat cleared"];
    this.render();
    this.autosave();
  }

  async onOpen(): Promise<void> {
    await this.loadInitial();
    this.render();
  }

  private async loadInitial(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const id = this.campaignManager.getActiveId();
    if (!id) return;

    const saved = await this.store.loadCurrent(this.campaignFolder());
    if (saved && saved.combatants && saved.combatants.length > 0) {
      this.round = saved.round;
      this.activeIdx = saved.activeIdx;
      this.combatants = saved.combatants;
      this.log = saved.log ?? ["Combat resumed"];
    } else {
      // No saved state — auto-load party PCs
      const pcs = await this.store.loadPartyPCs(this.campaignFolder(), this.hpKeys());
      this.combatants = pcs;
      if (pcs.length > 0) {
        this.log = [`Loaded ${pcs.length} party member${pcs.length === 1 ? "" : "s"} — set initiative to begin`];
      }
    }
  }

  private sorted(): Combatant[] {
    return [...this.combatants].sort((a, b) => b.init - a.init);
  }

  private hpColor(c: Combatant): string {
    const pct = c.hp / c.hpMax;
    if (pct > 0.5) return "var(--color-green)";
    if (pct > 0.25) return "var(--color-amber)";
    return "var(--color-red)";
  }

  private addLog(msg: string): void {
    this.log.push(msg);
    const logEl = this.containerEl.querySelector(".ttrpg-combat-log");
    if (logEl) {
      const entry = logEl.createEl("div", { cls: "ttrpg-log-entry" });
      entry.innerHTML = msg;
      logEl.scrollTop = logEl.scrollHeight;
    }
  }

  private injectStyles(container: HTMLElement): void {
    if (container.querySelector("style[data-ttrpg-combat]")) return;
    const style = container.createEl("style");
    style.setAttribute("data-ttrpg-combat", "1");
    style.textContent = `
      .ttrpg-combat { padding: 1rem; overflow-y: auto; font-family: var(--font-interface); }
      .ttrpg-toolbar { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin-bottom: 12px; }
      .ttrpg-toolbar button { font-size: 12px; padding: 4px 10px; }
      .ttrpg-round-badge { font-size: 13px; font-weight: 600; padding: 4px 10px; background: var(--color-background-secondary); border-radius: 8px; margin-right: 4px; }
      .ttrpg-dice-row { display: flex; align-items: center; gap: 5px; flex-wrap: wrap; margin-bottom: 12px; }
      .ttrpg-dice-btn { font-size: 12px; padding: 3px 9px; }
      .ttrpg-dice-result { font-size: 15px; font-weight: 700; color: var(--text-accent); min-width: 22px; text-align: center; }
      .ttrpg-muted { color: var(--text-muted); font-size: 12px; }
      .ttrpg-paste-banner { display: flex; align-items: center; gap: 6px; padding: 6px 10px; margin-bottom: 10px; background: var(--color-background-info, var(--background-secondary)); border: 0.5px solid var(--background-modifier-border); border-radius: 8px; font-size: 12px; }
      .ttrpg-combatant-list { display: flex; flex-direction: column; gap: 8px; margin-bottom: 1rem; }
      .ttrpg-combatant { display: flex; flex-direction: column; gap: 8px; padding: 10px 12px; border: 0.5px solid var(--background-modifier-border); border-radius: 10px; background: var(--background-primary); }
      .ttrpg-combatant.active { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
      .ttrpg-combatant.dead { opacity: 0.55; }
      .ttrpg-row-header { display: flex; align-items: center; gap: 10px; }
      .ttrpg-name-block { flex: 1 1 auto; min-width: 0; }
      .ttrpg-name-row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
      .ttrpg-init-edit { width: 42px; font-size: 14px; padding: 4px 5px; text-align: center; flex: 0 0 auto; }
      .ttrpg-menu-btn { font-size: 16px; padding: 2px 8px; background: none; flex: 0 0 auto; margin-left: auto; }
      .ttrpg-hp-block { display: flex; flex-direction: column; gap: 5px; }
      .ttrpg-hp-bar-wrap { height: 7px; background: var(--background-secondary); border-radius: 4px; overflow: hidden; border: 0.5px solid var(--background-modifier-border); }
      .ttrpg-hp-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }
      .ttrpg-hp-text { font-size: 12px; }
      .ttrpg-hp-controls { display: flex; gap: 4px; align-items: center; flex-wrap: wrap; }
      .ttrpg-hp-input { width: 52px; font-size: 13px; padding: 3px 5px; text-align: center; }
      .ttrpg-hp-input.dice-ready { border-color: var(--interactive-accent); box-shadow: 0 0 0 1px var(--interactive-accent); }
      .ttrpg-dmg-btn { font-size: 12px; padding: 3px 8px; color: var(--color-red, #c0392b); }
      .ttrpg-heal-btn { font-size: 12px; padding: 3px 8px; color: var(--color-green, #27875a); }
      .ttrpg-init-edit { width: 46px; font-size: 13px; padding: 3px 5px; text-align: center; }
      .ttrpg-menu-btn { font-size: 16px; padding: 2px 8px; background: none; }
      .ttrpg-combat-log { max-height: 200px; overflow-y: auto; display: flex; flex-direction: column; gap: 3px; padding: 8px 10px; background: var(--background-secondary); border-radius: 8px; }
      .ttrpg-log-entry { font-size: 12px; color: var(--text-muted); line-height: 1.4; }
      .ttrpg-log-entry strong { color: var(--text-normal); font-weight: 600; }
    `;
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ttrpg-combat");
    this.injectStyles(container);

    // Toolbar
    const toolbar = container.createDiv("ttrpg-toolbar");
    toolbar.createSpan({ text: `Round ${this.round}`, cls: "ttrpg-round-badge" });

    const nextTurnBtn = toolbar.createEl("button", { text: "Next turn" });
    nextTurnBtn.onclick = () => this.nextTurn();

    const nextRoundBtn = toolbar.createEl("button", { text: "Next round" });
    nextRoundBtn.onclick = () => this.nextRound();

    const addBtn = toolbar.createEl("button", { text: "+ Add" });
    addBtn.onclick = () => this.addCombatant();

    const rollInitBtn = toolbar.createEl("button", { text: "🎲 Roll NPC init" });
    rollInitBtn.onclick = () => this.rollNpcInitiative();

    const condRefBtn = toolbar.createEl("button", { text: "📖 Conditions" });
    condRefBtn.onclick = () => {
      const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
      if (plugin?.openConditionReference) plugin.openConditionReference();
    };

    const addExistingBtn = toolbar.createEl("button", { text: "+ Add existing" });
    addExistingBtn.onclick = () => this.openAddExisting();

    const saveBtn = toolbar.createEl("button", { text: "Save encounter" });
    saveBtn.onclick = () => this.saveEncounter();

    const loadBtn = toolbar.createEl("button", { text: "Load" });
    loadBtn.onclick = () => this.loadEncounterDialog();

    const clearBtn = toolbar.createEl("button", { text: "Clear" });
    clearBtn.onclick = () => this.clearCombat();

    const popoutBtn = toolbar.createEl("button", { text: "⤢ Pop out" });
    popoutBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    // Dice row
    const diceRow = container.createDiv("ttrpg-dice-row");
    diceRow.createSpan({ text: "Quick roll:", cls: "ttrpg-muted" });
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      const btn = diceRow.createEl("button", { text: `d${sides}`, cls: "ttrpg-dice-btn" });
      btn.onclick = () => this.rollDice(sides);
    }
    const resultEl = diceRow.createSpan({ text: "—", cls: "ttrpg-dice-result" });
    const labelEl = diceRow.createSpan({ text: "", cls: "ttrpg-muted" });

    // Paste banner
    const pasteBanner = container.createDiv("ttrpg-paste-banner");
    pasteBanner.hide();
    const pasteHint = pasteBanner.createSpan({ cls: "ttrpg-paste-hint" });
    pasteBanner.createSpan({ text: " → click a field to paste, or " });
    const discardBtn = pasteBanner.createEl("button", { text: "Discard" });
    discardBtn.onclick = () => {
      this.pendingDice = null;
      pasteBanner.hide();
      this.updateInputHighlights();
    };

    // Combatant list
    container.createEl("h3", { text: "Initiative order" });
    const listEl = container.createDiv("ttrpg-combatant-list");

    // Log
    container.createEl("h3", { text: "Combat log" });
    const logEl = container.createDiv("ttrpg-combat-log");
    for (const entry of this.log) {
      const div = logEl.createEl("div", { cls: "ttrpg-log-entry" });
      div.innerHTML = entry;
    }

    // Store refs for rollDice to use
    (this as any)._resultEl = resultEl;
    (this as any)._labelEl = labelEl;
    (this as any)._pasteBanner = pasteBanner;
    (this as any)._pasteHint = pasteHint;
    (this as any)._listEl = listEl;

    this.renderCombatants();
  }

  private renderCombatants(): void {
    const listEl = (this as any)._listEl as HTMLElement;
    if (!listEl) return;
    listEl.empty();

    const sorted = this.sorted();
    sorted.forEach((c, i) => {
      const isActive = i === this.activeIdx;
      const pct = Math.max(0, Math.round((c.hp / c.hpMax) * 100));
      const row = listEl.createDiv("ttrpg-combatant" + (isActive ? " active" : "") + (c.dead ? " dead" : ""));

      // ── Header line: init edit · name · type pill · menu ──
      const headerLine = row.createDiv("ttrpg-row-header");

      // Initiative (editable)
      const initEdit = headerLine.createEl("input", { cls: "ttrpg-init-edit" });
      initEdit.type = "number";
      initEdit.value = c.init === 0 ? "" : String(c.init);
      initEdit.placeholder = "0";
      initEdit.title = "Initiative";
      initEdit.onchange = () => {
        c.init = parseInt(initEdit.value) || 0;
        this.renderCombatants();
        this.autosave();
      };

      // Name + type pill
      const nameBlock = headerLine.createDiv("ttrpg-name-block");
      const nameRow = nameBlock.createDiv("ttrpg-name-row");
      const nameEl = nameRow.createSpan({ text: c.name });
      nameEl.style.cssText = "font-size:14px;font-weight:600;color:var(--text-normal);overflow-wrap:anywhere;line-height:1.25";
      const typePill = nameRow.createSpan({ text: c.type.toUpperCase() });
      typePill.style.cssText = `font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;white-space:nowrap;background:${c.type === "pc" ? "#E1ECF7" : "#F7E9E1"};color:${c.type === "pc" ? "#1A4971" : "#71391A"}`;
      if (c.dead) {
        const koPill = nameRow.createSpan({ text: "KO" });
        koPill.style.cssText = "font-size:10px;padding:1px 6px;border-radius:8px;font-weight:600;white-space:nowrap;background:#FCEBEB;color:#791F1F";
      }

      // Menu (far right of header)
      const menuBtn = headerLine.createEl("button", { text: "⋮", cls: "ttrpg-menu-btn" });
      menuBtn.onclick = () => this.openConditionMenu(c);

      // Conditions (under the name)
      if (c.conditions.length) {
        const condRow = nameBlock.createDiv("ttrpg-cond-row");
        condRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-top:3px";
        for (const cond of c.conditions) {
          const pill = condRow.createSpan({ text: cond });
          pill.style.cssText = "font-size:11px;padding:2px 8px;border-radius:10px;font-weight:500;background:#FAEEDA;color:#633806;cursor:pointer";
          pill.title = `What does "${cond}" do? (click)`;
          pill.onclick = (e) => {
            e.stopPropagation();
            const plugin = (this.app as any).plugins?.plugins?.["ttrpg-core"];
            if (plugin?.openConditionReference) plugin.openConditionReference(cond);
          };
        }
      }

      // ── Body line: HP bar + text + controls ──
      const hpBlock = row.createDiv("ttrpg-hp-block");
      const barWrap = hpBlock.createDiv("ttrpg-hp-bar-wrap");
      const bar = barWrap.createDiv("ttrpg-hp-bar");
      bar.style.width = `${pct}%`;
      bar.style.background = this.hpColor(c);
      hpBlock.createSpan({ text: `${c.hp} / ${c.hpMax} HP`, cls: "ttrpg-hp-text ttrpg-muted" });

      const controls = hpBlock.createDiv("ttrpg-hp-controls");
      const input = controls.createEl("input", { cls: "ttrpg-hp-input" + (this.pendingDice ? " dice-ready" : "") });
      input.type = "number";
      input.placeholder = "amt";
      input.setAttribute("data-id", String(c.id));
      input.onfocus = () => {
        if (this.pendingDice) {
          input.value = String(this.pendingDice.value);
          this.addLog(`Dice result <strong>${this.pendingDice.value}</strong> pasted into ${c.name}'s field`);
          this.pendingDice = null;
          const banner = (this as any)._pasteBanner as HTMLElement;
          if (banner) banner.hide();
          this.updateInputHighlights();
        }
      };
      input.oninput = () => {
        if (this.pendingDice) {
          this.pendingDice = null;
          const banner = (this as any)._pasteBanner as HTMLElement;
          if (banner) banner.hide();
          this.updateInputHighlights();
        }
      };

      const dmgBtn = controls.createEl("button", { text: "-DMG", cls: "ttrpg-dmg-btn" });
      dmgBtn.onclick = () => this.applyHp(c.id, -1, input);

      const healBtn = controls.createEl("button", { text: "+Heal", cls: "ttrpg-heal-btn" });
      healBtn.onclick = () => this.applyHp(c.id, 1, input);
    });
  }

  private updateInputHighlights(): void {
    this.containerEl.querySelectorAll(".ttrpg-hp-input").forEach((el) => {
      el.classList.toggle("dice-ready", !!this.pendingDice);
    });
  }

  private applyHp(id: number, sign: number, input: HTMLInputElement): void {
    const c = this.combatants.find((x) => x.id === id);
    if (!c) return;
    const val = parseInt(input.value) || 0;
    if (!val) { input.focus(); return; }
    input.value = "";

    const verb = sign === -1 ? "Damage" : "Healing";
    new InputModal(
      this.app,
      `${verb}: ${c.name} (${val})`,
      [{ key: "note", label: "How? (e.g. goblin crit, axe)", type: "text", default: "" }],
      async (vals) => {
        if (!vals) return; // cancelled — no change applied
        const note = String(vals.note || "").trim();
        await this.commitHp(c, sign, val, note);
      }
    ).open();
  }

  private async commitHp(c: Combatant, sign: number, val: number, note: string): Promise<void> {
    c.hp = Math.max(0, Math.min(c.hpMax, c.hp + sign * val));
    if (c.hp === 0) c.dead = true;
    if (c.hp > 0 && c.dead && sign > 0) c.dead = false;

    const word = sign === -1 ? `took ${val} damage` : `healed ${val} HP`;
    const noteSuffix = note ? ` — ${note}` : "";
    this.addLog(`<strong>${c.name}</strong> ${word}${noteSuffix} → ${c.hp}/${c.hpMax}`);
    this.renderCombatants();
    this.autosave();

    // Option A: write HP back to the character sheet, and log the instance there
    if (c.filePath) {
      const file = this.app.vault.getFileByPath(c.filePath);
      if (file instanceof TFile) {
        const hpKeys = this.hpKeys();
        if (hpKeys) {
          await writeFrontmatterKey(this.app, file, hpKeys.current, c.hp);
        }
        // Append to the sheet's Combat log section
        const stamp = new Date().toLocaleString();
        const line = `- ${stamp} — ${word}${noteSuffix} → ${c.hp}/${c.hpMax}`;
        const { fm, body } = await readNote(this.app, file);
        const existing = body.match(/## Combat log\n([\s\S]*?)(?=\n##|$)/);
        const prior = existing ? existing[1].trim() : "";
        const newSection = prior ? `${prior}\n${line}` : line;
        const newBody = writeSection(body, "Combat log", newSection);
        await this.app.vault.modify(file, `---\n${stringifyYaml(fm)}---\n${newBody}`);
      }
    }
  }

  private rollDice(sides: number): void {
    const value = Math.floor(Math.random() * sides) + 1;
    const label = `d${sides}`;
    const resultEl = (this as any)._resultEl as HTMLElement;
    const labelEl = (this as any)._labelEl as HTMLElement;
    const pasteBanner = (this as any)._pasteBanner as HTMLElement;
    const pasteHint = (this as any)._pasteHint as HTMLElement;
    if (resultEl) resultEl.textContent = String(value);
    if (labelEl) labelEl.textContent = label;
    this.pendingDice = { value, label };
    if (pasteHint) pasteHint.textContent = `Rolled ${label} → ${value}`;
    if (pasteBanner) pasteBanner.show();
    this.addLog(`${label} rolled → <strong>${value}</strong> — click a field to paste`);
    this.updateInputHighlights();
  }

  private nextTurn(): void {
    const sorted = this.sorted();
    if (sorted.length === 0) return;
    this.activeIdx = (this.activeIdx + 1) % sorted.length;
    this.addLog(`Turn: <strong>${sorted[this.activeIdx].name}</strong>`);
    this.renderCombatants();
    const badge = this.containerEl.querySelector(".ttrpg-round-badge");
    if (badge) badge.textContent = `Round ${this.round}`;
    this.autosave();
  }

  private nextRound(): void {
    const sorted = this.sorted();
    if (sorted.length === 0) return;
    this.round++;
    this.activeIdx = 0;
    this.addLog(`— Round <strong>${this.round}</strong> begins — ${sorted[0]?.name ?? ""} goes first`);
    this.renderCombatants();
    const badge = this.containerEl.querySelector(".ttrpg-round-badge");
    if (badge) badge.textContent = `Round ${this.round}`;
    this.autosave();
  }

  private addCombatant(): void {
    new InputModal(
      this.app,
      "Add combatant",
      [
        { key: "name", label: "Name", type: "text" },
        { key: "isPC", label: "Player character?", type: "toggle", default: false },
        { key: "init", label: "Initiative", type: "number", default: 0 },
        { key: "hp", label: "Max HP", type: "number", default: 10 },
      ],
      (vals) => {
        if (!vals || !vals.name) return;
        const hp = (vals.hp as number) || 10;
        this.combatants.push({
          id: Date.now(),
          name: String(vals.name),
          type: vals.isPC ? "pc" : "npc",
          init: (vals.init as number) || 0,
          hp,
          hpMax: hp,
          conditions: [],
          dead: false,
        });
        this.addLog(`<strong>${vals.name}</strong> joined (init ${vals.init || 0})`);
        this.renderCombatants();
        this.autosave();
      }
    ).open();
  }

  private openConditionMenu(c: Combatant): void {
    const campaign = this.campaignManager.getActive();
    const conditions = campaign ? (this.systemLoader.get(campaign.system)?.conditions ?? []) : [];
    new ConditionPickerModal(
      this.app,
      conditions,
      c.conditions,
      c.name,
      (selected) => {
        c.conditions = selected;
        this.addLog(`<strong>${c.name}</strong> conditions: ${c.conditions.join(", ") || "none"}`);
        this.renderCombatants();
        this.autosave();
      }
    ).open();
  }
}
