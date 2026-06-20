import { ItemView, WorkspaceLeaf, TFile, Notice, FuzzySuggestModal, normalizePath, Modal, Setting } from "obsidian";
import { jsPDF } from "jspdf";
import type { CampaignManager } from "../engine/CampaignManager";
import { promptText, confirmAction } from "../modals/InputModal";

export const VIEW_TYPE_DUNGEON = "ttrpg-dungeon";

// ── Extensible palettes ─────────────────────────────────────────────────────
interface CellTool { id: string; label: string; icon: string; color: string; special?: "stairs" | "water" | "rubble" | "pit" | "lava"; }
interface EdgeTool { id: string; label: string; icon: string; color: string; door?: boolean; }

const CELL_TOOLS: CellTool[] = [
  { id: "floor", label: "Floor", icon: "▦", color: "#d9cdb8" },
  { id: "water", label: "Water", icon: "≈", color: "#7fa8c9", special: "water" },
  { id: "stairs", label: "Stairs", icon: "▤", color: "#c2b89c", special: "stairs" },
  { id: "rubble", label: "Rubble", icon: "▒", color: "#b9ad95", special: "rubble" },
  { id: "pit", label: "Pit", icon: "◓", color: "#5a5346", special: "pit" },
  { id: "lava", label: "Lava", icon: "♨", color: "#cf5a2b", special: "lava" },
];
const EDGE_TOOLS: EdgeTool[] = [
  { id: "wall", label: "Wall", icon: "▬", color: "#2b2b2b" },
  { id: "door", label: "Door", icon: "🚪", color: "#8a5a2b", door: true },
];

const MAX_LEVELS = 5;

interface MapLabel { x: number; y: number; text: string; }
interface LevelData {
  cells: Record<string, string>;
  edges: Record<string, string>;
  labels: MapLabel[];
}
interface DungeonMap {
  name: string;
  cols: number;
  rows: number;
  cell: number;
  levels: LevelData[];
  // legacy fields (old single-level saves) — migrated on load
  cells?: Record<string, string>;
  edges?: Record<string, string>;
}

function blankLevel(): LevelData { return { cells: {}, edges: {}, labels: [] }; }

export class DungeonSketcherView extends ItemView {
  private campaignManager: CampaignManager;
  private campaignsFolder: string;

  private map: DungeonMap = this.blankMap();
  private level = 0;                       // active level index
  private activeTool = "floor";
  private toolKind: "cell" | "edge" | "erase" | "room" | "label" | "wall" | "pan" | "select" = "cell";
  private roomWalls = true;
  private roomDoors = false;
  private pendingDoorRoom: { x0: number; y0: number; x1: number; y1: number } | null = null;

  private svg: SVGSVGElement | null = null;
  private viewBox = { x: -20, y: -20, w: 840, h: 680 };
  private painting = false;
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private lastPaintKey = "";               // drag dedup
  private roomStart: { cx: number; cy: number } | null = null;
  private hoverEl: SVGElement | null = null;
  private currentFile: TFile | null = null;

  // point-to-point wall drawing
  private wallTool: "wall" | "door" = "wall";
  private wallAnchor: { gx: number; gy: number } | null = null;  // grid-corner anchor
  private wallPressCorner: { gx: number; gy: number } | null = null;  // corner where current press began
  private wallDragging = false;
  // box selection
  private selStart: { x: number; y: number } | null = null;
  private selRect: { x0: number; y0: number; x1: number; y1: number } | null = null;
  private selAffect: "all" | "cells" | "walls" = "all";

  // undo/redo
  private history: string[] = [];
  private future: string[] = [];

  // autosave / persistence
  private dirty = false;
  private autosaveTimer: number | null = null;
  private readonly AUTOSAVE_MS = 150000; // 2.5 minutes

  constructor(leaf: WorkspaceLeaf, campaignManager: CampaignManager, campaignsFolder: string) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_DUNGEON; }
  getDisplayText(): string { return this.map.name || "Dungeon Sketcher"; }
  getIcon(): string { return "pencil"; }

  async onOpen(): Promise<void> {
    // Optionally reopen the last-edited map (per plugin setting)
    const s = this.settings();
    if (s?.dungeonReopenLast && s.dungeonLastMapPath) {
      const file = this.app.vault.getFileByPath(s.dungeonLastMapPath);
      if (file instanceof TFile) {
        try {
          const raw = await this.app.vault.read(file);
          this.map = this.migrate(JSON.parse(raw));
          this.currentFile = file;
          this.level = 0;
        } catch { /* fall through to blank */ }
      }
    }
    this.render();
    this.startAutosave();
  }

  async onClose(): Promise<void> {
    this.stopAutosave();
    // best-effort flush if there are unsaved changes to a known file
    if (this.dirty && this.currentFile) await this.writeToFile(this.currentFile);
  }

  private plugin(): any { return (this.app as any).plugins?.plugins?.["ttrpg-core"]; }
  private settings(): any { return this.plugin()?.settings; }

  private startAutosave(): void {
    this.stopAutosave();
    this.autosaveTimer = window.setInterval(() => {
      if (this.dirty && this.currentFile) this.writeToFile(this.currentFile);
    }, this.AUTOSAVE_MS);
  }
  private stopAutosave(): void {
    if (this.autosaveTimer !== null) { window.clearInterval(this.autosaveTimer); this.autosaveTimer = null; }
  }

  private markDirty(): void { this.dirty = true; }

  private blankMap(): DungeonMap {
    return { name: "Untitled dungeon", cols: 24, rows: 18, cell: 32, levels: [blankLevel()] };
  }

  private cur(): LevelData { return this.map.levels[this.level]; }

  private mapsFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}/maps/dungeons`;
  }

  // ── Undo / redo ───────────────────────────────────────────────────────────
  private snapshot(): void {
    this.history.push(JSON.stringify(this.map.levels));
    if (this.history.length > 60) this.history.shift();
    this.future = [];
    this.markDirty();
  }
  private undo(): void {
    if (this.history.length === 0) return;
    this.future.push(JSON.stringify(this.map.levels));
    this.map.levels = JSON.parse(this.history.pop() as string);
    if (this.level >= this.map.levels.length) this.level = this.map.levels.length - 1;
    this.draw();
  }
  private redo(): void {
    if (this.future.length === 0) return;
    this.history.push(JSON.stringify(this.map.levels));
    this.map.levels = JSON.parse(this.future.pop() as string);
    this.draw();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.cssText = "display:flex;flex-direction:column;height:100%;font-family:var(--font-interface)";

    // No active map yet → show a start prompt instead of a drawable canvas,
    // so a map is always named and backed by a file before anyone draws.
    if (!this.currentFile) { this.renderEmptyState(container); return; }

    // ── Toolbar row 1: name + level switcher + actions ──
    const bar = container.createDiv();
    bar.style.cssText = "display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap";

    const nameInput = bar.createEl("input");
    nameInput.value = this.map.name;
    nameInput.style.cssText = "font-size:13px;font-weight:600;padding:3px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:6px;max-width:150px";
    nameInput.onchange = () => { this.map.name = nameInput.value || "Untitled dungeon"; this.markDirty(); };

    // Level switcher
    const lvlWrap = bar.createDiv();
    lvlWrap.style.cssText = "display:flex;align-items:center;gap:3px";
    lvlWrap.createSpan({ text: "Level" }).style.cssText = "font-size:11px;color:var(--color-text-tertiary)";
    for (let i = 0; i < this.map.levels.length; i++) {
      const lb = lvlWrap.createEl("button", { text: String(i + 1) });
      const active = i === this.level;
      lb.style.cssText = `font-size:12px;width:24px;height:24px;cursor:pointer;border-radius:5px;border:0.5px solid ${active ? "var(--interactive-accent)" : "var(--color-border-secondary)"};background:${active ? "var(--interactive-accent)" : "transparent"};color:${active ? "var(--text-on-accent)" : "var(--text-normal)"}`;
      lb.onclick = () => { this.level = i; this.render(); };
    }
    if (this.map.levels.length < MAX_LEVELS) {
      const addLvl = lvlWrap.createEl("button", { text: "+" });
      addLvl.title = "Add a level above";
      addLvl.style.cssText = "font-size:13px;width:24px;height:24px;cursor:pointer;border-radius:5px;border:0.5px dashed var(--color-border-secondary);background:transparent;color:var(--color-text-tertiary)";
      addLvl.onclick = () => { this.snapshot(); this.map.levels.push(blankLevel()); this.level = this.map.levels.length - 1; this.render(); };
    }
    if (this.map.levels.length > 1) {
      const delLvl = lvlWrap.createEl("button", { text: "🗑" });
      delLvl.title = `Delete Level ${this.level + 1}`;
      delLvl.style.cssText = "font-size:12px;width:24px;height:24px;cursor:pointer;border-radius:5px;border:0.5px solid var(--color-border-secondary);background:transparent;color:var(--color-text-tertiary)";
      delLvl.onclick = async () => {
        const lvl = this.cur();
        const hasStuff = Object.keys(lvl.cells).length > 0 || Object.keys(lvl.edges).length > 0 || lvl.labels.length > 0;
        if (hasStuff) {
          const ok = await confirmAction(this.app, "Delete level", `Delete Level ${this.level + 1} and everything on it? Other levels aren't affected.`, "Delete level", true);
          if (!ok) return;
        }
        this.snapshot();
        this.map.levels.splice(this.level, 1);
        if (this.level >= this.map.levels.length) this.level = this.map.levels.length - 1;
        this.render();
      };
    }

    const actions = bar.createDiv();
    actions.style.cssText = "display:flex;gap:5px;margin-left:auto;flex-wrap:wrap";
    const mk = (label: string, fn: () => void, title?: string) => {
      const b = actions.createEl("button", { text: label });
      b.style.cssText = "font-size:12px;padding:3px 9px";
      if (title) b.title = title;
      b.onclick = fn;
      return b;
    };
    mk("↶", () => this.undo(), "Undo (Ctrl+Z)");
    mk("↷", () => this.redo(), "Redo (Ctrl+Y)");
    mk("⤢ Fit", () => this.zoomToFit(), "Zoom to fit the whole map");
    mk("Grid", () => this.openGridSettings(), "Resize the grid");
    mk("New", async () => {
      if (this.dirty && this.hasContent()) {
        const ok = await confirmAction(this.app, "New dungeon", "Start a new dungeon? You have unsaved changes to the current one.", "Continue", true);
        if (!ok) return;
      }
      await this.newMap();
    });
    mk("Save", () => this.save());
    mk("Load", () => this.loadMap());
    mk("Export", () => this.openExport(), "Export PNG or print-ready PDF");
    mk("Clear", async () => {
      if (!this.hasContent()) return;
      const ok = await confirmAction(this.app, "Clear level", `Erase everything on Level ${this.level + 1}? Other levels and saved copies aren't affected.`, "Clear", true);
      if (ok) { this.snapshot(); this.map.levels[this.level] = blankLevel(); this.draw(); }
    });

    // ── Toolbar row 2: tools ──
    const tbar = container.createDiv();
    tbar.style.cssText = "display:flex;align-items:center;gap:6px;padding:6px 12px;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap";
    const sep = () => { const s = tbar.createSpan(); s.style.cssText = "width:1px;height:20px;background:var(--color-border-tertiary);margin:0 2px"; };

    for (const t of CELL_TOOLS) this.toolButton(tbar, t.icon, t.label, "cell", t.id, t.color);
    sep();
    this.toolButton(tbar, "▦+", "Room", "room", "room", "#6b8e6b");
    sep();
    // Point-to-point wall + door (single "wall" toolKind; sub-type chooses wall vs door)
    this.toolButton(tbar, "▬", "Wall (point-to-point)", "wall", "wall", "#2b2b2b");
    this.toolButton(tbar, "🚪", "Door (click an edge)", "wall", "door", "#8a5a2b");
    sep();
    this.toolButton(tbar, "T", "Label", "label", "label", "#5a5a8e");
    this.toolButton(tbar, "⛶", "Select / bulk delete", "select", "select", "#9a6ab0");
    this.toolButton(tbar, "✕", "Erase", "erase", "erase", "#cc5555");
    sep();
    this.toolButton(tbar, "✋", "Pan / move", "pan", "pan", "#5a7a9a");

    // Contextual options
    if (this.toolKind === "wall") {
      sep();
      const hintSpan = tbar.createSpan({ text: this.activeTool === "door" ? "Click a wall edge to place a door" : "Click two corners (or drag) to draw a straight wall" });
      hintSpan.style.cssText = "font-size:11px;color:var(--color-text-tertiary)";
      if (this.wallAnchor) {
        const cancel = tbar.createEl("button", { text: "Cancel segment" });
        cancel.style.cssText = "font-size:11px;padding:3px 8px";
        cancel.onclick = () => { this.wallAnchor = null; this.draw(); };
      }
    }
    if (this.toolKind === "select") {
      sep();
      tbar.createSpan({ text: "Affect:" }).style.cssText = "font-size:11px;color:var(--color-text-tertiary)";
      for (const [val, lbl] of [["all", "All"], ["cells", "Tiles only"], ["walls", "Walls only"]] as [typeof this.selAffect, string][]) {
        const b = tbar.createEl("button", { text: lbl });
        const active = this.selAffect === val;
        b.style.cssText = `font-size:11px;padding:3px 8px;cursor:pointer;border-radius:6px;border:0.5px solid ${active ? "#9a6ab0" : "var(--color-border-secondary)"};background:${active ? "#9a6ab022" : "transparent"};color:var(--text-normal)`;
        b.onclick = () => { this.selAffect = val; this.render(); };
      }
    }
    if (this.toolKind === "room") {
      sep();
      const wt = tbar.createEl("button", { text: (this.roomWalls ? "☑" : "☐") + " walls" });
      wt.style.cssText = "font-size:11px;padding:3px 8px;cursor:pointer;border-radius:6px;border:0.5px solid var(--color-border-secondary);background:transparent;color:var(--text-normal)";
      wt.onclick = () => { this.roomWalls = !this.roomWalls; this.render(); };
      const dt = tbar.createEl("button", { text: (this.roomDoors ? "☑" : "☐") + " doors" });
      dt.title = "After drawing a room, click a perimeter wall to place an entrance door";
      dt.style.cssText = "font-size:11px;padding:3px 8px;cursor:pointer;border-radius:6px;border:0.5px solid var(--color-border-secondary);background:transparent;color:var(--text-normal)";
      dt.onclick = () => { this.roomDoors = !this.roomDoors; this.render(); };
    }

    // Hint
    const hint = container.createDiv();
    hint.style.cssText = "font-size:11px;color:var(--color-text-tertiary);padding:3px 12px";
    hint.setText(this.hintText());

    // SVG canvas
    const wrap = container.createDiv();
    wrap.style.cssText = "flex:1;overflow:hidden;position:relative;background:var(--background-secondary)";
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "display:block;cursor:crosshair;touch-action:none";
    this.svg = svg;
    this.updateViewBox();
    wrap.appendChild(svg);

    this.draw();
    this.attach(svg);
  }

  private renderEmptyState(container: HTMLElement): void {
    this.svg = null;
    const wrap = container.createDiv();
    wrap.style.cssText = "flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;padding:32px;text-align:center";

    const icon = wrap.createDiv();
    icon.setText("🗺️");
    icon.style.cssText = "font-size:42px;opacity:0.8";

    const title = wrap.createEl("h2", { text: "Dungeon sketcher" });
    title.style.cssText = "margin:0;font-size:18px;color:var(--text-normal)";

    const sub = wrap.createEl("p", { text: "Start a new map (you'll name it so it autosaves as you draw), or open one you saved earlier." });
    sub.style.cssText = "margin:0;max-width:340px;font-size:13px;color:var(--text-muted);line-height:1.5";

    const id = this.campaignManager.getActiveId();
    if (!id) {
      const warn = wrap.createEl("p", { text: "Pick an active campaign first — maps are saved inside the campaign." });
      warn.style.cssText = "margin:0;font-size:12px;color:var(--text-warning)";
      return;
    }

    const btnRow = wrap.createDiv();
    btnRow.style.cssText = "display:flex;gap:10px;margin-top:4px";

    const newBtn = btnRow.createEl("button", { text: "+ New map" });
    newBtn.addClass("mod-cta");
    newBtn.style.cssText = "font-size:14px;padding:8px 18px";
    newBtn.onclick = () => this.newMap();

    const loadBtn = btnRow.createEl("button", { text: "Load saved map" });
    loadBtn.style.cssText = "font-size:14px;padding:8px 18px";
    loadBtn.onclick = () => this.loadMap();
  }

  private hintText(): string {
    if (this.toolKind === "room") return "Drag to draw a room rectangle. Scroll to zoom, Shift+drag or Pan tool to move.";
    if (this.toolKind === "label") return "Click to place a text label.";
    if (this.toolKind === "wall") return this.activeTool === "door" ? "Click a wall edge to place/remove a door." : "Click a corner, then another corner (or drag) to draw a straight wall. Esc/Cancel to drop the anchor.";
    if (this.toolKind === "select") return "Drag a box to select, then Delete removes the chosen content inside it.";
    if (this.toolKind === "pan") return "Drag to move the map. Scroll to zoom. Use ⤢ Fit to frame everything.";
    return "Click/drag to paint. Scroll to zoom, Shift+drag or Pan tool to move.";
  }

  private hasContent(): boolean {
    return this.map.levels.some((l) => Object.keys(l.cells).length > 0 || Object.keys(l.edges).length > 0 || l.labels.length > 0);
  }

  private toolButton(bar: HTMLElement, icon: string, label: string, kind: typeof this.toolKind, id: string, color: string): void {
    const kindlessTools = ["erase", "room", "label", "pan", "select"];
    const active = (kindlessTools.includes(kind) && this.toolKind === kind) || (this.toolKind === kind && this.activeTool === id);
    const btn = bar.createEl("button", { text: icon });
    btn.title = label;
    btn.style.cssText = `font-size:14px;padding:3px 8px;cursor:pointer;border-radius:6px;border:0.5px solid ${active ? color : "var(--color-border-secondary)"};background:${active ? color + "22" : "transparent"};color:var(--text-normal)`;
    btn.onclick = () => { this.toolKind = kind; this.activeTool = id; this.wallAnchor = null; this.render(); };
  }

  private updateViewBox(): void {
    if (this.svg) this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  // ── Drawing ─────────────────────────────────────────────────────────────
  private drawCellDecor(svg: SVGSVGElement, tool: CellTool, x: number, y: number, cs: number, faint: boolean): void {
    const svgNS = "http://www.w3.org/2000/svg";
    const op = faint ? "0.35" : "1";
    if (tool.special === "stairs") {
      for (let i = 1; i < 5; i++) {
        const ln = document.createElementNS(svgNS, "line");
        ln.setAttribute("x1", String(x * cs)); ln.setAttribute("y1", String(y * cs + (cs / 5) * i));
        ln.setAttribute("x2", String(x * cs + cs)); ln.setAttribute("y2", String(y * cs + (cs / 5) * i));
        ln.setAttribute("stroke", "#8a7f63"); ln.setAttribute("stroke-width", "1.5"); ln.setAttribute("opacity", op);
        svg.appendChild(ln);
      }
    } else if (tool.special === "water") {
      for (let i = 1; i < 3; i++) {
        const wl = document.createElementNS(svgNS, "path");
        const yy = y * cs + (cs / 3) * i;
        wl.setAttribute("d", `M ${x*cs} ${yy} q ${cs/4} -5 ${cs/2} 0 t ${cs/2} 0`);
        wl.setAttribute("fill", "none"); wl.setAttribute("stroke", "#5d8bb0"); wl.setAttribute("stroke-width", "1.2"); wl.setAttribute("opacity", op);
        svg.appendChild(wl);
      }
    } else if (tool.special === "rubble") {
      for (const [dx, dy, r] of [[0.3,0.3,2],[0.6,0.5,2.5],[0.4,0.7,1.8],[0.7,0.25,1.5]]) {
        const c = document.createElementNS(svgNS, "circle");
        c.setAttribute("cx", String(x*cs + cs*dx)); c.setAttribute("cy", String(y*cs + cs*dy)); c.setAttribute("r", String(r));
        c.setAttribute("fill", "#8a7f63"); c.setAttribute("opacity", op);
        svg.appendChild(c);
      }
    } else if (tool.special === "pit") {
      const c = document.createElementNS(svgNS, "rect");
      c.setAttribute("x", String(x*cs + cs*0.2)); c.setAttribute("y", String(y*cs + cs*0.2));
      c.setAttribute("width", String(cs*0.6)); c.setAttribute("height", String(cs*0.6));
      c.setAttribute("fill", "#2e2a22"); c.setAttribute("rx", "2"); c.setAttribute("opacity", op);
      svg.appendChild(c);
    } else if (tool.special === "lava") {
      for (let i = 1; i < 3; i++) {
        const wl = document.createElementNS(svgNS, "path");
        const yy = y * cs + (cs / 3) * i;
        wl.setAttribute("d", `M ${x*cs} ${yy} q ${cs/4} -4 ${cs/2} 0 t ${cs/2} 0`);
        wl.setAttribute("fill", "none"); wl.setAttribute("stroke", "#f0c040"); wl.setAttribute("stroke-width", "1.4"); wl.setAttribute("opacity", op);
        svg.appendChild(wl);
      }
    }
  }

  private draw(): void {
    if (!this.svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    this.svg.empty();
    this.hoverEl = null;
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;

    const bg = document.createElementNS(svgNS, "rect");
    bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
    bg.setAttribute("width", String(W)); bg.setAttribute("height", String(H));
    bg.setAttribute("fill", "#f3efe6");
    this.svg.appendChild(bg);

    // Tracing guide: the level directly below, faint
    if (this.level > 0) {
      const below = this.map.levels[this.level - 1];
      for (const [key, toolId] of Object.entries(below.cells)) {
        const [x, y] = key.split(",").map(Number);
        const tool = CELL_TOOLS.find((t) => t.id === toolId);
        if (!tool) continue;
        const rect = document.createElementNS(svgNS, "rect");
        rect.setAttribute("x", String(x * cs)); rect.setAttribute("y", String(y * cs));
        rect.setAttribute("width", String(cs)); rect.setAttribute("height", String(cs));
        rect.setAttribute("fill", tool.color); rect.setAttribute("opacity", "0.18");
        this.svg.appendChild(rect);
      }
      for (const [key, toolId] of Object.entries(below.edges)) {
        const [xs, ys, dir] = key.split(",");
        const x = Number(xs), y = Number(ys);
        let x1 = x*cs, y1 = y*cs, x2 = x*cs, y2 = y*cs;
        if (dir === "h") x2 = x*cs+cs; else y2 = y*cs+cs;
        const ln = document.createElementNS(svgNS, "line");
        ln.setAttribute("x1", String(x1)); ln.setAttribute("y1", String(y1));
        ln.setAttribute("x2", String(x2)); ln.setAttribute("y2", String(y2));
        ln.setAttribute("stroke", "#2b2b2b"); ln.setAttribute("stroke-width", "4"); ln.setAttribute("opacity", "0.12");
        this.svg.appendChild(ln);
      }
    }

    const lvl = this.cur();

    // Painted cells (current level)
    for (const [key, toolId] of Object.entries(lvl.cells)) {
      const [x, y] = key.split(",").map(Number);
      const tool = CELL_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x * cs)); rect.setAttribute("y", String(y * cs));
      rect.setAttribute("width", String(cs)); rect.setAttribute("height", String(cs));
      rect.setAttribute("fill", tool.color);
      this.svg.appendChild(rect);
      this.drawCellDecor(this.svg, tool, x, y, cs, false);
    }

    // Grid
    for (let x = 0; x <= this.map.cols; x++) {
      const ln = document.createElementNS(svgNS, "line");
      ln.setAttribute("x1", String(x * cs)); ln.setAttribute("y1", "0");
      ln.setAttribute("x2", String(x * cs)); ln.setAttribute("y2", String(H));
      ln.setAttribute("stroke", "#cbc3b2"); ln.setAttribute("stroke-width", "0.5");
      this.svg.appendChild(ln);
    }
    for (let y = 0; y <= this.map.rows; y++) {
      const ln = document.createElementNS(svgNS, "line");
      ln.setAttribute("x1", "0"); ln.setAttribute("y1", String(y * cs));
      ln.setAttribute("x2", String(W)); ln.setAttribute("y2", String(y * cs));
      ln.setAttribute("stroke", "#cbc3b2"); ln.setAttribute("stroke-width", "0.5");
      this.svg.appendChild(ln);
    }

    // Edges
    for (const [key, toolId] of Object.entries(lvl.edges)) {
      this.drawEdge(this.svg, key, toolId, cs);
    }

    // Labels
    for (let i = 0; i < lvl.labels.length; i++) {
      const lab = lvl.labels[i];
      const g = document.createElementNS(svgNS, "g");
      const padW = lab.text.length * 6.2 + 10;
      const r = document.createElementNS(svgNS, "rect");
      r.setAttribute("x", String(lab.x - padW / 2)); r.setAttribute("y", String(lab.y - 9));
      r.setAttribute("width", String(padW)); r.setAttribute("height", "18"); r.setAttribute("rx", "4");
      r.setAttribute("fill", "#fffced"); r.setAttribute("stroke", "#5a5a8e"); r.setAttribute("stroke-width", "0.75");
      g.appendChild(r);
      const t = document.createElementNS(svgNS, "text");
      t.setAttribute("x", String(lab.x)); t.setAttribute("y", String(lab.y + 4));
      t.setAttribute("text-anchor", "middle"); t.setAttribute("font-size", "11"); t.setAttribute("fill", "#33335a"); t.setAttribute("font-weight", "600");
      t.textContent = lab.text;
      g.appendChild(t);
      g.style.cursor = "pointer";
      g.addEventListener("mousedown", (e) => {
        if (this.toolKind === "erase") {
          e.stopPropagation();
          this.snapshot();
          lvl.labels.splice(i, 1);
          this.draw();
        }
      });
      this.svg.appendChild(g);
    }

    // Single corner level marker (instead of per-tile)
    {
      const lt = document.createElementNS(svgNS, "text");
      lt.setAttribute("x", "4"); lt.setAttribute("y", String(cs * 0.6));
      lt.setAttribute("font-size", String(Math.max(14, cs * 0.55)));
      lt.setAttribute("fill", "#9a8f73"); lt.setAttribute("font-weight", "700"); lt.setAttribute("opacity", "0.5");
      lt.textContent = `L${this.level + 1}`;
      this.svg.appendChild(lt);
    }

    // Active box-selection rectangle
    if (this.selRect) {
      const r = document.createElementNS(svgNS, "rect");
      const x = Math.min(this.selRect.x0, this.selRect.x1), y = Math.min(this.selRect.y0, this.selRect.y1);
      r.setAttribute("x", String(x)); r.setAttribute("y", String(y));
      r.setAttribute("width", String(Math.abs(this.selRect.x1 - this.selRect.x0)));
      r.setAttribute("height", String(Math.abs(this.selRect.y1 - this.selRect.y0)));
      r.setAttribute("fill", "#9a6ab0"); r.setAttribute("fill-opacity", "0.15");
      r.setAttribute("stroke", "#9a6ab0"); r.setAttribute("stroke-width", "1.5"); r.setAttribute("stroke-dasharray", "5 3");
      this.svg.appendChild(r);
    }

    // Wall anchor marker (point-to-point first click)
    if (this.toolKind === "wall" && this.wallAnchor && this.activeTool !== "door") {
      const dot = document.createElementNS(svgNS, "circle");
      dot.setAttribute("cx", String(this.wallAnchor.gx * cs)); dot.setAttribute("cy", String(this.wallAnchor.gy * cs));
      dot.setAttribute("r", "4"); dot.setAttribute("fill", "var(--interactive-accent)");
      this.svg.appendChild(dot);
    }
  }

  private drawEdge(svg: SVGSVGElement, key: string, toolId: string, cs: number, faint = false): void {
    const svgNS = "http://www.w3.org/2000/svg";
    const tool = EDGE_TOOLS.find((t) => t.id === toolId);
    if (!tool) return;
    const [xs, ys, dir] = key.split(",");
    const x = Number(xs), y = Number(ys);
    let x1 = x * cs, y1 = y * cs, x2 = x * cs, y2 = y * cs;
    if (dir === "h") { x2 = x * cs + cs; } else { y2 = y * cs + cs; }
    const op = faint ? "0.4" : "1";
    if (tool.door) {
      const base = document.createElementNS(svgNS, "line");
      base.setAttribute("x1", String(x1)); base.setAttribute("y1", String(y1));
      base.setAttribute("x2", String(x2)); base.setAttribute("y2", String(y2));
      base.setAttribute("stroke", "#2b2b2b"); base.setAttribute("stroke-width", "4"); base.setAttribute("stroke-linecap", "round"); base.setAttribute("opacity", op);
      svg.appendChild(base);
      const mx = (x1 + x2) / 2, my = (y1 + y2) / 2, dw = cs * 0.5;
      const door = document.createElementNS(svgNS, "rect");
      if (dir === "h") { door.setAttribute("x", String(mx - dw / 2)); door.setAttribute("y", String(my - 3)); door.setAttribute("width", String(dw)); door.setAttribute("height", "6"); }
      else { door.setAttribute("x", String(mx - 3)); door.setAttribute("y", String(my - dw / 2)); door.setAttribute("width", "6"); door.setAttribute("height", String(dw)); }
      door.setAttribute("fill", tool.color); door.setAttribute("opacity", op);
      svg.appendChild(door);
    } else {
      const ln = document.createElementNS(svgNS, "line");
      ln.setAttribute("x1", String(x1)); ln.setAttribute("y1", String(y1));
      ln.setAttribute("x2", String(x2)); ln.setAttribute("y2", String(y2));
      ln.setAttribute("stroke", tool.color); ln.setAttribute("stroke-width", "5"); ln.setAttribute("stroke-linecap", "round"); ln.setAttribute("opacity", op);
      svg.appendChild(ln);
    }
  }

  // ── Interaction ───────────────────────────────────────────────────────────
  private attach(svg: SVGSVGElement): void {
    const toUser = (clientX: number, clientY: number) => {
      const r = svg.getBoundingClientRect();
      return {
        x: this.viewBox.x + ((clientX - r.left) / r.width) * this.viewBox.w,
        y: this.viewBox.y + ((clientY - r.top) / r.height) * this.viewBox.h,
      };
    };

    svg.addEventListener("mousedown", (e) => {
      // Pan: Shift, middle-button, or the Pan tool
      if (e.shiftKey || e.button === 1 || this.toolKind === "pan") {
        this.panning = true; this.panStart = { x: e.clientX, y: e.clientY }; svg.style.cursor = "grabbing";
        return;
      }
      const p = toUser(e.clientX, e.clientY);

      if (this.toolKind === "room") { this.roomStart = this.cellAt(p); return; }
      if (this.toolKind === "label") { this.placeLabel(p); return; }
      if (this.toolKind === "select") { this.selStart = p; this.selRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y }; return; }

      if (this.toolKind === "wall") {
        if (this.activeTool === "door") {
          // door: toggle on the nearest edge
          const key = this.edgeKeyAt(p);
          if (key) { this.snapshot(); const lvl = this.cur(); lvl.edges[key] = lvl.edges[key] === "door" ? "wall" : "door"; this.draw(); }
          return;
        }
        // Record where this press started; the decision (set anchor vs. commit)
        // happens on mouseup so click-click and click-drag share one path.
        this.wallPressCorner = this.cornerAt(p);
        this.wallDragging = true;
        return;
      }

      // cell / erase paint stroke
      this.snapshot();
      this.painting = true;
      this.lastPaintKey = "";
      this.paintAt(p);
    });

    svg.addEventListener("mousemove", (e) => {
      const p = toUser(e.clientX, e.clientY);
      if (this.panning) {
        const scale = this.viewBox.w / svg.clientWidth;
        this.viewBox.x -= (e.clientX - this.panStart.x) * scale;
        this.viewBox.y -= (e.clientY - this.panStart.y) * scale;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.updateViewBox();
        return;
      }
      if (this.toolKind === "room" && this.roomStart) { this.previewRoom(p); return; }
      if (this.toolKind === "select" && this.selStart) {
        this.selRect = { x0: this.selStart.x, y0: this.selStart.y, x1: p.x, y1: p.y };
        this.draw();
        return;
      }
      if (this.toolKind === "wall") { this.previewWall(p); return; }
      if (this.painting) this.paintAt(p);
    });

    const end = (e: MouseEvent) => {
      const p = toUser(e.clientX, e.clientY);
      if (this.toolKind === "room" && this.roomStart) {
        this.commitRoom(this.roomStart, this.cellAt(p));
        this.roomStart = null;
      }
      if (this.toolKind === "select" && this.selStart) {
        this.commitSelection();
        this.selStart = null; this.selRect = null;
        this.draw();
      }
      if (this.toolKind === "wall" && this.wallDragging) {
        this.wallDragging = false;
        const releaseCorner = this.cornerAt(p);
        const press = this.wallPressCorner;
        this.wallPressCorner = null;

        if (press && (releaseCorner.gx !== press.gx || releaseCorner.gy !== press.gy)) {
          // Mouse moved between press and release → drag-commit (press → release).
          this.commitWall(press, releaseCorner);
          this.wallAnchor = null;
        } else if (this.wallAnchor && press && (press.gx !== this.wallAnchor.gx || press.gy !== this.wallAnchor.gy)) {
          // No drag, but we already had an anchor and clicked a different corner →
          // click-click commit (anchor → this corner).
          this.commitWall(this.wallAnchor, press);
          this.wallAnchor = null;
        } else if (this.wallAnchor && press && press.gx === this.wallAnchor.gx && press.gy === this.wallAnchor.gy) {
          // Clicked the same corner again → cancel the anchor.
          this.wallAnchor = null;
        } else {
          // No anchor yet, no drag → set this corner as the anchor for click-click.
          this.wallAnchor = press;
        }
        this.draw();
      }
      this.painting = false; this.panning = false; svg.style.cursor = this.toolKind === "pan" ? "grab" : "crosshair";
    };
    svg.addEventListener("mouseup", end);
    svg.addEventListener("mouseleave", () => { this.painting = false; this.panning = false; if (this.hoverEl) { this.hoverEl.remove(); this.hoverEl = null; } });

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.1 : 0.9;
      const p = toUser(e.clientX, e.clientY);
      this.viewBox.x = p.x - (p.x - this.viewBox.x) * f;
      this.viewBox.y = p.y - (p.y - this.viewBox.y) * f;
      this.viewBox.w *= f; this.viewBox.h *= f;
      this.updateViewBox();
    }, { passive: false });

    // keyboard undo/redo while the view is focused
    this.containerEl.tabIndex = -1;
    this.containerEl.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") { e.preventDefault(); this.undo(); }
      else if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === "y" || (e.shiftKey && e.key.toLowerCase() === "z"))) { e.preventDefault(); this.redo(); }
    });
  }

  private cellAt(p: { x: number; y: number }): { cx: number; cy: number } {
    return { cx: Math.floor(p.x / this.map.cell), cy: Math.floor(p.y / this.map.cell) };
  }

  private edgeKeyAt(p: { x: number; y: number }): string | null {
    const cs = this.map.cell;
    const cx = Math.floor(p.x / cs), cy = Math.floor(p.y / cs);
    if (cx < 0 || cy < 0 || cx >= this.map.cols || cy >= this.map.rows) return null;
    const fx = p.x / cs - cx, fy = p.y / cs - cy;
    const dTop = fy, dBottom = 1 - fy, dLeft = fx, dRight = 1 - fx;
    const min = Math.min(dTop, dBottom, dLeft, dRight);
    if (min === dTop) return `${cx},${cy},h`;
    if (min === dBottom) return `${cx},${cy + 1},h`;
    if (min === dLeft) return `${cx},${cy},v`;
    return `${cx + 1},${cy},v`;
  }

  private previewEdge(p: { x: number; y: number }): void {
    if (this.hoverEl) { this.hoverEl.remove(); this.hoverEl = null; }
    const key = this.edgeKeyAt(p);
    if (!key || !this.svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    const cs = this.map.cell;
    const [xs, ys, dir] = key.split(",");
    const x = Number(xs), y = Number(ys);
    let x1 = x*cs, y1 = y*cs, x2 = x*cs, y2 = y*cs;
    if (dir === "h") x2 = x*cs+cs; else y2 = y*cs+cs;
    const ln = document.createElementNS(svgNS, "line");
    ln.setAttribute("x1", String(x1)); ln.setAttribute("y1", String(y1));
    ln.setAttribute("x2", String(x2)); ln.setAttribute("y2", String(y2));
    ln.setAttribute("stroke", "var(--interactive-accent)"); ln.setAttribute("stroke-width", "5"); ln.setAttribute("stroke-linecap", "round"); ln.setAttribute("opacity", "0.5");
    this.svg.appendChild(ln);
    this.hoverEl = ln;
  }

  private previewRoom(p: { x: number; y: number }): void {
    if (!this.roomStart || !this.svg) return;
    if (this.hoverEl) { this.hoverEl.remove(); this.hoverEl = null; }
    const cs = this.map.cell;
    const end = this.cellAt(p);
    const x0 = Math.min(this.roomStart.cx, end.cx), x1 = Math.max(this.roomStart.cx, end.cx);
    const y0 = Math.min(this.roomStart.cy, end.cy), y1 = Math.max(this.roomStart.cy, end.cy);
    const svgNS = "http://www.w3.org/2000/svg";
    const rect = document.createElementNS(svgNS, "rect");
    rect.setAttribute("x", String(x0 * cs)); rect.setAttribute("y", String(y0 * cs));
    rect.setAttribute("width", String((x1 - x0 + 1) * cs)); rect.setAttribute("height", String((y1 - y0 + 1) * cs));
    rect.setAttribute("fill", "#6b8e6b"); rect.setAttribute("opacity", "0.3");
    rect.setAttribute("stroke", "#6b8e6b"); rect.setAttribute("stroke-width", "1.5");
    this.svg.appendChild(rect);
    this.hoverEl = rect;
  }

  private commitRoom(start: { cx: number; cy: number }, end: { cx: number; cy: number }): void {
    const x0 = Math.max(0, Math.min(start.cx, end.cx)), x1 = Math.min(this.map.cols - 1, Math.max(start.cx, end.cx));
    const y0 = Math.max(0, Math.min(start.cy, end.cy)), y1 = Math.min(this.map.rows - 1, Math.max(start.cy, end.cy));
    if (x1 < x0 || y1 < y0) { this.draw(); return; }
    this.snapshot();
    const lvl = this.cur();
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) lvl.cells[`${x},${y}`] = "floor";
    if (this.roomWalls) {
      for (let x = x0; x <= x1; x++) { lvl.edges[`${x},${y0},h`] = "wall"; lvl.edges[`${x},${y1 + 1},h`] = "wall"; }
      for (let y = y0; y <= y1; y++) { lvl.edges[`${x0},${y},v`] = "wall"; lvl.edges[`${x1 + 1},${y},v`] = "wall"; }
    }
    this.draw();
    if (this.roomDoors) {
      // Switch to door tool so the next click on a perimeter wall places a door
      this.toolKind = "wall";
      this.activeTool = "door";
      this.render();
      new Notice("Room created — click a perimeter wall to place a door.");
    }
  }

  // ── Point-to-point walls ────────────────────────────────────────────────
  private cornerAt(p: { x: number; y: number }): { gx: number; gy: number } {
    const cs = this.map.cell;
    const gx = Math.max(0, Math.min(this.map.cols, Math.round(p.x / cs)));
    const gy = Math.max(0, Math.min(this.map.rows, Math.round(p.y / cs)));
    return { gx, gy };
  }

  /** Straight-only: snap the second corner to share a row or column with the anchor. */
  private straighten(a: { gx: number; gy: number }, b: { gx: number; gy: number }): { gx: number; gy: number } {
    const dx = Math.abs(b.gx - a.gx), dy = Math.abs(b.gy - a.gy);
    if (dx >= dy) return { gx: b.gx, gy: a.gy };  // horizontal
    return { gx: a.gx, gy: b.gy };                 // vertical
  }

  private edgesBetween(a: { gx: number; gy: number }, b: { gx: number; gy: number }): string[] {
    const keys: string[] = [];
    if (a.gy === b.gy) {
      const y = a.gy, x0 = Math.min(a.gx, b.gx), x1 = Math.max(a.gx, b.gx);
      for (let x = x0; x < x1; x++) keys.push(`${x},${y},h`);
    } else if (a.gx === b.gx) {
      const x = a.gx, y0 = Math.min(a.gy, b.gy), y1 = Math.max(a.gy, b.gy);
      for (let y = y0; y < y1; y++) keys.push(`${x},${y},v`);
    }
    return keys;
  }

  private previewWall(p: { x: number; y: number }): void {
    if (!this.svg) return;
    if (this.hoverEl) { this.hoverEl.remove(); this.hoverEl = null; }
    if (this.activeTool === "door") { this.previewEdge(p); return; }
    const cs = this.map.cell;
    const cursor = this.cornerAt(p);
    const svgNS = "http://www.w3.org/2000/svg";
    const g = document.createElementNS(svgNS, "g");
    // corner dot under cursor
    const dot = document.createElementNS(svgNS, "circle");
    dot.setAttribute("cx", String(cursor.gx * cs)); dot.setAttribute("cy", String(cursor.gy * cs));
    dot.setAttribute("r", "3.5"); dot.setAttribute("fill", "var(--interactive-accent)"); dot.setAttribute("opacity", "0.7");
    g.appendChild(dot);
    // foggy preview line from anchor to (straightened) cursor
    if (this.wallAnchor) {
      const end = this.straighten(this.wallAnchor, cursor);
      const ln = document.createElementNS(svgNS, "line");
      ln.setAttribute("x1", String(this.wallAnchor.gx * cs)); ln.setAttribute("y1", String(this.wallAnchor.gy * cs));
      ln.setAttribute("x2", String(end.gx * cs)); ln.setAttribute("y2", String(end.gy * cs));
      ln.setAttribute("stroke", "var(--interactive-accent)"); ln.setAttribute("stroke-width", "5"); ln.setAttribute("stroke-linecap", "round"); ln.setAttribute("opacity", "0.45");
      g.appendChild(ln);
    }
    this.svg.appendChild(g);
    this.hoverEl = g;
  }

  private commitWall(a: { gx: number; gy: number }, bRaw: { gx: number; gy: number }): void {
    const b = this.straighten(a, bRaw);
    const keys = this.edgesBetween(a, b);
    if (keys.length === 0) return;
    this.snapshot();
    const lvl = this.cur();
    for (const k of keys) lvl.edges[k] = "wall";
  }

  // ── Box selection ───────────────────────────────────────────────────────
  private commitSelection(): void {
    if (!this.selRect) return;
    const cs = this.map.cell;
    const x0 = Math.min(this.selRect.x0, this.selRect.x1), x1 = Math.max(this.selRect.x0, this.selRect.x1);
    const y0 = Math.min(this.selRect.y0, this.selRect.y1), y1 = Math.max(this.selRect.y0, this.selRect.y1);
    if (x1 - x0 < 3 && y1 - y0 < 3) return; // ignore tiny accidental drags
    this.snapshot();
    const lvl = this.cur();
    if (this.selAffect === "all" || this.selAffect === "cells") {
      for (const k of Object.keys(lvl.cells)) {
        const [cx, cy] = k.split(",").map(Number);
        const px = cx * cs + cs / 2, py = cy * cs + cs / 2;
        if (px >= x0 && px <= x1 && py >= y0 && py <= y1) delete lvl.cells[k];
      }
    }
    if (this.selAffect === "all" || this.selAffect === "walls") {
      for (const k of Object.keys(lvl.edges)) {
        const [ex, ey, dir] = k.split(",");
        const x = Number(ex), y = Number(ey);
        const mx = dir === "h" ? x * cs + cs / 2 : x * cs;
        const my = dir === "h" ? y * cs : y * cs + cs / 2;
        if (mx >= x0 && mx <= x1 && my >= y0 && my <= y1) delete lvl.edges[k];
      }
    }
    if (this.selAffect === "all") {
      lvl.labels = lvl.labels.filter((l) => !(l.x >= x0 && l.x <= x1 && l.y >= y0 && l.y <= y1));
    }
  }

  // ── Zoom to fit ─────────────────────────────────────────────────────────
  private zoomToFit(): void {
    const cs = this.map.cell, pad = 30;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    this.viewBox = { x: -pad, y: -pad, w: W + pad * 2, h: H + pad * 2 };
    this.updateViewBox();
  }

  private placeLabel(p: { x: number; y: number }): void {
    promptText(this.app, "Label", "Label text:", "").then((text) => {
      if (!text || !text.trim()) return;
      this.snapshot();
      this.cur().labels.push({ x: Math.round(p.x), y: Math.round(p.y), text: text.trim() });
      this.draw();
    });
  }

  private paintAt(p: { x: number; y: number }): void {
    const cs = this.map.cell;
    const cx = Math.floor(p.x / cs), cy = Math.floor(p.y / cs);
    if (cx < 0 || cy < 0 || cx >= this.map.cols || cy >= this.map.rows) return;
    const lvl = this.cur();

    if (this.toolKind === "cell") {
      const key = `${cx},${cy}`;
      if (key === this.lastPaintKey) return;
      this.lastPaintKey = key;
      lvl.cells[key] = this.activeTool;
    } else if (this.toolKind === "erase") {
      const cellKey = `${cx},${cy}`;
      delete lvl.cells[cellKey];
      const ekey = this.edgeKeyAt(p);
      if (ekey) {
        const fx = p.x / cs - cx, fy = p.y / cs - cy;
        const min = Math.min(fy, 1 - fy, fx, 1 - fx);
        if (min < 0.25) delete lvl.edges[ekey];
      }
    }
    this.draw();
  }

  // ── Grid resize ──────────────────────────────────────────────────────────
  private openGridSettings(): void {
    new GridSettingsModal(this.app, this.map.cols, this.map.rows, (cols, rows) => {
      this.snapshot();
      this.map.cols = cols; this.map.rows = rows;
      // prune anything now off-grid
      for (const lvl of this.map.levels) {
        for (const k of Object.keys(lvl.cells)) { const [x, y] = k.split(",").map(Number); if (x >= cols || y >= rows) delete lvl.cells[k]; }
        for (const k of Object.keys(lvl.edges)) { const [x, y] = k.split(",").map(Number); if (x > cols || y > rows) delete lvl.edges[k]; }
      }
      this.render();
    }).open();
  }

  // ── New / Save / Load ────────────────────────────────────────────────────
  private async newMap(): Promise<void> {
    const id = this.campaignManager.getActiveId();
    if (!id) { new Notice("No active campaign — pick one before creating a map."); return; }
    const name = await promptText(this.app, "New dungeon", "Name this dungeon:", "");
    if (!name || !name.trim()) return; // cancelled — keep current map
    this.map = this.blankMap();
    this.map.name = name.trim();
    this.level = 0; this.history = []; this.future = [];
    this.currentFile = null;
    // Create the backing file immediately so autosave has a target
    await this.save();
    this.render();
  }

  private migrate(m: any): DungeonMap {
    if (!m.levels) {
      m.levels = [{ cells: m.cells || {}, edges: m.edges || {}, labels: [] }];
      delete m.cells; delete m.edges;
    }
    for (const lvl of m.levels) { if (!lvl.labels) lvl.labels = []; }
    return m as DungeonMap;
  }

  private slug(): string {
    return this.map.name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "dungeon";
  }

  /** Write the current map to a specific file and clear the dirty flag. */
  private async writeToFile(file: TFile): Promise<void> {
    await this.app.vault.modify(file, JSON.stringify(this.map, null, 2));
    this.dirty = false;
    this.rememberLastMap(file);
  }

  private async rememberLastMap(file: TFile): Promise<void> {
    const plugin = this.plugin();
    if (plugin?.settings) { plugin.settings.dungeonLastMapPath = file.path; await plugin.saveSettings?.(); }
  }

  private async save(): Promise<void> {
    const id = this.campaignManager.getActiveId();
    if (!id) { new Notice("No active campaign."); return; }
    const folder = normalizePath(this.mapsFolder());
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const path = normalizePath(`${folder}/${this.slug()}.json`);
    const data = JSON.stringify(this.map, null, 2);
    const existing = this.app.vault.getFileByPath(path);
    if (existing instanceof TFile) { await this.app.vault.modify(existing, data); this.currentFile = existing; }
    else this.currentFile = await this.app.vault.create(path, data);
    this.dirty = false;
    if (this.currentFile) await this.rememberLastMap(this.currentFile);
    new Notice(`Saved "${this.map.name}"`);
  }

  private loadMap(): void {
    const id = this.campaignManager.getActiveId();
    if (!id) { new Notice("No active campaign."); return; }
    const folder = normalizePath(this.mapsFolder());
    const files = this.app.vault.getFiles().filter((f) => f.path.startsWith(folder) && f.extension === "json");
    if (files.length === 0) { new Notice("No saved dungeons yet."); return; }
    new DungeonPickerModal(this.app, files, async (file) => {
      const raw = await this.app.vault.read(file);
      try {
        this.map = this.migrate(JSON.parse(raw));
        this.level = 0; this.history = []; this.future = [];
        this.currentFile = file;
        this.dirty = false;
        await this.rememberLastMap(file);
        this.render();
        new Notice(`Loaded "${this.map.name}"`);
      } catch { new Notice("Could not read that dungeon file."); }
    }).open();
  }

  // ── Export ───────────────────────────────────────────────────────────────
  private async openExport(): Promise<void> {
    // Require a manual save first so what we export matches what's on disk.
    if (this.dirty || !this.currentFile) {
      const ok = await confirmAction(this.app, "Save before export", "Export uses the saved map. Save your changes now and continue?", "Save & continue", false);
      if (!ok) return;
      await this.save();
      if (!this.currentFile) return; // save failed (e.g. no campaign)
    }
    new ExportModal(this.app, this.map.levels.length, async (opts) => {
      const levels = opts.level === -1 ? this.map.levels.map((_, i) => i) : [opts.level];
      for (const li of levels) {
        if (opts.format === "png") await this.exportPng(li);
        else await this.exportPdf({ ...opts, level: li });
      }
      if (levels.length > 1) new Notice(`Exported ${levels.length} levels.`);
    }).open();
  }

  private buildStandaloneSvg(levelIdx: number, pad: number): string {
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    const totalW = W + pad * 2, totalH = H + pad * 2;
    const lvl = this.map.levels[levelIdx];
    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`);
    parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>`);
    parts.push(`<g transform="translate(${pad},${pad})">`);
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f3efe6"/>`);
    for (const [key, toolId] of Object.entries(lvl.cells)) {
      const [x, y] = key.split(",").map(Number);
      const tool = CELL_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      parts.push(`<rect x="${x*cs}" y="${y*cs}" width="${cs}" height="${cs}" fill="${tool.color}"/>`);
      if (tool.special === "stairs") for (let i = 1; i < 5; i++) parts.push(`<line x1="${x*cs}" y1="${y*cs+(cs/5)*i}" x2="${x*cs+cs}" y2="${y*cs+(cs/5)*i}" stroke="#8a7f63" stroke-width="1.5"/>`);
    }
    for (let x = 0; x <= this.map.cols; x++) parts.push(`<line x1="${x*cs}" y1="0" x2="${x*cs}" y2="${H}" stroke="#cbc3b2" stroke-width="0.5"/>`);
    for (let y = 0; y <= this.map.rows; y++) parts.push(`<line x1="0" y1="${y*cs}" x2="${W}" y2="${y*cs}" stroke="#cbc3b2" stroke-width="0.5"/>`);
    for (const [key, toolId] of Object.entries(lvl.edges)) {
      const tool = EDGE_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      const [xs, ys, dir] = key.split(",");
      const x = Number(xs), y = Number(ys);
      let x1 = x*cs, y1 = y*cs, x2 = x*cs, y2 = y*cs;
      if (dir === "h") x2 = x*cs+cs; else y2 = y*cs+cs;
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${tool.door ? "#2b2b2b" : tool.color}" stroke-width="5" stroke-linecap="round"/>`);
      if (tool.door) {
        const mx = (x1+x2)/2, my = (y1+y2)/2, dw = cs*0.5;
        if (dir === "h") parts.push(`<rect x="${mx-dw/2}" y="${my-3}" width="${dw}" height="6" fill="${tool.color}"/>`);
        else parts.push(`<rect x="${mx-3}" y="${my-dw/2}" width="6" height="${dw}" fill="${tool.color}"/>`);
      }
    }
    for (const lab of lvl.labels) {
      const padW = lab.text.length * 6.2 + 10;
      parts.push(`<rect x="${lab.x-padW/2}" y="${lab.y-9}" width="${padW}" height="18" rx="4" fill="#fffced" stroke="#5a5a8e" stroke-width="0.75"/>`);
      parts.push(`<text x="${lab.x}" y="${lab.y+4}" text-anchor="middle" font-size="11" fill="#33335a" font-weight="600">${this.escapeXml(lab.text)}</text>`);
    }
    parts.push(`<text x="4" y="${cs * 0.6}" font-size="${Math.max(14, cs * 0.55)}" fill="#9a8f73" font-weight="700" opacity="0.5">L${levelIdx + 1}</text>`);
    parts.push(`</g></svg>`);
    return parts.join("");
  }

  private escapeXml(s: string): string {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }

  private async svgToPng(svgStr: string, w: number, h: number, scale: number): Promise<Uint8Array> {
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("render failed")); img.src = url; });
    const canvas = document.createElement("canvas");
    canvas.width = w * scale; canvas.height = h * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);
    const dataUrl = canvas.toDataURL("image/png");
    return Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
  }

  private async exportPng(levelIdx: number): Promise<void> {
    const cs = this.map.cell, pad = 16;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    const svgStr = this.buildStandaloneSvg(levelIdx, pad);
    const bytes = await this.svgToPng(svgStr, W + pad * 2, H + pad * 2, 2);
    const folder = normalizePath(this.mapsFolder());
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const slug = (this.map.name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "dungeon") + `-L${levelIdx + 1}`;
    const path = normalizePath(`${folder}/${slug}.png`);
    const existing = this.app.vault.getFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) { await this.app.vault.modifyBinary(existing, bytes.buffer as ArrayBuffer); file = existing; }
    else file = await this.app.vault.createBinary(path, bytes.buffer as ArrayBuffer);
    new Notice(`Exported ${file.name}`);
    this.app.workspace.getLeaf(true).openFile(file);
  }

  /**
   * Print-to-scale PDF: each grid square becomes a true real-world size
   * (1 inch or 25 mm). Either fit the whole level on one page (scaled down)
   * or tile across multiple pages at true scale with cut/align marks.
   */
  private async exportPdf(opts: ExportOpts): Promise<void> {
    const unitPt = opts.unit === "inch" ? 72 : 70.866; // 25mm
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    const levelIdx = opts.level;

    // Render the level to a high-res PNG once; we'll place slices of it.
    const pad = 0;
    const svgStr = this.buildStandaloneSvg(levelIdx, pad);
    const pxW = W, pxH = H;
    const renderScale = 3;
    const pngBytes = await this.svgToPng(svgStr, pxW, pxH, renderScale);
    const pngDataUrl = "data:image/png;base64," + this.bytesToBase64(pngBytes);

    const doc = new jsPDF({ unit: "pt", format: opts.page });
    const pageW = doc.internal.pageSize.getWidth();
    const pageH = doc.internal.pageSize.getHeight();
    const margin = 28;

    const titleH = 18;
    const fullW = this.map.cols * unitPt;  // true-scale width in pt
    const fullH = this.map.rows * unitPt;

    if (opts.layout === "fit") {
      // Scale the whole level to fit one page (may be below true scale)
      const availW = pageW - margin * 2, availH = pageH - margin * 2 - titleH;
      const scale = Math.min(availW / fullW, availH / fullH, 1.0);
      const drawW = fullW * scale, drawH = fullH * scale;
      doc.setFontSize(12); doc.setTextColor(40, 40, 40);
      doc.text(`${this.map.name} — Level ${levelIdx + 1}${scale < 1 ? "  (scaled to fit)" : "  (true scale)"}`, margin, margin + 10);
      doc.addImage(pngDataUrl, "PNG", margin, margin + titleH, drawW, drawH);
    } else {
      // Tile at true scale across pages
      const availW = pageW - margin * 2, availH = pageH - margin * 2 - titleH;
      const colsPerPage = Math.max(1, Math.floor(availW / unitPt));
      const rowsPerPage = Math.max(1, Math.floor(availH / unitPt));
      const pagesX = Math.ceil(this.map.cols / colsPerPage);
      const pagesY = Math.ceil(this.map.rows / rowsPerPage);
      let first = true;
      for (let py = 0; py < pagesY; py++) {
        for (let px = 0; px < pagesX; px++) {
          if (!first) doc.addPage();
          first = false;
          const c0 = px * colsPerPage, r0 = py * rowsPerPage;
          const c1 = Math.min(this.map.cols, c0 + colsPerPage), r1 = Math.min(this.map.rows, r0 + rowsPerPage);
          // source slice in px
          const sx = (c0 * cs) / pxW, sy = (r0 * cs) / pxH;
          const sw = ((c1 - c0) * cs) / pxW, sh = ((r1 - r0) * cs) / pxH;
          // Slice the PNG via a temporary canvas
          const sliceUrl = await this.slicePng(pngDataUrl, sx, sy, sw, sh, pxW * renderScale, pxH * renderScale);
          doc.setFontSize(10); doc.setTextColor(90, 90, 90);
          doc.text(`${this.map.name} — Level ${levelIdx + 1} — page ${py * pagesX + px + 1}/${pagesX * pagesY}  (squares = ${opts.unit === "inch" ? "1 in" : "25 mm"})`, margin, margin + 8);
          const drawW = (c1 - c0) * unitPt, drawH = (r1 - r0) * unitPt;
          doc.addImage(sliceUrl, "PNG", margin, margin + titleH, drawW, drawH);
          // cut/align marks
          this.cropMarks(doc, margin, margin + titleH, drawW, drawH);
        }
      }
    }

    const folder = normalizePath(this.mapsFolder());
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const slug = (this.map.name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "dungeon") + `-L${levelIdx + 1}-print`;
    const path = normalizePath(`${folder}/${slug}.pdf`);
    const buffer = doc.output("arraybuffer");
    const existing = this.app.vault.getFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) { await this.app.vault.modifyBinary(existing, buffer); file = existing; }
    else file = await this.app.vault.createBinary(path, buffer);
    new Notice(`Exported ${file.name}`);
    this.app.workspace.getLeaf(true).openFile(file);
  }

  private bytesToBase64(bytes: Uint8Array): string {
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)));
    }
    return btoa(binary);
  }

  private async slicePng(dataUrl: string, sx: number, sy: number, sw: number, sh: number, fullW: number, fullH: number): Promise<string> {
    const img = new Image();
    await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = () => rej(new Error("slice failed")); img.src = dataUrl; });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(sw * fullW); canvas.height = Math.round(sh * fullH);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(img, sx * fullW, sy * fullH, sw * fullW, sh * fullH, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  private cropMarks(doc: jsPDF, x: number, y: number, w: number, h: number): void {
    doc.setDrawColor(120, 120, 120); doc.setLineWidth(0.5);
    const m = 8;
    // corners
    doc.line(x, y, x + m, y); doc.line(x, y, x, y + m);
    doc.line(x + w, y, x + w - m, y); doc.line(x + w, y, x + w, y + m);
    doc.line(x, y + h, x + m, y + h); doc.line(x, y + h, x, y + h - m);
    doc.line(x + w, y + h, x + w - m, y + h); doc.line(x + w, y + h, x + w, y + h - m);
  }
}

// ── Helper modals ───────────────────────────────────────────────────────────
class DungeonPickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onPick: (f: TFile) => void;
  constructor(app: any, files: TFile[], onPick: (f: TFile) => void) {
    super(app); this.files = files; this.onPick = onPick; this.setPlaceholder("Load a saved dungeon…");
  }
  getItems(): TFile[] { return this.files; }
  getItemText(f: TFile): string { return f.basename; }
  onChooseItem(f: TFile): void { this.onPick(f); }
}

class GridSettingsModal extends Modal {
  private cols: number; private rows: number;
  private onSave: (cols: number, rows: number) => void;
  constructor(app: any, cols: number, rows: number, onSave: (cols: number, rows: number) => void) {
    super(app); this.cols = cols; this.rows = rows; this.onSave = onSave;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Grid size" });
    new Setting(contentEl).setName("Columns").addText((t) => { t.inputEl.type = "number"; t.setValue(String(this.cols)); t.onChange((v) => this.cols = Math.max(4, Math.min(120, parseInt(v) || this.cols))); });
    new Setting(contentEl).setName("Rows").addText((t) => { t.inputEl.type = "number"; t.setValue(String(this.rows)); t.onChange((v) => this.rows = Math.max(4, Math.min(120, parseInt(v) || this.rows))); });
    const presets = contentEl.createDiv();
    presets.style.cssText = "display:flex;gap:6px;margin:8px 0";
    for (const [label, c, r] of [["Small 16×12", 16, 12], ["Medium 24×18", 24, 18], ["Large 36×28", 36, 28]] as [string, number, number][]) {
      const b = presets.createEl("button", { text: label });
      b.style.cssText = "font-size:12px;padding:4px 8px";
      b.onclick = () => { this.cols = c; this.rows = r; this.onSave(c, r); this.close(); };
    }
    new Setting(contentEl)
      .addButton((b) => b.setButtonText("Cancel").onClick(() => this.close()))
      .addButton((b) => b.setButtonText("Apply").setCta().onClick(() => { this.onSave(this.cols, this.rows); this.close(); }));
  }
  onClose(): void { this.contentEl.empty(); }
}

interface ExportOpts { format: "png" | "pdf"; level: number; unit: "inch" | "mm"; layout: "fit" | "tile"; page: "a4" | "letter"; }

class ExportModal extends Modal {
  private levelCount: number;
  private onExport: (opts: ExportOpts) => void;
  private opts: ExportOpts = { format: "pdf", level: 0, unit: "inch", layout: "tile", page: "letter" };
  constructor(app: any, levelCount: number, onExport: (opts: ExportOpts) => void) {
    super(app); this.levelCount = levelCount; this.onExport = onExport;
  }
  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("ttrpg-export-modal");
    const existing = document.getElementById("ttrpg-export-modal-style");
    if (existing) existing.remove();
    const style = document.createElement("style");
    style.id = "ttrpg-export-modal-style";
    style.textContent = `
      .ttrpg-export-modal .setting-item {
        border-top: none !important;
        padding: 10px 0;
        align-items: center;
      }
      .ttrpg-export-modal .setting-item + .setting-item {
        border-top: 0.5px solid var(--background-modifier-border) !important;
      }
      .ttrpg-export-modal .setting-item-info { margin-right: 16px; }
      .ttrpg-export-modal .setting-item-name { font-size: 13px; font-weight: 500; }
      .ttrpg-export-modal .setting-item-description { font-size: 11px; line-height: 1.4; margin-top: 2px; }
      .ttrpg-export-modal .setting-item-control { flex: 0 0 auto; }
      .ttrpg-export-modal .setting-item-control select { min-width: 180px; }
      .ttrpg-export-modal .ttrpg-pdf-area { background: var(--background-secondary); border-radius: 8px; padding: 4px 12px; margin-top: 8px; }
      .ttrpg-export-modal .ttrpg-pdf-area .setting-item:first-child { border-top: none !important; }
    `;
    document.head.appendChild(style);

    contentEl.createEl("h3", { text: "Export map" }).style.cssText = "margin:0 0 4px";
    contentEl.createEl("p", { text: "Save a PNG image, or a print-ready PDF where each square is a real-world inch or 25 mm." })
      .style.cssText = "font-size:12px;color:var(--text-muted);margin:0 0 8px;line-height:1.4";

    new Setting(contentEl).setName("Level").addDropdown((d) => {
      for (let i = 0; i < this.levelCount; i++) d.addOption(String(i), `Level ${i + 1}`);
      if (this.levelCount > 1) d.addOption("-1", "All levels (one file each)");
      d.setValue("0"); d.onChange((v) => this.opts.level = parseInt(v));
    });
    new Setting(contentEl).setName("Format").addDropdown((d) => {
      d.addOption("pdf", "PDF — print to real scale");
      d.addOption("png", "PNG image");
      d.setValue(this.opts.format);
      d.onChange((v) => { this.opts.format = v as any; this.render2(); });
    });

    this.pdfArea = contentEl.createDiv();
    this.pdfArea.addClass("ttrpg-pdf-area");
    this.render2();

    const btnRow = contentEl.createDiv();
    btnRow.style.cssText = "display:flex;justify-content:flex-end;gap:8px;margin-top:16px";
    const cancel = btnRow.createEl("button", { text: "Cancel" });
    cancel.onclick = () => this.close();
    const exp = btnRow.createEl("button", { text: "Export" });
    exp.addClass("mod-cta");
    exp.onclick = () => { this.onExport(this.opts); this.close(); };
  }
  private pdfArea!: HTMLElement;
  private render2(): void {
    this.pdfArea.empty();
    if (this.opts.format !== "pdf") return;
    new Setting(this.pdfArea).setName("Square size").setDesc("Real-world size of each grid square").addDropdown((d) => {
      d.addOption("inch", "1 inch"); d.addOption("mm", "25 mm");
      d.setValue(this.opts.unit); d.onChange((v) => this.opts.unit = v as any);
    });
    new Setting(this.pdfArea).setName("Layout").setDesc("Tile = true scale across pages · Fit = whole map on one page").addDropdown((d) => {
      d.addOption("tile", "Tile across pages");
      d.addOption("fit", "Fit to one page");
      d.setValue(this.opts.layout); d.onChange((v) => this.opts.layout = v as any);
    });
    new Setting(this.pdfArea).setName("Page size").addDropdown((d) => {
      d.addOption("letter", "Letter"); d.addOption("a4", "A4");
      d.setValue(this.opts.page); d.onChange((v) => this.opts.page = v as any);
    });
  }
  onClose(): void {
    this.contentEl.empty();
    document.getElementById("ttrpg-export-modal-style")?.remove();
  }
}
