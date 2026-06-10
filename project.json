## What changes

1. **Remove the page-level team palette swap.** `useHeaderTeam` / `teamCssVars` re-skinning of `/app/performance` (and the header tinting on filter change) goes away. Team color dots/badges in chips, filters, and tables stay — that's the only place team colors will live now.

2. **Add a portal switcher in the top-left of the header.** The current circular logo becomes a `DropdownMenu` trigger that opens a list of portals with emblem + name + check mark for the active one. Mirrors the Echelon Nexus ERPHeader pattern.

3. **Portals available:**
   - **Admin** — current teal palette, current Excalibur logo, default selection.
   - **Red-Sigma (RED-SIG)**
   - **Orange-Nova (ORN-NOV)**
   - **Yellow-Magna (YEL-MAG)**
   - **Green-Gamma (GRN-GAM)**
   - **Blue-Theta (BLU-THE)**
   - **Purple-Delta (PUR-DEL)**
   - **Black-Vectra (BLK-VEC)** — replaces the Echelon "Admin" slot; deep indigo/black palette (re-skin of Echelon's `black-sigma` theme).

4. **Theme follows portal selection.** Switching writes a full set of HSL CSS variables (`--primary`, `--ring`, `--background`, `--card`, `--foreground`, `--accent`, `--sidebar-*`, gradients) onto `<html>`. Palettes per portal are copied from Echelon Nexus `PORTAL_THEMES`. Admin uses the current `src/styles.css` `:root` values unchanged.

5. **Persistence.** Selection stored in `localStorage` under `cr-active-portal`. Restored on app load before first paint to avoid theme flash. Defaults to `admin`.

6. **Data scoping (cosmetic + scope, per user choice).** When a non-Admin portal is active, Performance and Reports auto-apply that portal as the team filter (same effect as picking it in the existing team dropdown), and the team filter UI hides/disables to reflect the portal lock. Admin portal = unrestricted, team filter UI returns. No other pages filter by portal.

7. **Team rename + realignment to match portals:** profiles.team_id values are migrated:
   - `red-alpha` → `red-sigma`
   - `indigo-delta` → `purple-delta`
   - `violet-sigma` → `purple-delta` (merge; only one purple portal)
   - `orange-nova`, `yellow-magna`, `green-gamma`, `blue-theta` unchanged
   - New value `black-vectra` available for assignment
   The `TEAMS` array in `src/lib/teams.ts` is rewritten to the 7-portal list. Team color dots in chips/filters use each portal's primary hex.

## File-level work

### New
- `src/contexts/portal-context.tsx` — `PortalProvider`, `usePortal()`, `PortalId`, portal configs (name, shortCode, emblem, primary hex, full HSL theme map). Applies CSS vars on `<html>` whenever active portal changes; reads/writes `localStorage`.
- `src/components/portal-switcher.tsx` — dropdown rendered inside `AppHeader` (top-left). Shows current emblem + name + chevron; menu lists all portals.
- `src/assets/portals/*.png.asset.json` — emblems copied from Echelon Nexus (`Echelon_RED-SIG.png`, `ORN-NOV`, `YEL-MAG`, `GRN-GAM`, `BLU-THE`, `PUR-DEL`). Generate new emblems for Admin (reuse existing `src/assets/logo.png`) and Black-Vectra (newly generated dark hexagonal emblem in the Echelon style).
- `supabase/migrations/<ts>_align_teams_to_portals.sql` — `UPDATE profiles SET team_id = 'red-sigma' WHERE team_id = 'red-alpha'`, same for indigo→purple and violet→purple.

### Edited
- `src/components/app-shell.tsx` — drop `HeaderThemeContext`/`useHeaderTeam`/`getTeam`-based header bg. Header becomes plain `bg-card` again. Insert `<PortalSwitcher />` at the top-left of `AppHeader` (left of the title). Sidebar logo also reflects active portal emblem.
- `src/routes/__root.tsx` (or `src/routes/app.tsx`) — wrap the app tree in `PortalProvider` so theme is applied on every authenticated route.
- `src/lib/teams.ts` — rewrite `TEAMS` to the 7 portals with updated `id`/`label`/`color`/`emblem`. Delete `teamCssVars` (no longer used). `getTeam` stays for color-dot lookups.
- `src/routes/app.performance.tsx` — remove `useHeaderTeam` + `teamCssVars` + the team-tinted wrapper div. Replace the admin team-filter `<select>` with: if Admin portal, show "All teams" + per-team options; if any other portal, hide the dropdown and force `activeTeamId = currentPortal.id`. Counter team badges keep their dot color via `getTeam(...).color`.
- `src/routes/app.admin.users.tsx` — team dropdown options come from the new `TEAMS` list (Red-Sigma replaces Red-Alpha, Purple-Delta replaces Indigo/Violet).
- `src/integrations/supabase/types.ts` — no edits; team_id is `text`, schema unchanged.

### Removed
- All `<div style={teamCssVars(...)}>` wrappers (performance only — verified there are no other usages).
- Old team emblem PNGs (`red-alpha.png`, `indigo-delta.png`, `violet-sigma.png`) — replaced by renamed/copied portal emblems.

## Technical details

**Theme application.** `PortalProvider` runs a `useLayoutEffect` that, on portal change, iterates the active portal's HSL token map and calls `document.documentElement.style.setProperty(name, value)`. For Admin, it clears the inline overrides so the base `:root` from `src/styles.css` takes effect (preserves the existing teal exactly).

**No-flash boot.** Before React mounts, an inline script in `__root.tsx` `head()` reads `localStorage['cr-active-portal']`, looks up its HSL map from a small embedded object, and sets the CSS vars synchronously so first paint matches the chosen portal.

**Data-scoping mechanism.** A new `useActivePortalTeamFilter()` hook returns `{ teamId: PortalId | null, locked: boolean }`. Performance + Reports read it to drive `activeTeamId`; when `locked`, the existing admin team-filter `<select>` is hidden. Counter rows / per-user metrics already filter by `profile.team_id`, so once team IDs match portal IDs the filter works end-to-end with no other query changes.

**Migration safety.** The team rename migration is a single UPDATE with a WHERE clause; no constraints reference `team_id`, no FK to break. After migration, the only valid team_id values are the 7 portal IDs plus NULL.

**Out of scope.** No changes to mobile routes (`/m/*`), print routes, auth, or RLS. Header chrome on mobile pages is untouched. No new sidebar nav entries.
