import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";
import { parseRelationship } from "../utils/relationships";

export const VIEW_TYPE_RELMAP = "ttrpg-relmap";

interface GraphNode {
  id: string;        // file path
  name: string;
  type: string;      // ttrpg-type (character/faction/location/history/item)
  subtype: string;   // for filtering/coloring: pc/npc/fodder, or same as type
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

const TYPE_COLORS: Record<string, string> = {
  character: "#378ADD",
  pc: "#2563C9",
  npc: "#5B8DB8",
  fodder: "#9AA7B0",
  faction: "#C2410C",
  location: "#1D9E75",
  history: "#7C3AED",
  item: "#BA7517",
  note: "#888888",
};

const TYPE_ICONS: Record<string, string> = {
  character: "👤",
  pc: "🛡️",
  npc: "👤",
  fodder: "💀",
  faction: "⚔️",
  location: "🏰",
  history: "📜",
  item: "⚗️",
};

export class RelationshipMapView extends ItemView {
  private campaignManager: CampaignManager;
  private campaignsFolder: string;

  private nodes: GraphNode[] = [];
  private edges: GraphEdge[] = [];
  private filterTypes = new Set(["pc", "npc", "faction", "location", "item"]);
  private hideUnconnected = true;

  private svg: SVGSVGElement | null = null;
  private viewBox = { x: 0, y: 0, w: 800, h: 600 };
  private animationFrame = 0;
  private dragNode: GraphNode | null = null;

  constructor(leaf: WorkspaceLeaf, campaignManager: CampaignManager, campaignsFolder: string) {
    super(leaf);
    this.campaignManager = campaignManager;
    this.campaignsFolder = campaignsFolder;
  }

  getViewType(): string { return VIEW_TYPE_RELMAP; }
  getDisplayText(): string { return "Relationship Map"; }
  getIcon(): string { return "git-fork"; }

  async onOpen(): Promise<void> {
    await this.build();
    this.render();
  }

  async onClose(): Promise<void> {
    if (this.animationFrame) cancelAnimationFrame(this.animationFrame);
  }

  private campaignFolder(): string {
    return `${this.campaignsFolder}/${this.campaignManager.getActiveId()}`;
  }

  private async build(): Promise<void> {
    this.nodes = [];
    this.edges = [];
    const folder = this.campaignFolder();
    const id = this.campaignManager.getActiveId();
    if (!id) return;

    const files = this.app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(folder));
    const nodeMap = new Map<string, GraphNode>();

    // Build nodes
    for (const file of files) {
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      const type = (fm?.["ttrpg-type"] as string) ?? "note";

      // Compute subtype for characters: pc / npc (story) / fodder
      let subtype = type;
      if (type === "character") {
        const tags = (fm?.tags as string[]) ?? [];
        if (file.path.includes("/pcs/") || tags.includes("pc")) subtype = "pc";
        else if (file.path.includes("/fodder/") || tags.includes("fodder")) subtype = "fodder";
        else subtype = "npc";
      }

      // Filter by subtype for characters, by type otherwise
      const filterKey = type === "character" ? subtype : type;
      if (!this.filterTypes.has(filterKey)) continue;

      const node: GraphNode = {
        id: file.path,
        name: file.basename,
        type,
        subtype,
        x: 400 + (Math.random() - 0.5) * 300,
        y: 300 + (Math.random() - 0.5) * 300,
        vx: 0, vy: 0, fixed: false,
      };
      this.nodes.push(node);
      nodeMap.set(file.path, node);
    }

    // Build a name → node lookup for resolving relationship targets
    const byName = new Map<string, GraphNode>();
    for (const node of this.nodes) byName.set(node.name.toLowerCase(), node);

    const seen = new Set<string>();
    const addEdge = (a: GraphNode, b: GraphNode, label?: string) => {
      if (a.id === b.id) return;
      const key = [a.id, b.id].sort().join("|");
      if (seen.has(key)) return;
      seen.add(key);
      this.edges.push({ source: a.id, target: b.id, label });
    };

    // 1) Structured relationships from frontmatter (the source of truth the UI writes)
    for (const file of files) {
      const node = nodeMap.get(file.path);
      if (!node) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const fm = cache?.frontmatter;
      if (!fm) continue;

      const rels = fm.relationships;
      if (Array.isArray(rels)) {
        for (const r of rels) {
          if (typeof r !== "string") continue;
          const parsed = parseRelationship(r);
          const target = byName.get(parsed.target.toLowerCase());
          if (target) addEdge(node, target, parsed.label || undefined);
        }
      }

      // 2) Item → holder edges
      if (node.type === "item") {
        const heldBy = (fm["held-by"] as string) || "";
        if (heldBy) {
          const holder = byName.get(heldBy.toLowerCase());
          if (holder) addEdge(node, holder, "held by");
        }
      }
    }

    // 3) Body wikilinks as a supplementary source
    // @ts-ignore
    const resolved = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    for (const [sourcePath, links] of Object.entries(resolved)) {
      const a = nodeMap.get(sourcePath);
      if (!a) continue;
      for (const targetPath of Object.keys(links)) {
        const b = nodeMap.get(targetPath);
        if (!b) continue;
        addEdge(a, b);
      }
    }

    // Optionally drop nodes that have no edges, to focus the graph
    if (this.hideUnconnected) {
      const connected = new Set<string>();
      for (const e of this.edges) { connected.add(e.source); connected.add(e.target); }
      this.nodes = this.nodes.filter((n) => connected.has(n.id));
    }

    this.runSimulation();
  }

  private runSimulation(): void {
    // Simple force-directed layout, run synchronously for a fixed number of ticks
    for (let tick = 0; tick < 400; tick++) {
      // Repulsion
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          const a = this.nodes[i], b = this.nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 6500 / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      // Attraction along edges (pulls connected nodes to a comfortable distance)
      for (const edge of this.edges) {
        const a = this.nodes.find((n) => n.id === edge.source);
        const b = this.nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 110) * 0.035;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      // Centering + damping
      for (const n of this.nodes) {
        n.vx += (400 - n.x) * 0.004;
        n.vy += (300 - n.y) * 0.004;
        n.vx *= 0.85; n.vy *= 0.85;
        if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
      }
    }
    // Fit the viewBox to the resulting layout so it's framed nicely
    this.fitViewBox();
  }

  private fitViewBox(): void {
    if (this.nodes.length === 0) return;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of this.nodes) {
      minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y); maxY = Math.max(maxY, n.y);
    }
    const pad = 80;
    this.viewBox = {
      x: minX - pad,
      y: minY - pad,
      w: Math.max(300, maxX - minX + pad * 2),
      h: Math.max(240, maxY - minY + pad * 2),
    };
    if (this.svg) this.updateViewBox();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.style.cssText = "padding:0;overflow:hidden;font-family:var(--font-sans);height:100%;display:flex;flex-direction:column";

    const campaign = this.campaignManager.getActive();
    if (!campaign) {
      container.createEl("p", { text: "No active campaign.", cls: "ttrpg-muted" }).style.padding = "1rem";
      return;
    }

    // Toolbar
    const toolbar = container.createDiv();
    toolbar.style.cssText = "display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap";
    toolbar.createSpan({ text: "Relationship map" }).style.cssText = "font-size:14px;font-weight:600";

    for (const [type, label] of [["pc", "PCs"], ["npc", "Story NPCs"], ["fodder", "Fodder"], ["faction", "Factions"], ["location", "Locations"], ["history", "History"], ["item", "Items"]] as [string, string][]) {
      const btn = toolbar.createEl("button", { text: TYPE_ICONS[type] + " " + label });
      const active = this.filterTypes.has(type);
      btn.style.cssText = `font-size:12px;padding:3px 8px;cursor:pointer;border-radius:8px;border:0.5px solid var(--color-border-secondary);background:${active ? TYPE_COLORS[type] + "22" : "transparent"};color:${active ? "var(--text-normal)" : "var(--text-muted)"}`;
      btn.onclick = async () => {
        if (this.filterTypes.has(type)) this.filterTypes.delete(type);
        else this.filterTypes.add(type);
        await this.build();
        this.render();
      };
    }

    // ── View controls on their own clearly-visible row ──
    const controls = container.createDiv();
    controls.style.cssText = "display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:0.5px solid var(--color-border-tertiary);flex-wrap:wrap";

    const hideBtn = controls.createEl("button", { text: this.hideUnconnected ? "🔗 Showing linked only" : "👁 Showing all notes" });
    hideBtn.style.cssText = `font-size:12px;padding:4px 10px;font-weight:500;border-radius:8px;cursor:pointer;border:0.5px solid var(--interactive-accent);background:${this.hideUnconnected ? "var(--interactive-accent)" : "transparent"};color:${this.hideUnconnected ? "var(--text-on-accent)" : "var(--text-normal)"}`;
    hideBtn.title = "Toggle between showing only linked notes and every note";
    hideBtn.onclick = async () => { this.hideUnconnected = !this.hideUnconnected; await this.build(); this.render(); };

    const refreshBtn = controls.createEl("button", { text: "↻ Refresh" });
    refreshBtn.style.cssText = "font-size:12px;padding:4px 10px";
    refreshBtn.title = "Rebuild from current notes";
    refreshBtn.onclick = async () => { await this.build(); this.render(); };

    const popBtn = controls.createEl("button", { text: "⤢ Pop out" });
    popBtn.style.cssText = "margin-left:auto;font-size:12px;padding:4px 10px";
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    if (this.nodes.length === 0) {
      const msg = this.hideUnconnected
        ? "No relationships to show yet. Add relationships on your characters, factions, or locations (or assign items to holders), then hit Refresh — or click \"Show all\" to see every note."
        : "No notes in this campaign yet.";
      container.createEl("p", { text: msg, cls: "ttrpg-muted" })
        .style.cssText = "padding:1rem;font-size:13px;color:var(--color-text-tertiary);line-height:1.5";
      return;
    }

    // SVG canvas
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("width", "100%");
    svg.setAttribute("height", "100%");
    svg.style.cssText = "flex:1;cursor:grab;background:var(--color-background-primary)";
    this.svg = svg;
    this.updateViewBox();
    container.appendChild(svg);

    this.draw();
    this.attachInteraction(svg);
  }

  private updateViewBox(): void {
    if (!this.svg) return;
    this.svg.setAttribute("viewBox", `${this.viewBox.x} ${this.viewBox.y} ${this.viewBox.w} ${this.viewBox.h}`);
  }

  private draw(): void {
    if (!this.svg) return;
    const svgNS = "http://www.w3.org/2000/svg";
    this.svg.empty();

    // Edges
    for (const edge of this.edges) {
      const a = this.nodes.find((n) => n.id === edge.source);
      const b = this.nodes.find((n) => n.id === edge.target);
      if (!a || !b) continue;
      const line = document.createElementNS(svgNS, "line");
      line.setAttribute("x1", String(a.x));
      line.setAttribute("y1", String(a.y));
      line.setAttribute("x2", String(b.x));
      line.setAttribute("y2", String(b.y));
      line.setAttribute("stroke", "#8898aa");
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-opacity", "0.7");
      this.svg.appendChild(line);

      if (edge.label) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        // background pill for readability
        const padX = 4, h = 14;
        const w = edge.label.length * 5.6 + padX * 2;
        const bgRect = document.createElementNS(svgNS, "rect");
        bgRect.setAttribute("x", String(mx - w / 2));
        bgRect.setAttribute("y", String(my - h / 2));
        bgRect.setAttribute("width", String(w));
        bgRect.setAttribute("height", String(h));
        bgRect.setAttribute("rx", "7");
        bgRect.setAttribute("fill", "var(--background-primary)");
        bgRect.setAttribute("stroke", "#8898aa");
        bgRect.setAttribute("stroke-width", "0.5");
        bgRect.setAttribute("stroke-opacity", "0.5");
        this.svg.appendChild(bgRect);

        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(mx));
        text.setAttribute("y", String(my + 3.5));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "10");
        text.setAttribute("font-weight", "500");
        text.setAttribute("fill", "var(--text-normal)");
        text.textContent = edge.label;
        this.svg.appendChild(text);
      }
    }

    // Nodes
    for (const node of this.nodes) {
      const g = document.createElementNS(svgNS, "g");
      g.setAttribute("transform", `translate(${node.x},${node.y})`);
      g.style.cursor = "pointer";

      const circle = document.createElementNS(svgNS, "circle");
      circle.setAttribute("r", "22");
      circle.setAttribute("fill", (TYPE_COLORS[node.subtype] ?? "#888") + "33");
      circle.setAttribute("stroke", TYPE_COLORS[node.subtype] ?? "#888");
      circle.setAttribute("stroke-width", "1.5");
      g.appendChild(circle);

      const icon = document.createElementNS(svgNS, "text");
      icon.setAttribute("text-anchor", "middle");
      icon.setAttribute("dy", "5");
      icon.setAttribute("font-size", "16");
      icon.textContent = TYPE_ICONS[node.subtype] ?? "📄";
      g.appendChild(icon);

      const labelText = node.name;
      const lw = labelText.length * 5.8 + 8;
      const labelBg = document.createElementNS(svgNS, "rect");
      labelBg.setAttribute("x", String(-lw / 2));
      labelBg.setAttribute("y", "30");
      labelBg.setAttribute("width", String(lw));
      labelBg.setAttribute("height", "15");
      labelBg.setAttribute("rx", "4");
      labelBg.setAttribute("fill", "var(--background-primary)");
      labelBg.setAttribute("fill-opacity", "0.75");
      g.appendChild(labelBg);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dy", "41");
      label.setAttribute("font-size", "11");
      label.setAttribute("font-weight", "500");
      label.setAttribute("fill", "var(--text-normal)");
      label.textContent = labelText;
      g.appendChild(label);

      g.addEventListener("click", (e) => {
        e.stopPropagation();
        const file = this.app.vault.getFileByPath(node.id);
        if (file) this.app.workspace.getLeaf(false).openFile(file);
      });

      // Drag handling
      g.addEventListener("mousedown", (e) => {
        e.stopPropagation();
        this.dragNode = node;
        node.fixed = true;
      });

      (g as any)._node = node;
      this.svg.appendChild(g);
    }
  }

  private attachInteraction(svg: SVGSVGElement): void {
    let panning = false;
    let panStart = { x: 0, y: 0 };

    svg.addEventListener("mousedown", (e) => {
      if (this.dragNode) return;
      panning = true;
      panStart = { x: e.clientX, y: e.clientY };
      svg.style.cursor = "grabbing";
    });

    svg.addEventListener("mousemove", (e) => {
      if (this.dragNode) {
        const pt = this.clientToSvg(e.clientX, e.clientY);
        this.dragNode.x = pt.x;
        this.dragNode.y = pt.y;
        this.draw();
      } else if (panning) {
        const scale = this.viewBox.w / svg.clientWidth;
        this.viewBox.x -= (e.clientX - panStart.x) * scale;
        this.viewBox.y -= (e.clientY - panStart.y) * scale;
        panStart = { x: e.clientX, y: e.clientY };
        this.updateViewBox();
      }
    });

    const end = () => {
      if (this.dragNode) this.dragNode.fixed = false;
      this.dragNode = null;
      panning = false;
      svg.style.cursor = "grab";
    };
    svg.addEventListener("mouseup", end);
    svg.addEventListener("mouseleave", end);

    svg.addEventListener("wheel", (e) => {
      e.preventDefault();
      const factor = e.deltaY > 0 ? 1.1 : 0.9;
      const pt = this.clientToSvg(e.clientX, e.clientY);
      this.viewBox.x = pt.x - (pt.x - this.viewBox.x) * factor;
      this.viewBox.y = pt.y - (pt.y - this.viewBox.y) * factor;
      this.viewBox.w *= factor;
      this.viewBox.h *= factor;
      this.updateViewBox();
    });
  }

  private clientToSvg(clientX: number, clientY: number): { x: number; y: number } {
    if (!this.svg) return { x: 0, y: 0 };
    const rect = this.svg.getBoundingClientRect();
    const x = this.viewBox.x + ((clientX - rect.left) / rect.width) * this.viewBox.w;
    const y = this.viewBox.y + ((clientY - rect.top) / rect.height) * this.viewBox.h;
    return { x, y };
  }
}
