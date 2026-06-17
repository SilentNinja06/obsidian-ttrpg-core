# TTRPG Campaign Manager — Core Plugin

An Obsidian plugin for managing TTRPG campaigns across multiple game systems. Supports D&D, Warhammer 40k, and any custom system you define via a YAML schema file.

## Features

- Campaign dashboard with party status, open threads, unassigned loot, and recent activity
- Character sheets with stat blocks, HP tracking, skills, resources, inventory, and arc notes
- Session notes with capture mode (live play) and write-up mode (post-session)
- Lore pages for locations, factions, and history entries — one adaptive layout
- Combat tracker with initiative order, HP management, dice roller, and combat log
- Sidebar view with one-click popout to a full window
- Template system with six note types and a creation modal
- Dataview compatible — all frontmatter is queryable

## Requirements

- Obsidian 1.4.0 or later
- [Dataview](https://github.com/blacksmithgu/obsidian-dataview) plugin (community plugin)
- At least one system pack YAML file (see system packs below)

## Installation

### Via GitHub (manual)

1. Download the latest release from the [Releases](../../releases) page
2. Extract `main.js` and `manifest.json` into your vault at `.obsidian/plugins/ttrpg-core/`
3. Enable the plugin in Obsidian Settings → Community Plugins

### For development

```bash
git clone https://github.com/SilentNinja06/obsidian-ttrpg-core
cd obsidian-ttrpg-core
pnpm install
pnpm dev
```

Then symlink the folder into your vault's `.obsidian/plugins/` directory.

## System packs

The core plugin ships with no game system — install a system pack to add stat blocks, templates, and combat rules for a specific game:

- [D&D 5e pack](https://github.com/SilentNinja06/obsidian-ttrpg-dnd5e)
- [Warhammer 40k pack](https://github.com/SilentNinja06/obsidian-ttrpg-wh40k)

To install a system pack, copy the `.yaml` file into your vault's `ttrpg/systems/` folder (configurable in settings).

## Vault structure

```
ttrpg/
  systems/          ← system pack YAML files live here
  campaigns/
    my-campaign/
      campaign.yaml
      characters/
        pcs/
        npcs/
      lore/
        places/
        factions/
        history/
      inventory/
      sessions/
      combat/
```

## Settings

| Setting | Default | Description |
|---|---|---|
| Campaigns folder | `ttrpg/campaigns` | Root folder for all campaigns |
| Systems folder | `ttrpg/systems` | Where system pack YAML files are read from |
| Active campaign | _(empty)_ | Campaign folder name to load on startup |
| Open dashboard on startup | on | Whether to show the dashboard sidebar when Obsidian opens |

## Commands

All commands are available via the command palette (Ctrl/Cmd+P):

- `TTRPG: Open dashboard`
- `TTRPG: Open combat tracker`
- `TTRPG: New note`
- `TTRPG: New character`
- `TTRPG: New session note`
- `TTRPG: New location`
- `TTRPG: New faction`

## Creating a custom system pack

Create a `.yaml` file in your systems folder with this structure:

```yaml
id: my-system
name: My Homebrew RPG
version: 1

entities:
  character:
    stats:
      - key: might
        label: Might
        type: integer
        min: 1
        max: 20
    hp:
      current: hp-current
      max: hp-max

combat:
  dice: d12
  initiative: might
  turnOrder: highest-first
  hpTracking: true

arcFields:
  - key: motivation
    label: Motivation
  - key: secret
    label: Secret
```

## License

MIT
