import { ItemView, WorkspaceLeaf } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import type { SystemLoader } from "../engine/SystemLoader";
import type { LootManager } from "../engine/LootManager";
import { collectUnassignedLoot, LootItem } from "../utils/queries";

export const VIEW_TYPE_LOOT = "ttrpg-loot";

export class LootDistributionView extends ItemView {
  private campaignManager: CampaignManager;
  private systemLoader: SystemLoader;
  private lootManager: LootManager;
  private campaignsFolder: string;

  constructor(
    leaf: WorkspaceLeaf,
    campaignManager: CampaignManager,
    systemLoader: SystemLoader,
    lootManager: LootManager,
    campaignsFolder: string
  ) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.systemLoader = systemLoader;
    this.lootManager = lootManager;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_LOOT; }
  getDisplayText(): string { return "Loot Distribution"; }
  getIcon(): string { return "coins"; }

  async onOpen(): Promise<void> { await this.render(); }

  private campaignFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}`;
  }

  async render(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.cssText = "padding:1rem;overflow-y:auto;font-family:var(--font-sans)";

    const campaign = this.campaignManager.getActive();
    if (!campaign) {
      container.createEl("p", { text: "No active campaign.", cls: "ttrpg-muted" });
      return;
    }

    // Header
    const header = container.createDiv();
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:1rem;padding-bottom:1rem;border-bottom:0.5px solid var(--color-border-tertiary)";
    const titleWrap = header.createDiv();
    titleWrap.createEl("h2", { text: "Loot distribution" }).style.cssText = "margin:0;font-size:18px;font-weight:500";
    titleWrap.createEl("p", { text: campaign.name }).style.cssText = "margin:2px 0 0;font-size:13px;color:var(--color-text-secondary)";
    const popBtn = header.createEl("button", { text: "⤢ Pop out" });
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    const party = this.lootManager.partyMembers();
    const targets = [...party, "Party stash"];

    // ── Items ────────────────────────────────────────────────────────────────
    const loot = await collectUnassignedLoot(this.app, this.campaignFolder());
    container.createEl("h3", { text: `Unassigned items${loot.length ? ` (${loot.length})` : ""}` })
      .style.cssText = "font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;margin:0 0 8px";

    if (loot.length === 0) {
      container.createEl("p", { text: "No unassigned items.", cls: "ttrpg-muted" })
        .style.cssText = "font-size:13px;color:var(--color-text-tertiary);margin-bottom:1.5rem";
    } else {
      const list = container.createDiv();
      list.style.marginBottom = "1.5rem";
      for (const item of loot) {
        this.itemRow(list, item, targets);
      }
    }

    // ── Currency ─────────────────────────────────────────────────────────────
    const currencies = this.lootManager.currencyKeys();
    if (currencies.length > 0) {
      container.createEl("h3", { text: "Distribute currency" })
        .style.cssText = "font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.03em;margin:0 0 8px";
      this.currencyPanel(container, currencies, party);
    }
  }

  private itemRow(parent: HTMLElement, item: LootItem, targets: string[]): void {
    const row = parent.createDiv();
    row.style.cssText = "display:flex;align-items:center;gap:10px;padding:8px 10px;border:0.5px solid var(--color-border-tertiary);border-radius:var(--radius-m);margin-bottom:6px;background:var(--color-background-primary)";

    const nameWrap = row.createDiv();
    nameWrap.style.flex = "1";
    nameWrap.createDiv({ text: item.name }).style.cssText = "font-size:14px;color:var(--color-text-primary)";
    nameWrap.createDiv({ text: item.source }).style.cssText = "font-size:11px;color:var(--color-text-tertiary)";

    const select = row.createEl("select");
    select.style.cssText = "font-size:13px;padding:4px 6px;border-radius:var(--radius-s);background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary)";
    const placeholder = select.createEl("option", { text: "Assign to…" });
    placeholder.value = "";
    for (const t of targets) select.createEl("option", { text: t, value: t });

    const assignBtn = row.createEl("button", { text: "Assign" });
    assignBtn.style.cssText = "font-size:13px;padding:4px 12px";
    assignBtn.onclick = async () => {
      const holder = select.value;
      if (!holder) return;
      assignBtn.disabled = true;
      assignBtn.textContent = "…";
      await this.lootManager.assignLoot(item.name, holder, item.fromInventory ? undefined : item.sourcePath);
      row.style.opacity = "0.5";
      row.empty();
      const done = row.createDiv({ text: `${item.name} → ${holder}` });
      done.style.cssText = "font-size:13px;color:var(--color-text-success)";
      // Re-render after a moment to refresh the list
      setTimeout(() => this.render(), 600);
    };
  }

  private currencyPanel(parent: HTMLElement, currencies: { key: string; label: string }[], party: string[]): void {
    const panel = parent.createDiv();
    panel.style.cssText = "border:0.5px solid var(--color-border-tertiary);border-radius:var(--radius-m);padding:12px;background:var(--color-background-primary)";

    const row1 = panel.createDiv();
    row1.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px";

    const amountInput = row1.createEl("input");
    amountInput.type = "number";
    amountInput.placeholder = "Amount";
    amountInput.style.cssText = "width:90px;font-size:13px;padding:5px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";

    const currencySelect = row1.createEl("select");
    currencySelect.style.cssText = "font-size:13px;padding:5px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";
    for (const c of currencies) currencySelect.createEl("option", { text: c.label, value: c.key });

    const row2 = panel.createDiv();
    row2.style.cssText = "display:flex;gap:8px;align-items:center;flex-wrap:wrap";

    const modeSelect = row2.createEl("select");
    modeSelect.style.cssText = "font-size:13px;padding:5px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s)";
    modeSelect.createEl("option", { text: "Split evenly", value: "split" });
    modeSelect.createEl("option", { text: "To party stash", value: "stash" });
    modeSelect.createEl("option", { text: "To one person", value: "person" });

    const personSelect = row2.createEl("select");
    personSelect.style.cssText = "font-size:13px;padding:5px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:var(--radius-s);display:none";
    for (const p of party) personSelect.createEl("option", { text: p, value: p });

    modeSelect.onchange = () => {
      personSelect.style.display = modeSelect.value === "person" ? "" : "none";
    };

    const distributeBtn = row2.createEl("button", { text: "Distribute" });
    distributeBtn.style.cssText = "font-size:13px;padding:5px 14px";
    distributeBtn.onclick = async () => {
      const amount = parseInt(amountInput.value) || 0;
      if (amount <= 0) return;
      const mode = modeSelect.value as "split" | "stash" | "person";
      const target = mode === "person" ? personSelect.value : undefined;
      await this.lootManager.distributeCurrency(currencySelect.value, amount, mode, target);
      amountInput.value = "";
      const note = panel.createDiv({ text: `Distributed ${amount} ${currencySelect.value} (${mode})` });
      note.style.cssText = "font-size:12px;color:var(--color-text-success);margin-top:8px";
      setTimeout(() => note.remove(), 2500);
    };
  }
}
