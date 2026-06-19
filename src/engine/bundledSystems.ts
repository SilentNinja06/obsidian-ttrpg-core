// AUTO-GENERATED starter system packs, embedded so the plugin can install them
// into the vault's systems folder on demand. The canonical, updatable sources
// live in their own repos (obsidian-ttrpg-dnd5e, obsidian-ttrpg-wh40k).
// To refresh: re-run the bundle generator against the latest pack YAMLs.

export interface BundledSystem {
  id: string;
  label: string;
  filename: string;
  yaml: string;
}

export const BUNDLED_SYSTEMS: BundledSystem[] = [
  {
    id: "dnd5e",
    label: "D&D 5e",
    filename: "dnd5e.yaml",
    yaml: `id: dnd5e
name: D&D 5th Edition
version: 1

entities:
  character:
    stats:
      - key: str
        label: STR
        type: integer
        min: 1
        max: 30
      - key: dex
        label: DEX
        type: integer
        min: 1
        max: 30
      - key: con
        label: CON
        type: integer
        min: 1
        max: 30
      - key: int
        label: INT
        type: integer
        min: 1
        max: 30
      - key: wis
        label: WIS
        type: integer
        min: 1
        max: 30
      - key: cha
        label: CHA
        type: integer
        min: 1
        max: 30
    hp:
      current: hp-current
      max: hp-max
    fields:
      - key: class
        label: Class
        type: string
      - key: level
        label: Level
        type: integer
      - key: race
        label: Race
        type: string
      - key: alignment
        label: Alignment
        type: string
      - key: ac
        label: AC
        type: integer
      - key: speed
        label: Speed
        type: string
      - key: proficiency-bonus
        label: Proficiency bonus
        type: integer

combat:
  dice: d20
  initiative: dex
  turnOrder: highest-first
  hpTracking: true

currency:
  - key: gp
    label: GP
  - key: sp
    label: SP
  - key: cp
    label: CP
  - key: ep
    label: EP
  - key: pp
    label: PP

arcFields:
  - key: motivation
    label: Motivation
  - key: secret
    label: Secret
  - key: current-goal
    label: Current goal
  - key: arc-stage
    label: Arc stage

npcFields:
  - key: role
    label: Role
  - key: faction
    label: Faction
  - key: agenda
    label: Agenda
  - key: wants-from-party
    label: Wants from party

archetypes:
  - id: brute
    label: Brute (front-line fighter)
    boost: [str, con]
    dump: [int, cha]
    traits:
      - Missing a few teeth, grins anyway
      - Speaks in short, blunt sentences
      - Has a scar they're oddly proud of
      - Cracks knuckles before every threat
  - id: skirmisher
    label: Skirmisher (quick, ranged)
    boost: [dex, wis]
    dump: [str, cha]
    traits:
      - Never stops scanning the room
      - Twirls a dagger absent-mindedly
      - Speaks quietly, listens more
      - Always sits with back to the wall
  - id: caster
    label: Caster (arcane or divine)
    boost: [int, wis]
    dump: [str, con]
    traits:
      - Mutters half-formed incantations
      - Smells faintly of ozone or incense
      - Distracted, eyes always elsewhere
      - Collects strange trinkets
  - id: talker
    label: Talker (face, social)
    boost: [cha, int]
    dump: [str, con]
    traits:
      - Remembers everyone's name instantly
      - Laughs a beat too late
      - Dresses slightly above their station
      - Always has an angle
  - id: tough
    label: Tough (durable bruiser)
    boost: [con, str]
    dump: [int, dex]
    traits:
      - Barely reacts to pain
      - Eats constantly
      - Slow to anger, terrifying when angry
      - Has survived something that should have killed them

conditions:
  - name: Blinded
    effect: Can't see, auto-fails sight checks. Attacks against have advantage; its attacks have disadvantage.
    duration: Varies / until ended
  - name: Charmed
    effect: Can't attack the charmer or target them with harmful effects. Charmer has advantage on social checks.
    duration: Varies
  - name: Deafened
    effect: Can't hear, auto-fails hearing checks.
    duration: Varies
  - name: Frightened
    effect: Disadvantage on checks and attacks while source is in sight. Can't willingly move closer to it.
    duration: Until ended / save
  - name: Grappled
    effect: Speed becomes 0. Ends if grappler is incapacitated or moved away.
    duration: Until escaped
  - name: Incapacitated
    effect: Can't take actions or reactions.
    duration: Varies
  - name: Invisible
    effect: Can't be seen without aid. Attacks against have disadvantage; its attacks have advantage.
    duration: Varies
  - name: Paralyzed
    effect: Incapacitated, can't move or speak. Auto-fails STR/DEX saves. Attacks have advantage; hits within 5ft are crits.
    duration: Until ended / save
  - name: Petrified
    effect: Turned to stone. Incapacitated, resistant to all damage, immune to poison/disease.
    duration: Until ended
  - name: Poisoned
    effect: Disadvantage on attack rolls and ability checks.
    duration: Varies / save
  - name: Prone
    effect: Can only crawl. Disadvantage on attacks. Melee attacks against have advantage, ranged have disadvantage.
    duration: Until stands (half movement)
  - name: Restrained
    effect: Speed 0, disadvantage on attacks and DEX saves. Attacks against have advantage.
    duration: Until escaped
  - name: Stunned
    effect: Incapacitated, can't move, can barely speak. Auto-fails STR/DEX saves. Attacks have advantage.
    duration: Until ended / save
  - name: Unconscious
    effect: Incapacitated, drops everything, falls prone. Auto-fails STR/DEX saves. Attacks have advantage; hits within 5ft crit.
    duration: Until ended / healed
  - name: Exhaustion
    effect: Levels 1-6 stack penalties from disadvantage on checks up to death at level 6.
    duration: One level removed per long rest
`,
  },
  {
    id: "wh40k",
    label: "Warhammer 40k",
    filename: "wh40k.yaml",
    yaml: `id: wh40k
name: Warhammer 40,000
version: 1

entities:
  character:
    stats:
      - key: ws
        label: WS
        type: integer
        min: 1
        max: 10
      - key: bs
        label: BS
        type: integer
        min: 1
        max: 10
      - key: s
        label: S
        type: integer
        min: 1
        max: 10
      - key: t
        label: T
        type: integer
        min: 1
        max: 10
      - key: w
        label: W
        type: integer
        min: 1
        max: 20
      - key: i
        label: I
        type: integer
        min: 1
        max: 10
      - key: a
        label: A
        type: integer
        min: 1
        max: 10
      - key: ld
        label: Ld
        type: integer
        min: 1
        max: 10
      - key: sv
        label: Sv
        type: string
    hp:
      current: wounds-current
      max: w
    fields:
      - key: faction
        label: Faction
        type: string
      - key: unit-type
        label: Unit type
        type: string
      - key: squad-size
        label: Squad size
        type: integer
      - key: points
        label: Points cost
        type: integer
      - key: wargear
        label: Wargear
        type: string
      - key: special-rules
        label: Special rules
        type: string

  unit:
    fields:
      - key: faction
        label: Faction
        type: string
      - key: squad-size
        label: Squad size
        type: integer
      - key: points
        label: Points cost
        type: integer
      - key: wargear
        label: Wargear
        type: string

combat:
  dice: d6
  initiative: i
  turnOrder: alternating
  hpTracking: true
  moraleTest: ld

arcFields:
  - key: role
    label: Role
  - key: faction
    label: Faction
  - key: agenda
    label: Agenda
  - key: wants-from-party
    label: Wants from warband

npcFields:
  - key: role
    label: Role
  - key: faction
    label: Faction
  - key: agenda
    label: Agenda
  - key: threat-level
    label: Threat level

archetypes:
  - id: assault
    label: Assault (close combat)
    boost: [ws, s]
    dump: [bs, ld]
    traits:
      - Covered in close-combat trophies
      - Eager to close the distance
      - Bears ritual scars of their chapter or clan
      - Speaks only in battle-cant
  - id: marksman
    label: Marksman (ranged specialist)
    boost: [bs, i]
    dump: [ws, s]
    traits:
      - Maintains their weapon obsessively
      - Calm, measured, patient
      - Counts kills under their breath
      - Distrusts close quarters
  - id: heavy
    label: Heavy (durable, tough)
    boost: [t, w]
    dump: [i, bs]
    traits:
      - Moves slowly but inexorably
      - Plated in heavy armour
      - Bellows orders or threats
      - Has shrugged off wounds that fell others
  - id: leader
    label: Leader (commander)
    boost: [ld, ws]
    dump: [t, i]
    traits:
      - Carries an honour banner or relic
      - Speaks with absolute authority
      - Inspires fervour in subordinates
      - Has a grand, possibly doomed, plan
  - id: psyker
    label: Psyker (warp-touched)
    boost: [ld, i]
    dump: [s, t]
    traits:
      - Eyes flicker with unnatural light
      - Other troops give them a wide berth
      - Whispers to things that aren't there
      - The air grows cold around them

conditions:
  - name: Pinned
    effect: Must stay in cover, can't move or shoot normally until they pass a pinning test or rally.
    duration: Until rallied
  - name: Falling Back
    effect: Unit retreats from combat; generally can't shoot or charge that turn.
    duration: One turn
  - name: Battle-shocked
    effect: Objective control reduced; may fail morale-linked actions. Represents wavering resolve.
    duration: Until end of turn / test
  - name: Engaged
    effect: Locked in melee. Can't shoot most weapons; must fight or fall back.
    duration: Until combat ends
  - name: Suppressed
    effect: Reduced accuracy and may be unable to advance under heavy fire.
    duration: Until cleared
  - name: Wounded
    effect: Reduced effectiveness as Wounds drop; some units degrade their profile at wound thresholds.
    duration: Until healed
  - name: Out of Command
    effect: Beyond the leadership range of a commander; suffers penalties to morale and orders.
    duration: Until back in range
  - name: Broken
    effect: Failed morale badly; flees or is removed depending on edition rules.
    duration: Until rallied
`,
  },
];
