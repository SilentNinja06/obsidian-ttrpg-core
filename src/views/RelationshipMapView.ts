import { ItemView, WorkspaceLeaf, TFile } from "obsidian";
import type { CampaignManager } from "../engine/CampaignManager";

export const VIEW_TYPE_RELMAP = "ttrpg-relmap";

interface GraphNode {
  id: string;        // file path
  name: string;
  type: string;
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
  faction: "#C2410C",
  location: "#1D9E75",
  history: "#7C3AED",
  item: "#BA7517",
  note: "#888888",
};

const TYPE_ICONS: Record<string, string> = {
  character: "👤",
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
  private filterTypes = new Set(["character", "faction", "location"]);

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
      const type = (cache?.frontmatter?.["ttrpg-type"] as string) ?? "note";
      if (!this.filterTypes.has(type)) continue;
      const node: GraphNode = {
        id: file.path,
        name: file.basename,
        type,
        x: 400 + (Math.random() - 0.5) * 300,
        y: 300 + (Math.random() - 0.5) * 300,
        vx: 0, vy: 0, fixed: false,
      };
      this.nodes.push(node);
      nodeMap.set(file.path, node);
    }

    // Build edges from resolved links
    // @ts-ignore
    const resolved = this.app.metadataCache.resolvedLinks as Record<string, Record<string, number>>;
    const seen = new Set<string>();
    for (const [sourcePath, links] of Object.entries(resolved)) {
      if (!nodeMap.has(sourcePath)) continue;
      for (const targetPath of Object.keys(links)) {
        if (!nodeMap.has(targetPath)) continue;
        const key = [sourcePath, targetPath].sort().join("|");
        if (seen.has(key)) continue;
        seen.add(key);

        // Try to find a label from the source's relationships frontmatter
        let label: string | undefined;
        const cache = this.app.metadataCache.getFileCache(
          this.app.vault.getFileByPath(sourcePath) as TFile
        );
        const rels = cache?.frontmatter?.relationships;
        if (Array.isArray(rels)) {
          const targetName = nodeMap.get(targetPath)?.name ?? "";
          const match = rels.find((r: string) => typeof r === "string" && r.includes(targetName));
          if (match) {
            const m = String(match).match(/\((ally|enemy|family|contact|rival|mentor)\)/i);
            if (m) label = m[1];
          }
        }
        this.edges.push({ source: sourcePath, target: targetPath, label });
      }
    }

    this.runSimulation();
  }

  private runSimulation(): void {
    // Simple force-directed layout, run synchronously for a fixed number of ticks
    for (let tick = 0; tick < 300; tick++) {
      // Repulsion
      for (let i = 0; i < this.nodes.length; i++) {
        for (let j = i + 1; j < this.nodes.length; j++) {
          const a = this.nodes[i], b = this.nodes[j];
          let dx = a.x - b.x, dy = a.y - b.y;
          let dist = Math.sqrt(dx * dx + dy * dy) || 1;
          const force = 4000 / (dist * dist);
          const fx = (dx / dist) * force, fy = (dy / dist) * force;
          a.vx += fx; a.vy += fy;
          b.vx -= fx; b.vy -= fy;
        }
      }
      // Attraction along edges
      for (const edge of this.edges) {
        const a = this.nodes.find((n) => n.id === edge.source);
        const b = this.nodes.find((n) => n.id === edge.target);
        if (!a || !b) continue;
        let dx = b.x - a.x, dy = b.y - a.y;
        let dist = Math.sqrt(dx * dx + dy * dy) || 1;
        const force = (dist - 120) * 0.02;
        const fx = (dx / dist) * force, fy = (dy / dist) * force;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
      // Centering + damping
      for (const n of this.nodes) {
        n.vx += (400 - n.x) * 0.001;
        n.vy += (300 - n.y) * 0.001;
        n.vx *= 0.85; n.vy *= 0.85;
        if (!n.fixed) { n.x += n.vx; n.y += n.vy; }
      }
    }
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

    for (const [type, label] of [["character", "Characters"], ["faction", "Factions"], ["location", "Locations"], ["history", "History"], ["item", "Items"]] as [string, string][]) {
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

    const popBtn = toolbar.createEl("button", { text: "⤢ Pop out" });
    popBtn.style.cssText = "margin-left:auto;font-size:12px;padding:3px 8px";
    popBtn.onclick = () => this.app.workspace.moveLeafToPopout(this.leaf);

    if (this.nodes.length === 0) {
      container.createEl("p", { text: "No linked notes yet. Add [[wikilinks]] between your characters, factions, and locations to see connections here.", cls: "ttrpg-muted" })
        .style.cssText = "padding:1rem;font-size:13px;color:var(--color-text-tertiary)";
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
      line.setAttribute("stroke", "var(--color-border-secondary)");
      line.setAttribute("stroke-width", "1.5");
      this.svg.appendChild(line);

      if (edge.label) {
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const text = document.createElementNS(svgNS, "text");
        text.setAttribute("x", String(mx));
        text.setAttribute("y", String(my));
        text.setAttribute("text-anchor", "middle");
        text.setAttribute("font-size", "10");
        text.setAttribute("fill", "var(--color-text-tertiary)");
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
      circle.setAttribute("fill", (TYPE_COLORS[node.type] ?? "#888") + "33");
      circle.setAttribute("stroke", TYPE_COLORS[node.type] ?? "#888");
      circle.setAttribute("stroke-width", "1.5");
      g.appendChild(circle);

      const icon = document.createElementNS(svgNS, "text");
      icon.setAttribute("text-anchor", "middle");
      icon.setAttribute("dy", "5");
      icon.setAttribute("font-size", "16");
      icon.textContent = TYPE_ICONS[node.type] ?? "📄";
      g.appendChild(icon);

      const label = document.createElementNS(svgNS, "text");
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("dy", "38");
      label.setAttribute("font-size", "11");
      label.setAttribute("fill", "var(--color-text-primary)");
      label.textContent = node.name;
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
