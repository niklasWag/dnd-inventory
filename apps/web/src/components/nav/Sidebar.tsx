import { type ReactElement } from 'react';
import { NavLink } from 'react-router-dom';
import { useShallow } from 'zustand/react/shallow';
import {
  BookOpen,
  Boxes,
  ChevronsLeft,
  ChevronsRight,
  Dices,
  Eye,
  Home,
  LayoutDashboard,
  PanelsTopLeft,
  Scale,
  Settings as SettingsIcon,
  Store,
  Users,
  Wand2,
  History as HistoryIcon,
  type LucideIcon,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { useStore, activeMemberCount } from '@/store';
import { getOwnCharacter } from '@/lib/ownCharacter';
import { isCurrentUserDmOrSolo } from '@/lib/currentUserRole';
import { useSidebarStore } from '@/store/sidebar';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * R9.2 — Nav sidebar. The primary navigation for every party-scoped
 * screen (mounted by `RootLayout` only inside `/party/:partyId/*`).
 * Reference: `docs/r9-redesign/drawings/nav-sidebar.png` + the CHARTER
 * "Navigation — DECIDED (Option A)" grouped IA.
 *
 * Groups (role-gated per CHARTER):
 *   - party header — name + member count + a "Hub" back link + settings gear
 *   - My Character — Character Sheet, Stashes
 *   - Party        — Party Stash, Recovered Loot, Shops, Members, History
 *   - Reference    — Catalog
 *   - DM Tools     — DM Dashboard, Hoard, Loot Distribution, Identification (DM/solo only)
 *   - footer       — Settings
 *
 * Collapsible to an icon-only rail (persisted via `store/sidebar.ts`);
 * collapsed items show a `tooltip` with their label. The mobile drawer
 * reuses this same component (rendered inside a `Sheet` by `RootLayout`).
 */

interface NavItem {
  label: string;
  icon: LucideIcon;
  to: string;
  /**
   * When true, the active highlight requires an EXACT path match (NavLink
   * `end`). Set on links whose `to` is a prefix of a sibling's `to` — e.g.
   * Character Sheet (`/character/:id`) is a prefix of Stashes
   * (`/character/:id/stashes`), so without `end` both would highlight when
   * viewing Stashes.
   */
  end?: boolean;
}
interface NavGroup {
  heading: string;
  items: NavItem[];
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }): ReactElement {
  const collapsed = useSidebarStore((s) => s.collapsed);
  const toggle = useSidebarStore((s) => s.toggle);

  const view = useStore(
    useShallow((s) => {
      if (s.appState === null) {
        return { partyId: null, partyName: '', memberCount: 0, characterId: null, isDm: false };
      }
      const own = getOwnCharacter(s.appState);
      return {
        partyId: s.appState.party.id,
        partyName: s.appState.party.name,
        memberCount: activeMemberCount(s.appState),
        characterId: own?.id ?? null,
        isDm: isCurrentUserDmOrSolo(s.appState),
      };
    }),
  );

  if (view.partyId === null) return <></>;
  const base = `/party/${view.partyId}`;

  // The Character Sheet link targets the actor's own character; when they
  // have none yet (DM-only, joiner pre-create), fall back to settings —
  // the "create your character" CTA (mirrors Hub's post-delete routing).
  const characterHref =
    view.characterId !== null ? `${base}/character/${view.characterId}` : `${base}/settings`;
  // Stashes (Storage overview) is per-character — nest under the character.
  // Falls back to settings (create-character CTA) when the actor has none.
  const stashesHref =
    view.characterId !== null
      ? `${base}/character/${view.characterId}/stashes`
      : `${base}/settings`;

  const groups: NavGroup[] = [
    {
      heading: 'My Character',
      items: [
        { label: 'Character Sheet', icon: PanelsTopLeft, to: characterHref, end: true },
        { label: 'Stashes', icon: Boxes, to: stashesHref },
      ],
    },
    {
      heading: 'Party',
      items: [
        { label: 'Party Stash', icon: Boxes, to: `${base}/party-stash` },
        { label: 'Recovered Loot', icon: Scale, to: `${base}/recovered-loot` },
        { label: 'Shops', icon: Store, to: `${base}/shops` },
        { label: 'Members', icon: Users, to: `${base}/settings` },
        { label: 'History', icon: HistoryIcon, to: `${base}/history` },
      ],
    },
    {
      heading: 'Reference',
      items: [{ label: 'Catalog', icon: BookOpen, to: `${base}/catalog` }],
    },
  ];

  if (view.isDm) {
    groups.push({
      heading: 'DM Tools',
      items: [
        { label: 'DM Dashboard', icon: LayoutDashboard, to: `${base}/dm` },
        { label: 'Hoard Generator', icon: Dices, to: `${base}/loot/generate` },
        { label: 'Loot Distribution', icon: Wand2, to: `${base}/loot/distribute` },
        { label: 'Identification', icon: Eye, to: `${base}/identify` },
      ],
    });
  }

  const memberLine = view.memberCount === 1 ? 'Solo' : `${view.memberCount} members`;
  const hubItem: NavItem = { label: 'Hub', icon: Home, to: '/hub' };
  const settingsItem: NavItem = { label: 'Settings', icon: SettingsIcon, to: '/settings' };

  if (collapsed) {
    return (
      <TooltipProvider delayDuration={0}>
        <CollapsedRail
          partyName={view.partyName}
          partySettingsHref={`${base}/settings`}
          hubItem={hubItem}
          groups={groups}
          settingsItem={settingsItem}
          onNavigate={onNavigate}
          onExpand={toggle}
        />
      </TooltipProvider>
    );
  }

  return (
    <ExpandedSidebar
      partyName={view.partyName}
      memberLine={memberLine}
      partySettingsHref={`${base}/settings`}
      hubItem={hubItem}
      groups={groups}
      settingsItem={settingsItem}
      onNavigate={onNavigate}
      onCollapse={toggle}
    />
  );
}

interface SidebarBodyProps {
  partyName: string;
  partySettingsHref: string;
  hubItem: NavItem;
  groups: NavGroup[];
  settingsItem: NavItem;
  onNavigate?: (() => void) | undefined;
}

/**
 * Expanded sidebar (`w-60`) — the full grouped nav. This is the primary,
 * polished layout; the collapsed rail is a separate component so this one
 * never has to reason about icon-only half-states.
 */
function ExpandedSidebar({
  partyName,
  memberLine,
  partySettingsHref,
  hubItem,
  groups,
  settingsItem,
  onNavigate,
  onCollapse,
}: SidebarBodyProps & { memberLine: string; onCollapse: () => void }): ReactElement {
  return (
    <nav
      aria-label="Party navigation"
      className="flex h-full w-60 flex-col border-r border-border bg-surface"
    >
      {/* Party header */}
      <div className="border-b border-border px-3 py-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              Party
            </div>
            <div className="truncate font-display text-sm font-bold" title={partyName}>
              {partyName}
            </div>
          </div>
          <NavLink
            to={partySettingsHref}
            onClick={onNavigate}
            aria-label="Party settings"
            className="shrink-0 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <SettingsIcon className="h-4 w-4" />
          </NavLink>
        </div>
        <div className="mt-0.5 text-xs text-muted-foreground">{memberLine}</div>
      </div>

      {/* Hub back link — directly below the party header */}
      <div className="px-2 py-2">
        <ExpandedNavItem item={hubItem} onNavigate={onNavigate} end />
      </div>

      {/* Grouped nav */}
      <div className="flex-1 space-y-4 overflow-y-auto px-2 py-2">
        {groups.map((group) => (
          <div key={group.heading}>
            <div className="px-2 pb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
              {group.heading}
            </div>
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.label}>
                  <ExpandedNavItem item={item} onNavigate={onNavigate} end={item.end ?? false} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {/* Footer — Settings + collapse toggle */}
      <div className="border-t border-border px-2 py-2">
        <ExpandedNavItem item={settingsItem} onNavigate={onNavigate} end />
        <button
          type="button"
          onClick={onCollapse}
          aria-label="Collapse sidebar"
          className="mt-1 flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronsLeft className="h-4 w-4 shrink-0" />
          <span>Collapse</span>
        </button>
      </div>
    </nav>
  );
}

/** A single expanded nav row: icon + label, active highlight via `NavLink`. */
function ExpandedNavItem({
  item,
  onNavigate,
  end = false,
}: {
  item: NavItem;
  onNavigate?: (() => void) | undefined;
  end?: boolean | undefined;
}): ReactElement {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-primary/10 text-primary'
            : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
        )
      }
    >
      <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  );
}

/**
 * Collapsed icon-only rail (`w-16`) — a dedicated, purpose-built layout
 * (NOT the expanded markup with labels stripped). One evenly-spaced column
 * of icons: party medallion, then Hub + every nav item (flattened, no
 * group headers or dividers), then Settings + the expand toggle pinned to
 * the footer. Every target is a fixed 10×10 box and a direct child of the
 * `items-center` nav, so they all share one vertical axis. Each icon
 * carries a `tooltip` with its label.
 */
function CollapsedRail({
  partyName,
  partySettingsHref,
  hubItem,
  groups,
  settingsItem,
  onNavigate,
  onExpand,
}: SidebarBodyProps & { onExpand: () => void }): ReactElement {
  // Flatten every group's items into one icon column (order preserved).
  const flatItems: NavItem[] = [hubItem, ...groups.flatMap((g) => g.items)];

  return (
    <nav
      aria-label="Party navigation"
      className="flex h-full w-16 flex-col items-center gap-1 border-r border-border bg-surface py-3"
    >
      {/* Party medallion → party settings. Uses the exact same 10×10 box
          wrapper as every nav icon (RailBox) so there is NO structural
          difference that could drift it off the shared center axis. */}
      <RailBox tooltip={partyName}>
        <NavLink
          to={partySettingsHref}
          onClick={onNavigate}
          aria-label="Party settings"
          className="flex h-full w-full items-center justify-center rounded-md bg-primary/10 font-display text-sm font-bold text-primary transition-colors hover:bg-primary/20"
        >
          {partyName.charAt(0).toUpperCase()}
        </NavLink>
      </RailBox>

      <div className="h-2 shrink-0" aria-hidden="true" />

      {flatItems.map((item) => (
        <CollapsedNavIcon
          key={item.label}
          item={item}
          onNavigate={onNavigate}
          end={item.to === '/hub' || (item.end ?? false)}
        />
      ))}

      {/* Footer — Settings + expand toggle, pushed to the bottom. */}
      <div className="mt-auto h-2 shrink-0" aria-hidden="true" />
      <CollapsedNavIcon item={settingsItem} onNavigate={onNavigate} end />
      <RailBox tooltip="Expand sidebar">
        <button
          type="button"
          onClick={onExpand}
          aria-label="Expand sidebar"
          className="flex h-full w-full items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-2 hover:text-foreground"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      </RailBox>
    </nav>
  );
}

/**
 * The single fixed-size (`h-10 w-10`) slot every collapsed-rail target
 * renders into — medallion, nav icons, and the expand toggle alike. Because
 * every item shares this identical wrapper as a direct child of the
 * `items-center` nav, they all sit on one vertical center axis by
 * construction (no per-item structural variation to drift them). Wraps its
 * child in a right-side `tooltip`.
 */
function RailBox({ tooltip, children }: { tooltip: string; children: ReactElement }): ReactElement {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="h-10 w-10 shrink-0">{children}</div>
      </TooltipTrigger>
      <TooltipContent side="right">{tooltip}</TooltipContent>
    </Tooltip>
  );
}

/** A single collapsed rail icon, rendered into a `RailBox` slot. */
function CollapsedNavIcon({
  item,
  onNavigate,
  end = false,
}: {
  item: NavItem;
  onNavigate?: (() => void) | undefined;
  end?: boolean | undefined;
}): ReactElement {
  const Icon = item.icon;
  return (
    <RailBox tooltip={item.label}>
      <NavLink
        to={item.to}
        end={end}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            'flex h-full w-full items-center justify-center rounded-md transition-colors',
            isActive
              ? 'bg-primary/10 text-primary'
              : 'text-muted-foreground hover:bg-surface-2 hover:text-foreground',
          )
        }
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="sr-only">{item.label}</span>
      </NavLink>
    </RailBox>
  );
}
