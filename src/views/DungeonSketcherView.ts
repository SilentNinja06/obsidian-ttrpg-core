import { ItemView, WorkspaceLeaf, TFile, Notice, FuzzySuggestModal, normalizePath } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import { promptText, confirmAction } from "../modals/InputModal";

export const VIEW_TYPE_DUNGEON = "ttrpg-dungeon";

// ── Extensible palettes ─────────────────────────────────────────────────────
// Add new cell fills or edge types here; the UI and renderer pick them up.
interface CellTool { id: string; label: string; icon: string; color: string; special?: "stairs" | "water"; }
interface EdgeTool { id: string; label: string; icon: string; color: string; door?: boolean; }

const CELL_TOOLS: CellTool[] = [
  { id: "floor", label: "Floor", icon: "▦", color: "#d9cdb8" },
  { id: "water", label: "Water", icon: "≈", color: "#7fa8c9", special: "water" },
  { id: "stairs", label: "Stairs", icon: "▤", color: "#c2b89c", special: "stairs" },
];
const EDGE_TOOLS: EdgeTool[] = [
  { id: "wall", label: "Wall", icon: "▬", color: "#2b2b2b" },
  { id: "door", label: "Door", icon: "🚪", color: "#8a5a2b", door: true },
];

interface DungeonMap {
  name: string;
  cols: number;
  rows: number;
  cell: number;
  cells: Record<string, string>;  // "x,y" -> cell tool id
  edges: Record<string, string>;  // "x,y,h" | "x,y,v" -> edge tool id
}

export class DungeonSketcherView extends ItemView {
  private campaignManager: CampaignManager;
  private campaignsFolder: string;

  private map: DungeonMap = this.blankMap();
  private activeTool = "floor";
  private toolKind: "cell" | "edge" | "erase" = "cell";
  private svg: SVGSVGElement | null = null;
  private viewBox = { x: -20, y: -20, w: 840, h: 680 };
  private painting = false;
  private panning = false;
  private panStart = { x: 0, y: 0 };
  private currentFile: TFile | null = null;

  constructor(leaf: WorkspaceLeaf, campaignManager: CampaignManager, campaignsFolder: string) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_DUNGEON; }
  getDisplayText(): string { return this.map.name || "Dungeon Sketcher"; }
  getIcon(): string { return "pencil"; }

  async onOpen(): Promise<void> { this.render(); }

  private blankMap(): DungeonMap {
    return { name: "Untitled dungeon", cols: 24, rows: 18, cell: 32, cells: {}, edges: {} };
  }

  private mapsFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}/maps/dungeons`;
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.cssText = "display:flex;flex-direction:column;height:100%;font-family:var(--font-interface)";

    // Toolbar
    const bar = container.createDiv();
    bar.style.cssText = "display:flex;align-items:center;gap:6px;padding:8px 12px;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap";

    const nameInput = bar.createEl("input");
    nameInput.value = this.map.name;
    nameInput.style.cssText = "font-size:13px;font-weight:600;padding:3px 7px;background:var(--background-primary);color:var(--text-normal);border:0.5px solid var(--color-border-secondary);border-radius:6px;max-width:160px";
    nameInput.onchange = () => { this.map.name = nameInput.value || "Untitled dungeon"; };

    const sep = () => { const s = bar.createSpan(); s.style.cssText = "width:1px;height:20px;background:var(--color-border-tertiary);margin:0 2px"; };
    sep();

    // Cell tools
    for (const t of CELL_TOOLS) this.toolButton(bar, t.icon, t.label, "cell", t.id, t.color);
    sep();
    // Edge tools
    for (const t of EDGE_TOOLS) this.toolButton(bar, t.icon, t.label, "edge", t.id, t.color);
    sep();
    // Eraser
    this.toolButton(bar, "✕", "Erase", "erase", "erase", "#cc5555");
    sep();

    const actions = bar.createDiv();
    actions.style.cssText = "display:flex;gap:5px;margin-left:auto;flex-wrap:wrap";
    const mk = (label: string, fn: () => void) => {
      const b = actions.createEl("button", { text: label });
      b.style.cssText = "font-size:12px;padding:3px 9px";
      b.onclick = fn;
      return b;
    };
    mk("New", async () => {
      const hasWork = Object.keys(this.map.cells).length > 0 || Object.keys(this.map.edges).length > 0;
      if (hasWork) {
        const ok = await confirmAction(this.app, "New dungeon", "Start a new dungeon? Any unsaved changes to the current one will be lost.", "New dungeon", true);
        if (!ok) return;
      }
      this.newMap();
    });
    mk("Save", () => this.save());
    mk("Load", () => this.loadMap());
    mk("Export PNG", () => this.exportPng());
    mk("Clear", async () => {
      const hasWork = Object.keys(this.map.cells).length > 0 || Object.keys(this.map.edges).length > 0;
      if (!hasWork) return;
      const ok = await confirmAction(this.app, "Clear dungeon", "Erase everything on the current map? This can't be undone (but won't affect saved copies).", "Clear", true);
      if (ok) { this.map.cells = {}; this.map.edges = {}; this.draw(); }
    });

    // Hint
    const hint = container.createDiv();
    hint.style.cssText = "font-size:11px;color:var(--color-text-tertiary);padding:3px 12px";
    hint.setText("Click/drag to paint. Scroll to zoom. Shift+drag to pan.");

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

  private toolButton(bar: HTMLElement, icon: string, label: string, kind: "cell" | "edge" | "erase", id: string, color: string): void {
    const active = (kind === "erase" && this.toolKind === "erase") || (this.toolKind === kind && this.activeTool === id);
    const btn = bar.createEl("button", { text: `${icon}` });
    btn.title = label;
    btn.style.cssText = `font-size:14px;padding:3px 8px;cursor:pointer;border-radius:6px;border:0.5px solid ${active ? color : "var(--color-border-secondary)"};background:${active ? color + "22" : "transparent"};color:var(--text-normal)`;
    btn.onclick = () => { this.toolKind = kind; this.activeTool = id; this.render(); };
  }

  private updateViewBox(): void {
    if (this.svg) this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  private draw(): void {
    if (!this.svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    this.svg.empty();
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;

    // Board background
    const bg = document.createElementNS(svgNS, "rect");
    bg.setAttribute("x", "0"); bg.setAttribute("y", "0");
    bg.setAttribute("width", String(W)); bg.setAttribute("height", String(H));
    bg.setAttribute("fill", "#f3efe6");
    this.svg.appendChild(bg);

    // Painted cells
    for (const [key, toolId] of Object.entries(this.map.cells)) {
      const [x, y] = key.split(",").map(Number);
      const tool = CELL_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      const rect = document.createElementNS(svgNS, "rect");
      rect.setAttribute("x", String(x * cs)); rect.setAttribute("y", String(y * cs));
      rect.setAttribute("width", String(cs)); rect.setAttribute("height", String(cs));
      rect.setAttribute("fill", tool.color);
      this.svg.appendChild(rect);
      if (tool.special === "stairs") {
        for (let i = 1; i < 5; i++) {
          const ln = document.createElementNS(svgNS, "line");
          ln.setAttribute("x1", String(x * cs)); ln.setAttribute("y1", String(y * cs + (cs / 5) * i));
          ln.setAttribute("x2", String(x * cs + cs)); ln.setAttribute("y2", String(y * cs + (cs / 5) * i));
          ln.setAttribute("stroke", "#8a7f63"); ln.setAttribute("stroke-width", "1.5");
          this.svg.appendChild(ln);
        }
      } else if (tool.special === "water") {
        for (let i = 1; i < 3; i++) {
          const wl = document.createElementNS(svgNS, "path");
          const yy = y * cs + (cs / 3) * i;
          wl.setAttribute("d", `M ${x*cs} ${yy} q ${cs/4} -5 ${cs/2} 0 t ${cs/2} 0`);
          wl.setAttribute("fill", "none"); wl.setAttribute("stroke", "#5d8bb0"); wl.setAttribute("stroke-width", "1.2");
          this.svg.appendChild(wl);
        }
      }
    }

    // Grid lines
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

    // Edges (walls/doors)
    for (const [key, toolId] of Object.entries(this.map.edges)) {
      const tool = EDGE_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      const [xs, ys, dir] = key.split(",");
      const x = Number(xs), y = Number(ys);
      let x1 = x * cs, y1 = y * cs, x2 = x * cs, y2 = y * cs;
      if (dir === "h") { x2 = x * cs + cs; } else { y2 = y * cs + cs; }
      if (tool.door) {
        // door: lighter base line + a centered door rectangle
        const base = document.createElementNS(svgNS, "line");
        base.setAttribute("x1", String(x1)); base.setAttribute("y1", String(y1));
        base.setAttribute("x2", String(x2)); base.setAttribute("y2", String(y2));
        base.setAttribute("stroke", "#2b2b2b"); base.setAttribute("stroke-width", "4"); base.setAttribute("stroke-linecap", "round");
        this.svg.appendChild(base);
        const mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
        const door = document.createElementNS(svgNS, "rect");
        const dw = cs * 0.5;
        if (dir === "h") { door.setAttribute("x", String(mx - dw / 2)); door.setAttribute("y", String(my - 3)); door.setAttribute("width", String(dw)); door.setAttribute("height", "6"); }
        else { door.setAttribute("x", String(mx - 3)); door.setAttribute("y", String(my - dw / 2)); door.setAttribute("width", "6"); door.setAttribute("height", String(dw)); }
        door.setAttribute("fill", tool.color);
        this.svg.appendChild(door);
      } else {
        const ln = document.createElementNS(svgNS, "line");
        ln.setAttribute("x1", String(x1)); ln.setAttribute("y1", String(y1));
        ln.setAttribute("x2", String(x2)); ln.setAttribute("y2", String(y2));
        ln.setAttribute("stroke", tool.color); ln.setAttribute("stroke-width", "5"); ln.setAttribute("stroke-linecap", "round");
        this.svg.appendChild(ln);
      }
    }
  }

  private attach(svg: SVGSVGElement): void {
    const toUser = (clientX: number, clientY: number) => {
      const r = svg.getBoundingClientRect();
      return {
        x: this.viewBox.x + ((clientX - r.left) / r.width) * this.viewBox.w,
        y: this.viewBox.y + ((clientY - r.top) / r.height) * this.viewBox.h,
      };
    };

    svg.addEventListener("mousedown", (e) => {
      if (e.shiftKey || e.button === 1) {
        this.panning = true; this.panStart = { x: e.clientX, y: e.clientY }; svg.style.cursor = "grabbing";
        return;
      }
      this.painting = true;
      this.paintAt(toUser(e.clientX, e.clientY));
    });
    svg.addEventListener("mousemove", (e) => {
      if (this.panning) {
        const scale = this.viewBox.w / svg.clientWidth;
        this.viewBox.x -= (e.clientX - this.panStart.x) * scale;
        this.viewBox.y -= (e.clientY - this.panStart.y) * scale;
        this.panStart = { x: e.clientX, y: e.clientY };
        this.updateViewBox();
      } else if (this.painting) {
        this.paintAt(toUser(e.clientX, e.clientY));
      }
    });
    const end = () => { this.painting = false; this.panning = false; svg.style.cursor = "crosshair"; };
    svg.addEventListener("mouseup", end);
    svg.addEventListener("mouseleave", end);
    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const f = e.deltaY > 0 ? 1.1 : 0.9;
      const p = toUser(e.clientX, e.clientY);
      this.viewBox.x = p.x - (p.x - this.viewBox.x) * f;
      this.viewBox.y = p.y - (p.y - this.viewBox.y) * f;
      this.viewBox.w *= f; this.viewBox.h *= f;
      this.updateViewBox();
    }, { passive: false });
  }

  private paintAt(p: { x: number; y: number }): void {
    const cs = this.map.cell;
    const cx = Math.floor(p.x / cs), cy = Math.floor(p.y / cs);
    if (cx < 0 || cy < 0 || cx >= this.map.cols || cy >= this.map.rows) return;

    if (this.toolKind === "cell") {
      this.map.cells[`${cx},${cy}`] = this.activeTool;
    } else if (this.toolKind === "edge") {
      const fx = p.x / cs - cx, fy = p.y / cs - cy;
      const dTop = fy, dBottom = 1 - fy, dLeft = fx, dRight = 1 - fx;
      const min = Math.min(dTop, dBottom, dLeft, dRight);
      let key: string;
      if (min === dTop) key = `${cx},${cy},h`;
      else if (min === dBottom) key = `${cx},${cy + 1},h`;
      else if (min === dLeft) key = `${cx},${cy},v`;
      else key = `${cx + 1},${cy},v`;
      this.map.edges[key] = this.activeTool;
    } else {
      // erase: remove cell and any nearby edge
      delete this.map.cells[`${cx},${cy}`];
      const fx = p.x / cs - cx, fy = p.y / cs - cy;
      const dTop = fy, dBottom = 1 - fy, dLeft = fx, dRight = 1 - fx;
      const min = Math.min(dTop, dBottom, dLeft, dRight);
      if (min < 0.25) {
        let key: string;
        if (min === dTop) key = `${cx},${cy},h`;
        else if (min === dBottom) key = `${cx},${cy + 1},h`;
        else if (min === dLeft) key = `${cx},${cy},v`;
        else key = `${cx + 1},${cy},v`;
        delete this.map.edges[key];
      }
    }
    this.draw();
  }

  private newMap(): void {
    this.map = this.blankMap();
    this.currentFile = null;
    this.render();
  }

  private async save(): Promise<void> {
    const id = this.campaignManager.getActiveId();
    if (!id) { new Notice("No active campaign."); return; }
    const folder = normalizePath(this.mapsFolder());
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const slug = this.map.name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "dungeon";
    const path = normalizePath(`${folder}/${slug}.json`);
    const data = JSON.stringify(this.map, null, 2);
    const existing = this.app.vault.getFileByPath(path);
    if (existing instanceof TFile) await this.app.vault.modify(existing, data);
    else this.currentFile = await this.app.vault.create(path, data);
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
        this.map = JSON.parse(raw);
        this.currentFile = file;
        this.render();
        new Notice(`Loaded "${this.map.name}"`);
      } catch { new Notice("Could not read that dungeon file."); }
    }).open();
  }

  private async exportPng(): Promise<void> {
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    const pad = 16;
    // Build a standalone SVG string sized to the full board
    const svgStr = this.buildStandaloneSvg(W + pad * 2, H + pad * 2, pad);
    const blob = new Blob([svgStr], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("render failed"));
      img.src = url;
    });
    const scale = 2; // crisper export
    const canvas = document.createElement("canvas");
    canvas.width = (W + pad * 2) * scale;
    canvas.height = (H + pad * 2) * scale;
    const ctx = canvas.getContext("2d")!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    const dataUrl = canvas.toDataURL("image/png");
    const bytes = Uint8Array.from(atob(dataUrl.split(",")[1]), (c) => c.charCodeAt(0));
    const folder = normalizePath(this.mapsFolder());
    if (!this.app.vault.getFolderByPath(folder)) await this.app.vault.createFolder(folder).catch(() => {});
    const slug = this.map.name.toLowerCase().replace(/\s+/g, "-").replace(/[^\w-]/g, "") || "dungeon";
    const path = normalizePath(`${folder}/${slug}.png`);
    const existing = this.app.vault.getFileByPath(path);
    let file: TFile;
    if (existing instanceof TFile) { await this.app.vault.modifyBinary(existing, bytes.buffer); file = existing; }
    else file = await this.app.vault.createBinary(path, bytes.buffer);
    new Notice(`Exported ${file.name}`);
    this.app.workspace.getLeaf(true).openFile(file);
  }

  private buildStandaloneSvg(totalW: number, totalH: number, pad: number): string {
    const cs = this.map.cell;
    const W = this.map.cols * cs, H = this.map.rows * cs;
    const parts: string[] = [];
    parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${totalW}" height="${totalH}" viewBox="0 0 ${totalW} ${totalH}">`);
    parts.push(`<rect x="0" y="0" width="${totalW}" height="${totalH}" fill="#ffffff"/>`);
    parts.push(`<g transform="translate(${pad},${pad})">`);
    parts.push(`<rect x="0" y="0" width="${W}" height="${H}" fill="#f3efe6"/>`);
    for (const [key, toolId] of Object.entries(this.map.cells)) {
      const [x, y] = key.split(",").map(Number);
      const tool = CELL_TOOLS.find((t) => t.id === toolId);
      if (!tool) continue;
      parts.push(`<rect x="${x*cs}" y="${y*cs}" width="${cs}" height="${cs}" fill="${tool.color}"/>`);
      if (tool.special === "stairs") for (let i = 1; i < 5; i++) parts.push(`<line x1="${x*cs}" y1="${y*cs+(cs/5)*i}" x2="${x*cs+cs}" y2="${y*cs+(cs/5)*i}" stroke="#8a7f63" stroke-width="1.5"/>`);
    }
    for (let x = 0; x <= this.map.cols; x++) parts.push(`<line x1="${x*cs}" y1="0" x2="${x*cs}" y2="${H}" stroke="#cbc3b2" stroke-width="0.5"/>`);
    for (let y = 0; y <= this.map.rows; y++) parts.push(`<line x1="0" y1="${y*cs}" x2="${W}" y2="${y*cs}" stroke="#cbc3b2" stroke-width="0.5"/>`);
    for (const [key, toolId] of Object.entries(this.map.edges)) {
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
    parts.push(`</g></svg>`);
    return parts.join("");
  }
}

class DungeonPickerModal extends FuzzySuggestModal<TFile> {
  private files: TFile[];
  private onPick: (f: TFile) => void;
  constructor(app: any, files: TFile[], onPick: (f: TFile) => void) {
    super(app);
    this.files = files;
    this.onPick = onPick;
    this.setPlaceholder("Load a saved dungeon…");
  }
  getItems(): TFile[] { return this.files; }
  getItemText(f: TFile): string { return f.basename; }
  onChooseItem(f: TFile): void { this.onPick(f); }
}
