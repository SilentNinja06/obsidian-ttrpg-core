import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Combatant } from "../types";

export const VIEW_TYPE_COMBAT = "ttrpg-combat";

export class CombatView extends ItemView {
  private combatants: Combatant[] = [];
  private round: number = 1;
  private activeIdx: number = 0;
  private pendingDice: { value: number; label: string } | null = null;
  private log: string[] = ["Combat started — round 1"];

  getViewType(): string { return VIEW_TYPE_COMBAT; }
  getDisplayText(): string { return "Combat Tracker"; }
  getIcon(): string { return "swords"; }

  async onOpen(): Promise<void> {
    this.render();
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

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ttrpg-combat");

    // Toolbar
    const toolbar = container.createDiv("ttrpg-toolbar");
    toolbar.createSpan({ text: `Round ${this.round}`, cls: "ttrpg-round-badge" });

    const nextTurnBtn = toolbar.createEl("button", { text: "Next turn" });
    nextTurnBtn.onclick = () => this.nextTurn();

    const nextRoundBtn = toolbar.createEl("button", { text: "Next round" });
    nextRoundBtn.onclick = () => this.nextRound();

    const addBtn = toolbar.createEl("button", { text: "+ Add" });
    addBtn.onclick = () => this.addCombatant();

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
      logEl.createEl("div", { cls: "ttrpg-log-entry", text: entry });
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

      // Initiative
      row.createSpan({ text: String(c.init), cls: "ttrpg-init-num" });

      // Name block
      const nameBlock = row.createDiv("ttrpg-name-block");
      const nameRow = nameBlock.createDiv("ttrpg-name-row");
      nameRow.createSpan({ text: c.name, cls: "ttrpg-cname" });
      nameRow.createSpan({ text: c.type.toUpperCase(), cls: `ttrpg-tag ttrpg-tag-${c.type}` });
      if (c.dead) nameRow.createSpan({ text: "KO", cls: "ttrpg-tag ttrpg-tag-dead" });
      if (c.conditions.length) {
        const condRow = nameBlock.createDiv("ttrpg-cond-row");
        for (const cond of c.conditions) {
          condRow.createSpan({ text: cond, cls: "ttrpg-tag ttrpg-tag-condition" });
        }
      }

      // HP block
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

      // Initiative edit
      const initEdit = row.createEl("input", { cls: "ttrpg-init-edit" });
      initEdit.type = "number";
      initEdit.value = String(c.init);
      initEdit.onchange = () => {
        c.init = parseInt(initEdit.value) || 0;
        this.renderCombatants();
      };

      // Menu
      const menuBtn = row.createEl("button", { text: "⋮", cls: "ttrpg-menu-btn" });
      menuBtn.onclick = () => this.openConditionMenu(c);
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
    c.hp = Math.max(0, Math.min(c.hpMax, c.hp + sign * val));
    if (c.hp === 0) c.dead = true;
    if (c.hp > 0 && c.dead && sign > 0) c.dead = false;
    const word = sign === -1 ? `took ${val} damage` : `healed ${val} HP`;
    this.addLog(`<strong>${c.name}</strong> ${word} → ${c.hp}/${c.hpMax}`);
    input.value = "";
    this.renderCombatants();
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
    this.activeIdx = (this.activeIdx + 1) % sorted.length;
    this.addLog(`Turn: <strong>${sorted[this.activeIdx].name}</strong>`);
    this.renderCombatants();
    const badge = this.containerEl.querySelector(".ttrpg-round-badge");
    if (badge) badge.textContent = `Round ${this.round}`;
  }

  private nextRound(): void {
    this.round++;
    this.activeIdx = 0;
    const sorted = this.sorted();
    this.addLog(`— Round <strong>${this.round}</strong> begins — ${sorted[0]?.name ?? ""} goes first`);
    this.renderCombatants();
    const badge = this.containerEl.querySelector(".ttrpg-round-badge");
    if (badge) badge.textContent = `Round ${this.round}`;
  }

  private addCombatant(): void {
    const name = prompt("Name:");
    if (!name) return;
    const isPC = confirm("Is this a PC?");
    const init = parseInt(prompt("Initiative:") ?? "0") || 0;
    const hp = parseInt(prompt("Max HP:") ?? "10") || 10;
    this.combatants.push({
      id: Date.now(),
      name,
      type: isPC ? "pc" : "npc",
      init,
      hp,
      hpMax: hp,
      conditions: [],
      dead: false,
    });
    this.addLog(`<strong>${name}</strong> joined (init ${init})`);
    this.renderCombatants();
  }

  private openConditionMenu(c: Combatant): void {
    const input = prompt(
      `Conditions for ${c.name}\nAvailable: poisoned, stunned, prone, blinded, charmed\nCurrent: ${c.conditions.join(", ") || "none"}\n\nEnter comma-separated (blank = clear):`
    );
    if (input === null) return;
    c.conditions = input.split(",").map((s) => s.trim()).filter(Boolean);
    this.addLog(`<strong>${c.name}</strong> conditions: ${c.conditions.join(", ") || "none"}`);
    this.renderCombatants();
  }
}
