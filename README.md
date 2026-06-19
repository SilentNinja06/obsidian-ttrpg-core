# TTRPG Campaign Manager

An Obsidian plugin for running tabletop RPG campaigns — lore, characters, sessions, combat, inventory, NPCs, loot, maps, and PDF recaps — with system pack support for D&D 5e, Warhammer 40k, and any custom system you define in a YAML schema.

> **Desktop only.** This plugin uses desktop features (PDF generation, PNG map export) and is not supported on Obsidian mobile.

## What it does

- **Campaign dashboard** — party status, open threads, unassigned loot, and quick actions grouped by what you're doing (at the table / prep & reference / quick create). Switch or create campaigns from one click.
- **Character sheets** — stat blocks, HP, conditions, inventory/loadout, combat log, relationships, and arc notes. Everything is click-to-edit and saves to the note's frontmatter.
- **Session notes** — capture mode for live play, write-up mode afterwards.
- **Lore pages** — locations, factions, history, and items in one adaptive layout, with automatic backlinks and editable relationships.
- **Combat tracker** — initiative order, HP that writes back to character sheets, damage/heal logging, a dice roller, condition pills with a reference popover, save/load encounters, and roll-NPC-initiative.
- **NPC generator** — single or batch, archetype-weighted stats clamped to the system's range, random names from a large pool, and story-critical vs. fodder routing. Drops straight into combat if you want.
- **Loot & equipment** — a distribution tool that assigns loot to characters or a party stash, currency splitting, and a full item lifecycle (held / stashed / lost / stolen / destroyed / damaged) with a state log.
- **Relationship map** — an interactive force-directed graph of characters, factions, locations, and item-holders, with PC / story-NPC / fodder filtering.
- **Timeline** — dual in-world and play-order views.
- **Dungeon sketcher** — paint floors, water, stairs, walls, and doors on a grid; save in-vault and export PNG.
- **Session recap to PDF** — generate a narrative or bulleted recap of the last session or the whole campaign, with an optional AI prose engine.

## Requirements

- Obsidian 1.4.0 or later (desktop)
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) community plugin
- (Optional) Custom system packs — D&D 5e and WH40k are bundled and auto-install

## Installation

### Manual install (recommended for sharing)

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest [release](../../releases).
2. In your vault, create the folder `.obsidian/plugins/ttrpg-core/` if it doesn't exist.
3. Copy those three files into it.
4. Install and enable the **Dataview** community plugin.
5. In Obsidian: Settings, then Community plugins, then enable **TTRPG Campaign Manager**.

That's the whole setup. The **D&D 5e and WH40k system packs install themselves automatically** the first time the plugin loads, so you can create a campaign right away.

### System packs

The bundled D&D 5e and WH40k packs are written into `ttrpg/systems/` on first run. To re-add or reset them later, use Settings → TTRPG Campaign Manager → **Starter system packs → Install / restore** (this never overwrites a pack you've customized unless you ask it to).

The canonical, independently-updatable packs live in their own repos:
- [obsidian-ttrpg-dnd5e](https://github.com/SilentNinja06/obsidian-ttrpg-dnd5e)
- [obsidian-ttrpg-wh40k](https://github.com/SilentNinja06/obsidian-ttrpg-wh40k)

Drop a newer or custom `.yaml` into `ttrpg/systems/` and hit **Reload systems** to use it.

### Using BRAT (auto-updates)

If your friends use the [BRAT](https://github.com/TfTHacker/obsidian42-brat) plugin, they can add this repo by URL to get automatic updates when you publish new releases.

## First-time setup

The plugin builds its own folder structure when you create a campaign. After enabling:

1. Open the dashboard.
2. Click the campaign name, then **+ New campaign**.
3. Pick a system (loaded from `ttrpg/systems/`), name the campaign, and add players.
4. The campaign folder tree (characters, lore, sessions, combat, inventory) is created automatically.

## Building a custom system

A system pack is a single YAML file describing stats, entities, combat dice, currency, archetypes, and conditions. Copy `dnd5e.yaml` as a starting point, edit it, drop it in `ttrpg/systems/`, and reload systems. The NPC generator and condition reference pick up your `archetypes` and `conditions` blocks automatically.

## Development

```bash
git clone https://github.com/SilentNinja06/obsidian-ttrpg-core
cd obsidian-ttrpg-core
pnpm install
pnpm build      # production build to main.js
pnpm dev        # watch mode
```

Then symlink or copy `main.js` and `manifest.json` into your vault's `.obsidian/plugins/ttrpg-core/`.

## License

MIT — see [LICENSE](LICENSE).
