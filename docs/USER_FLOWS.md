# User Flows

Three personas:

- **Solo Player** — party-of-one; wears every hat (DM + Player).
- **Party Member (Player)** — joined someone else's party via invite code. May or may not hold the Banker role.
- **DM** — created a multi-member party; has read-all + write-via-explicit-actions authority.

---

## Conventions

```
[Screen]        — a page or modal the user sees
(action)        — something the user does
→               — leads to
?               — decision point / branch
```

---

## 1. Authentication & First Entry

### 1.1 New User — Discord Login

```
[Login screen]
(click "Sign in with Discord")
→ Discord OAuth consent screen
  ? User denies
  → back to [Login screen]
  ? User approves
  → redirect back → server mints session cookie
  → [Hub] (empty — no parties yet)
  → continue: §2 "Creating a Party or Joining"
```

### 1.2 New User — Email OTP Login

```
[Login screen]
(click "Sign in with email")
→ [Email entry form]
  (enter email address)
  → server sends 8-digit OTP
  → [OTP entry form]
    ? Wrong / expired code
    → inline error; re-enter
    ? Correct code
      ? First-ever login on this email
      → [Display name prompt] (enter name) → session created
      ? Returning user
      → session created (no prompt)
  → [Hub]
  → continue: §2
```

### 1.3 Returning User (session still valid)

```
Browser loads app
→ [Hub] (existing parties listed)
→ pick a party or create/join a new one
```

---

## 2. Creating a Party or Joining

```
[Hub] — three cards:
  (A) "Create a party"  → §4 DM — Creating a Party
  (B) "Join a party"    → §5 Party Member — Joining
  (C) "Create solo"     → §3 Solo Player — Creating a Solo Party
```

---

## 3. Solo Player

A solo player is a DM with exactly one member. All DM and Player permissions apply simultaneously. The Banker role does not exist at this size.

### 3.1 Creating a Solo Party

```
[Hub]
(click "Create solo" / "Create your character")
→ [Character creation form]
  Fields: name, species, class, level, STR, size
  (submit)
  → App provisions:
    - Party (memberCount = 1; "solo" badge derived from count)
    - DM membership + Player membership (same user)
    - Character
    - Inventory stash (auto-created, isCarried = true)
    - Party Stash (auto-created)
    - Recovered Loot stash (auto-created)
    - CurrencyHolding rows (one per stash)
    - TransactionLog: create-character
→ [Character Sheet (Home)] → §3.2
```

### 3.2 Daily Use — Character Sheet

```
[Character Sheet (Home)]
Tabs: Inventory | Storage | Party Stash | Recovered Loot
(navigate tabs to manage stashes)
```

### 3.3 Adding Items to a Stash

```
[Any stash tab]
(click "Add item")
→ [Add Item Modal]
  Tab A: Catalog
    (search / filter — fuzzy name + description + tags)
    (select item, set quantity)
    (click "Add to [stash name]")
    ? Item already present with same notes
    → auto-stack: quantity incremented, no new row
    ? Item not present
    → new ItemInstance row created
    → TransactionLog: acquire
    → back to stash view

  Tab B: Custom (homebrew)
    (fill homebrew form: name, category, weight, cost, description, tags, …)
    (click "Save & Add")
    → ItemDefinition created (source = "homebrew", partyId = this party)
    → ItemInstance created in the current stash
    → TransactionLog: create-homebrew, acquire
    → back to stash view
```

### 3.4 Moving Items Between Stashes

```
[Any stash tab] — item row
(click "Move")
→ [Move Item Modal]
  (pick target stash from list: Inventory / any Storage / Party Stash / Recovered Loot)
  ? Full stack
  → (confirm) → ownerId updated → auto-stack at destination if match
  ? Split first
  → (click "Split") → [Split Modal] (enter quantity to split off)
    → new row created in same stash
    → then move as above
  → TransactionLog: transfer
  ? Item was in Inventory and was equipped or attuned
  → equipped / attuned auto-cleared on the moved row
  → extra TransactionLog: edit-item-instance (field reset)
```

### 3.5 Managing Currency

```
[Any stash tab] — currency row
(click + or −) → inline adjustment → TransactionLog: currency-change

(click "Convert")
→ [Convert Modal]
  (select denomination pair, enter quantity)
  ? Conversion would be lossy (non-integer result)
  → submit disabled; inline explanation shown
  ? Lossless
  → (confirm) → balances updated → TransactionLog: currency-change
```

### 3.6 Creating and Managing Storage Stashes

```
[Storage tab]
(click "New Storage stash")
→ [Name prompt] (enter stash name e.g. "Chest at home")
→ new Stash row created (scope = character, isCarried = false)
→ TransactionLog: create-stash
→ [Storage Detail] (empty)

[Storage Detail]
  (add items → §3.3)
  (click stash name) → [Rename prompt] → TransactionLog: rename-stash
  (click "Delete stash")
  → confirm dialog: "Delete '[name]' and its N items?"
    ? Cancel → dismiss
    ? Confirm
    → items transfer to Recovered Loot → TransactionLog: transfer (per item)
    → stash deleted → TransactionLog: delete-stash
```

### 3.7 Homebrew Item Management

```
[Catalog Browser]
  PHB rows:
    (click "Duplicate")
    → [Homebrew form] pre-filled
    → (edit) → (save) → new ItemDefinition (source = homebrew, duplicatedFromId = original)
    → TransactionLog: create-homebrew

  Homebrew rows:
    (click "Edit")
    → [Homebrew form] editable
    → (save changes) → ItemDefinition updated
    → all ItemInstances referencing this definitionId reflect the change immediately
    → TransactionLog: edit-homebrew

    (click "Delete")
    → confirm dialog
    → ItemDefinition deleted (instances become orphaned — DM responsibility)
    → TransactionLog: delete-homebrew
```

### 3.8 Export / Import (Backup)

```
[Settings]
(click "Export JSON")
→ browser downloads full AppState as JSON file

(click "Import JSON")
→ file picker
→ [Confirm dialog]: "Replace all current data?"
  ? Cancel → dismiss
  ? Confirm
    → Zod parse of the uploaded file
    ? Parse fails
    → error toast: "Invalid backup file"
    ? Parse succeeds
    → AppState replaced wholesale → app reloads to [Character Sheet]
```

### 3.9 Promoting Solo to Multi-Member Party

```
[Party Settings]
(click "Share invite link" / "Copy invite code")
→ invite code ready to share (≥ 128-bit entropy, unique per party)
  ? DM wants a fresh code
  → (click "Regenerate") → old code invalidated → new code generated
→ share code with prospective player
  ? Player joins (see §5)
  → memberCount becomes 2
  → solo badge disappears
  → full multi-member permissions matrix (§8.1) takes effect
  → DM may now appoint a Banker from among the players
```

---

## 4. DM

The DM created a multi-member party. In a party-of-one they are also a Solo Player (§3). This section focuses on DM-only actions in a party with 2+ members.

### 4.1 Creating a Multi-Member Party

```
[Hub]
(click "Create a party")
→ [Party creation form]
  ? "Do you also play a character in this party?" (default: yes)
  → yes: [Character creation form] (§4.1a)
  → no: party created DM-only; DM can add their character later via Party Settings (§4.1b)

§4.1a — DM + Player creation
(fill character form: name, species, class, level, STR, size)
(submit)
→ App provisions:
  - Party (memberCount = 1)
  - DM membership (role = dm, no character)
  - Player membership (role = player, characterId = new Character)
  - Character + Inventory stash + CurrencyHolding
  - Party Stash + Recovered Loot stash + their CurrencyHoldings
  - TransactionLog: create-character
→ [Party Hub / DM Dashboard]

§4.1b — DM-only creation
(submit without character)
→ Same provisions minus Character / Player membership
→ TransactionLog: create-character (dmOnly: true)
→ [DM Dashboard] — "Add your character" CTA visible in Party Settings
```

### 4.2 Inviting Players

```
[Party Settings]
(click "Copy invite link")
→ share with players
→ each player uses it to join (§5.1)
  ? DM wants to revoke access before anyone joins
  → (click "Revoke") → code invalidated; no new joins possible until regenerated
```

### 4.3 DM Dashboard

```
[DM Dashboard]
  All characters at a glance: name, class, level, encumbrance status, attunement count
  Party Stash and Recovered Loot summaries
  Gold totals per character + party pool
  Quick-links to: Loot Distribution Wizard, Hoard Generator, Shop Manager, Identification Panel
```

### 4.4 Running a Loot Drop

```
[DM Dashboard] → (click "Distribute Loot")
→ [Loot Distribution Wizard]
  Step 1: Source
    ? Generated from hoard
    → (click "Generate Hoard") → [Hoard Generator] (§4.5) → items returned to wizard
    ? Manually entered items
    → (add items one by one from catalog or custom)

  Step 2: Distribution mode — per-hoard choice
    ? "Shared pool" — items go to Party Stash
    → all selected items → Party Stash
    → players may self-claim (no Banker) or Banker distributes (Banker active)
    → TransactionLog: acquire (each item)

    ? "Direct assign" — DM assigns each item to a specific player
    → per-item: (pick character) → item goes directly to that character's Inventory
    → TransactionLog: acquire (each item, target stash = character Inventory)

  Step 3: (confirm) → done
```

### 4.5 Hoard Generator

```
[Hoard Generator]
(select CR / level band)
(click "Roll")
→ DMG 2024 tables produce item list + currency amounts
→ (click "Send to Loot Wizard") → back to §4.4 Step 1
  or (click "Add to Party Stash directly") → items + currency added → TransactionLog
```

### 4.6 Magic Item Identification

```
[Identification Panel] — lists all unidentified items across the party
  Each row: "Unknown Magic Item" + current hint text

Per item:
  (click item)
  → [Identification detail]
    (edit hint text) — visible to players as a clue while unidentified
    → TransactionLog: identify (hint change only; previousIdentified = false)

    (click "Identify") — reveal real name to players
    → ItemInstance.identified = true
    → TransactionLog: identify (previousIdentified = false, newIdentified = true)

    ? DM wants to re-conceal (e.g., "actually it was cursed all along")
    → (click "Un-identify")
    → ItemInstance.identified = false
    → TransactionLog: identify (previousIdentified = true, newIdentified = false)
    → players now see "Unknown Magic Item" again
```

### 4.7 Running a Shop

```
[Shop Manager]
(click "New Shop")
→ [Shop creation form]: name, price modifier (e.g. 1.2×), sell-to-merchant rate (default 0.5)
→ [Shop editor]
  (add items to stock from catalog, optional quantity limit or -1 for unlimited)
  (set per-item price override if needed)

Manual purchase flow (DM resolves each transaction):
  Player wants to buy X:
    (DM: open shop, find item)
    (click "Sell to [player]") → [Purchase confirm]
      → currency deducted from player's stash
      → item added to player's Inventory (or chosen stash)
      → TransactionLog: purchase

  Player wants to sell X:
    (DM: find item in player's stash)
    (click "Buy from [player]") → [Sale confirm]
      → item removed from player's stash
      → currency (50% base by default) added to player's stash
      → TransactionLog: sale
```

### 4.8 Managing Characters and Encumbrance

```
[DM Dashboard] → (click character name) → [Character Detail — DM view]
  Can edit (via explicit logged actions):
    name, species, class, level, STR → TransactionLog: edit-character
    max attunement slots → TransactionLog: edit-character
    (BUG-011 2026-07-06) encumbrance rule + enforce flag moved to Party
    scope; edit under /party/settings, TransactionLog: set-encumbrance

  Can force actions on any item in character's Inventory:
    identify, recharge, force-use-charge (Inventory items only), edit notes
    → TransactionLog: respective type (identify / recharge / use-charge / edit-item-instance)
```

### 4.9 Kicking a Player

```
[Party Settings] → player list
(click "Kick [player]")
→ confirm dialog
  ? Cancel → dismiss
  ? Confirm
    → player's items → Recovered Loot stash
    → player's currency (all stashes) → Recovered Loot currency
    → player membership.leftAt = now
    ? Kicked player was Banker
    → Party.bankerUserId auto-cleared
    → TransactionLog: revoke-banker (reason: "kicked")
    → TransactionLog: kick-player
```

### 4.10 Appointing / Revoking a Banker

```
Available only when memberCount ≥ 2. DM cannot appoint themselves.

[Party Settings]
(click "Appoint Banker") → [Player picker] (excludes DM)
(select player)
→ Party.bankerUserId = selected player
→ TransactionLog: appoint-banker
→ Party Stash + Recovered Loot become Banker-mediated pools immediately
→ DM's "distribute to player" controls are hidden until Banker is revoked

(click "Revoke Banker")
→ Party.bankerUserId = null
→ TransactionLog: revoke-banker (reason: "manual")
→ DM resumes direct distribution
```

### 4.11 Transferring the DM Role

```
[Party Settings] → (click "Transfer DM role")
→ [Player picker] (active members only)
(select new DM)
→ Party.ownerUserId updated
? Selected player was the Banker
→ Party.bankerUserId auto-cleared
→ TransactionLog: revoke-banker (reason: "dm-transfer")
→ TransactionLog: dm-transfer
→ Former DM becomes a regular player
→ New DM is redirected to [DM Dashboard]
```

### 4.12 Session Management

```
[Party Settings] or [DM Dashboard]
(click "Start session")
→ Session created (isCurrent = true); prompted for optional notes
→ all subsequent TransactionLog entries carry sessionId = current session

(click "End session") → Session marked inactive
→ subsequent log entries carry sessionId = null ("Untagged" bucket in log view)

? DM forgets to start a session
→ mutations still succeed; log entries carry sessionId = null
→ Party Log shows them under "Untagged" filter
```

### 4.13 DM Leaving the Party

```
[Party Settings] → (click "Leave party")
  ? Other members exist
  → "You must transfer the DM role before leaving"
  → (click "Transfer DM role") → §4.11
  → after transfer, DM leaves as a regular player (§5.4)

  ? DM is the only member
  → confirm: "This will archive the party. Your data is preserved."
  → Party.archivedAt stamped; party disappears from Hub
  → no item/currency cascade (data preserved verbatim)
```

---

## 5. Party Member (Player)

### 5.1 Joining a Party

```
[Hub]
(click "Join a party")
→ [Invite code entry] (paste code or link)
→ server validates code
  ? Invalid / expired code
  → error: "Invalid invite code"
  ? Valid
  → PartyMembership row created (role = player, characterId = null)
  → [Character creation form] (mandatory before any inventory interaction)
    Fields: name, species, class, level, STR, size
    (submit)
    → Character + Inventory stash + CurrencyHolding provisioned
    → TransactionLog: create-character
    → [Character Sheet (Home)] for this party
```

### 5.2 Character Sheet — Player Daily Use

```
[Character Sheet (Home)]
Tabs: Inventory | Storage | Party Stash | Recovered Loot

Inventory:
  - View own carried items, encumbrance bar, attunement slots (X / max)
  - equip / unequip, attune / unattune
  - manage charges on own attuned items
  - add items from catalog (PHB + party homebrew)
  - move items to own Storage or push to Party Stash

Storage:
  - create / rename / delete own Storage stashes (§3.6)
  - move items between Inventory and Storage freely

Party Stash:
  ? No Banker appointed
  → player can self-claim items and currency
  ? Banker active
  → player can only VIEW; Banker distributes

Recovered Loot:
  ? No Banker appointed
  → player can self-claim items and currency
  ? Banker active
  → player can only VIEW; Banker distributes
```

### 5.3 Editing Own Character

```
[Character Sheet (Home)] → (click character name / "Edit character")
→ [Character edit form]
  Editable by player (self):
    - name → TransactionLog: rename-character
    - species, class, level → TransactionLog: edit-character (changedFields: [...])
    - STR → TransactionLog: edit-character (changedFields: ["str"])
      Note: STR change affects encumbrance capacity immediately if rule is active

  NOT editable by player:
    - size — set at creation, locked in v1
    - max attunement slots — DM only
    - encumbrance rule + enforce flag — DM only

  (submit changes)
  → reducer validates actor is owner
  → fields updated → TransactionLog written
  → [Character Sheet (Home)]
```

### 5.4 Equipping and Attuning Items

```
[Inventory tab] — item row
(click "Equip") — weapon / armor / shield
→ ItemInstance.equipped = true
→ TransactionLog: equip

(click "Attune") — magic item requiring attunement
  ? Attunement slots full (at cap, default 3)
  → blocked; toast: "Attunement slots full"
  ? Slot available
  → ItemInstance.attuned = true → TransactionLog: attune

(click "Unattune")
→ ItemInstance.attuned = false → TransactionLog: unattune
```

### 5.5 Leaving a Party

```
[Party Settings or Character Sheet]
(click "Leave party")
→ confirm dialog
  ? Cancel → dismiss
  ? Confirm
    → player's items (all stashes) → Recovered Loot
    → player's currency (all stashes) → Recovered Loot currency
    ? Player was Banker
    → Party.bankerUserId auto-cleared
    → TransactionLog: revoke-banker (reason: "left-party")
    → TransactionLog: leave-party
    → redirected to [Hub]; party no longer in list
```

### 5.5 Banker Role (when appointed by DM)

The Banker retains all Player permissions and gains authority over the Party Stash and Recovered Loot.

```
[Party Stash] or [Recovered Loot] — Banker view
Additional controls visible:

  (click "Split evenly")
  → [Split Currency Modal]
    (preview: X gp each for N characters)
    (confirm) → currency distributed equally
    → TransactionLog: currency-transfer (one per character)

  (click "Give to player") → [Player picker] → [Amount / Item picker]
  → currency or item moved to chosen player's Inventory
  → TransactionLog: currency-transfer or transfer

  (click "Take") → currency / item moved to Banker's own Inventory or chosen Storage
  → TransactionLog: currency-transfer or transfer
```

### 5.6 Sending Currency Directly to Another Player

```
Available regardless of Banker state. Player can always send from their own stash.

[Inventory tab or Storage Detail] — currency row
(click "Send to player")
→ [Player picker] → [Amount entry]
→ currency moved directly to recipient's Inventory
→ TransactionLog: currency-transfer
→ no acceptance step — immediate
```

### 5.7 Viewing Item History

```
[Item Detail] (click any item row → detail view)
  Default view: ownership-transition events
    (acquire, transfer, purchase, sale, consume, identify, attune/unattune, equip/unequip)
  (click "Show all events") → expands to full log including use-charge, recharge, edit-item-instance

  Visibility rules:
    - Own Inventory / Storage items: always visible to owner + DM
    - Party Stash / Recovered Loot items: visible to ALL party members
```

---

## 6. Cross-Persona Flows

### 6.1 Item Transfer Between Players

```
Initiator (Player A):
[Inventory or Storage] — item row
(click "Move") → [Move Item Modal]
  (select "Another player's stash") → [Player picker] → [Stash picker]
  (confirm)
  → item moves immediately (no acceptance step)
  → TransactionLog: transfer
  → Player B sees item in their chosen stash
```

### 6.2 DM Force-Editing a Player's Item (explicit action)

```
[DM Dashboard] → player's Inventory row
(click item) → [Item detail — DM view]
  Editable actions:
    - edit notes / custom name → TransactionLog: edit-item-instance
    - recharge (any item, any location) → TransactionLog: recharge
    - force-use-charge (Inventory items only) → TransactionLog: use-charge
    - identify / un-identify → TransactionLog: identify

Each action goes through the reducer:
  → explicit TransactionLog entry written
  → visible in per-item history to item owner + DM
  → player sees updated state on next sync
```

### 6.3 Per-Party History / Log

```
[History / Log screen] (all personas)
Filters:
  - Session (including "Untagged" for sessionId = null entries)
  - Character
  - Item
  - Transaction type
  - Actor role (dm / player / banker)

Default: all events, most recent first
(apply filters) → filtered view updates inline
```

### 6.4 Account Settings

```
[Settings] → "Linked accounts"

Discord user adding an email fallback:
  (click "Add email login")
  → [Email entry form] → OTP sent → [OTP entry]
  ? Correct → email verified; becomes valid standalone login credential

Email-only user linking Discord:
  (click "Connect Discord")
  → Discord OAuth flow
  ? Approved → discordId + avatarUrl stored; Discord becomes additional login method

(click "Log out") → session cookie cleared → [Login screen]
```

---

## 7. Error & Edge-Case Branches

| Situation | Behavior |
|---|---|
| Encumbrance enforcement on and transfer would exceed cap | Reducer rejects; toast: "Over capacity" |
| Attunement cap reached, player tries to attune | Reducer rejects; toast: "Attunement slots full" |
| Lossy currency conversion | Convert modal disables submit; inline explanation |
| Invite code pasted that is invalid or revoked | "Invalid invite code" error on Hub |
| Player tries to claim from Party Stash while Banker active | Claim button hidden / disabled |
| DM tries to distribute while Banker active | Distribute controls hidden; must revoke Banker first |
| DM tries to appoint themselves as Banker | Picker excludes DM; not selectable |
| Banker leaves the party | bankerUserId auto-cleared; party reverts to free-claim mode |
| DM-transfer to current Banker | bankerUserId auto-cleared; new DM must reappoint |
| JSON import — Zod parse fails | Error toast; no state change |
| Party archived (last member leaves) | No cascade; data preserved; party disappears from Hub |
| No active session | Mutations succeed; log entries tagged sessionId = null → "Untagged" bucket |
| Item moved out of Inventory (equipped / attuned) | equipped / attuned auto-cleared; extra edit-item-instance log entry emitted |
| Container moved to another stash | All contained items follow atomically; containerInstanceId unchanged |
| Child item moved cross-stash without container | containerInstanceId cleared to null; logged in transfer payload |
