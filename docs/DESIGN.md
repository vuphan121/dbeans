# dbeans — Design & UX

This is the document that matters most. dbeans intentionally does less than DBeaver — the entire bet is that it feels dramatically better to use. Every screen should feel considered, not like a default admin-panel scaffold.

Reference points for the feeling we want: **Linear**, **TablePlus**, **Raycast**, **Arc**. Reference points for what we're explicitly reacting against: DBeaver, phpMyAdmin, pgAdmin — dense, Java-Swing-era or default-Bootstrap UIs that prioritize exposing every feature over being pleasant to use.

## 1. Principles

1. **Speed is a UX feature.** Every interaction (open a table, run a query, switch tabs) should feel instant. Optimistic UI, skeleton states instead of spinners where possible, no blocking full-page loaders after first load.
2. **Progressive disclosure.** Show the common case by default; advanced options (SSL config, connection pooling params, export options) live behind a secondary click, not in the primary view.
3. **Keyboard-first, mouse-optional.** A command palette (`Cmd/Ctrl+K`) reaches every action. Running a query, opening a table, switching connections — all have shortcuts. The mouse should never be *required*.
4. **Content over chrome.** Sidebars and panels are collapsible and resizable; the SQL editor and results grid get the space by default. No decorative UI competing with the user's data.
5. **Dark mode is not an afterthought.** Designed dark-first (this is a developer tool used at all hours), with an equally polished light theme — both built from the same token system, not a mechanical inversion.
6. **Honest, inline feedback.** Errors surface next to what caused them (e.g., a SQL error appears near the query, not just as a toast). Row counts, elapsed time, and affected-rows are always visible after a query runs.

## 2. Layout

A single persistent workbench layout, similar to a code editor:

```
┌─────────────┬───────────────────────────────────────────┐
│             │  [tab] [tab] [tab] +          Cmd+K ⌘      │
│  Sidebar    ├───────────────────────────────────────────┤
│  - conn.    │                                            │
│    switcher │             SQL editor pane                │
│  - schema   │                                            │
│    tree     ├───────────────────────────────────────────┤
│  (collaps-  │  ▸ status bar: rows • ms • row count       │
│   ible,     ├───────────────────────────────────────────┤
│   resizable)│                                            │
│             │           Results grid pane                │
│             │        (resizable vs. editor pane)         │
└─────────────┴───────────────────────────────────────────┘
```

- **Sidebar:** connection switcher at top, schema tree below. Collapsible to icon-only or fully hidden (toggle + shortcut).
- **Tabs:** one per open query/table view, like a code editor — persists across reloads (restore session).
- **Editor + results:** vertically split, resizable, remembered per user.
- **Status bar:** always-visible thin strip showing query duration, row count, current connection/database — ambient, not shouty.
- **Command palette (`Cmd+K`):** fuzzy-search over tables, saved snippets, connections, and actions ("new query tab," "switch theme," "export as CSV").

## 3. Key screens

### Login / unlock
Minimal, centered username + password fields on a calm background. No marketing copy, no "forgot password" flow (accounts are seeded server-side by whoever runs the self-hosted instance). On failure, a plain "username or password didn't match" — no attempt-count/lockout detail surfaced to the field itself, so a wrong guess can't be used to enumerate anything about the account.

### Connections list / add-connection
- Empty state on first run: one clear "Add a connection" call to action, not a blank dashboard.
- Add-connection is a short form (host, port, db, user, password, engine picker) with advanced/SSL options collapsed by default, and a "Test connection" action that gives immediate pass/fail feedback before saving.
- Saved connections shown as a simple list/grid with engine icon, name, and last-used time — click to open in the workbench.

### Workbench (core screen)
As laid out in §2. Schema tree nodes expand lazily with subtle loading affordance (skeleton row, not a spinner takeover). Double-clicking a table opens a pre-filled `SELECT *` query tab; the dedicated Data view is the quicker, SQL-free route for routine browsing and row maintenance.

A "Query" / "Data" / "Graphs" / "ERD" switcher sits in the workbench's top bar, next to the query tabs. Data swaps the editor+results split for a compact table toolbar, filter row, grid, and pagination footer while keeping the schema sidebar and connection context visible. Graphs swaps the editor+results pane for per-connection health and metrics; ERD swaps it for a real relationship diagram. Switching between views preserves open query tabs and unsaved SQL.

### Scheduled jobs (canvas)
A second pannable/zoomable board, alongside the connections one — one card per scheduled job (name, type/target, cron, last status), positioned and resized the same way connection cards are. Creating a job first asks for its action type: a query shows connection/SQL/check fields, while an HTTP request shows method/URL/headers/body fields. More types can join this selector later without changing the board. Dependencies between jobs are drawn as arrows directly on the canvas (smoothstep/orthogonal routing, not freeform curves, so several arrows converging on one job don't tangle) rather than only being visible as text in a form. Right-clicking a card gives Edit/Pause/Remove; running a job on demand and reviewing its history — a 9-week calendar of run status, colored by that date's latest run status, plus a recent-runs list — lives in the job's own edit panel instead, so the canvas stays a map of the pipeline rather than an action surface.

### Results grid / data editing
- Query results stay spreadsheet-like: editable, single-table results with a primary key allow cell edits and show the generated `UPDATE` in a confirmation dialog before it runs.
- The Data view is optimized for deliberate record maintenance rather than freeform spreadsheet editing: **Add row** and the row pencil open a typed full-row dialog; every field has an explicit **Default / Value / NULL** state, and generated values stay visibly database-owned.
- Row actions appear on hover to keep the dense grid quiet. They disappear entirely for read-only connections, and edit/delete are unavailable when the selected table has no primary key; an inline explanation says why.
- Column headers sort on click and expose quiet PK/FK/type context. A secondary Columns dialog handles hide/reorder controls while narrow drag handles resize in place; row checkboxes reveal bulk actions only after selection.
- Views share the table selector but carry a clear read-only notice. Schema changes live behind one compact **Schema** action; its form and exact DDL preview sit side by side, followed by **Open in query** or **Review & run** rather than a one-click mutation.
- A filter action adds compact column/operator/value controls above the grid. Multiple filters combine with `AND`; Apply commits the draft filters and Clear restores the unfiltered table.
- The footer always shows total rows, page position, page-size control, and a read-only badge where applicable. Table browsing is paginated server-side so the browser never holds an unbounded table in memory.

### Settings
One page, sections for: Appearance (theme), Security (change account password, session settings), Connections (manage/delete saved ones), Snippets (manage saved queries). No nested settings-within-settings maze.

## 4. Visual style

- **Typography:** a clean system-native sans (e.g. Inter or the system UI font stack) for chrome/labels; a monospace face (e.g. JetBrains Mono) for SQL, table/column names, and data cells — this distinction itself helps users separate "data" from "interface."
- **Color:** almost entirely black, white, and neutral grays (both themes) — the UI itself should read as monochrome. A single light-green accent is reserved for the logo/brand mark only, not used for buttons, links, or active states. Primary actions and active/selected states are conveyed through the neutral scale (e.g. solid black/white fill vs. outline) rather than a color accent. Semantic colors (red/amber/green) are reserved strictly for error/warning/success states, never for decoration.
- **Spacing:** consistent 8px grid for padding/margins; consistent corner radius scale (e.g. 6/8/12px) applied uniformly rather than ad hoc per component.
- **Elevation:** subtle shadows/borders for panels and popovers — enough to establish layering (modal over palette over sidebar), never heavy drop-shadows or skeuomorphism.
- **Density:** compact by default (this is a data tool — rows of data benefit from density) but with enough line-height and padding that it doesn't feel cramped; consider a user-toggleable "comfortable/compact" density setting for the grid specifically.

## 5. Interaction details worth getting right

- `Cmd/Ctrl+Enter` runs the current query (or selection if text is selected).
- Running queries show a cancel affordance immediately, not just after a timeout.
- Autocomplete in the SQL editor is schema-aware (knows real table/column names for the active connection), not just SQL-keyword completion.
- Switching connections/tabs preserves scroll position and unsaved query text.
- Export (CSV/JSON) is a lightweight menu action from the results grid, not a separate wizard flow.
- Toasts are used only for background/async confirmations (e.g., "Export ready"); anything blocking or error-related is shown inline where it's relevant.

## 6. Accessibility baseline

- All interactive elements reachable and operable via keyboard.
- Color is never the sole signal (e.g., pair error red with an icon/label).
- Sufficient contrast in both themes (aim for WCAG AA at minimum for text).
- Visible focus states throughout — this is a keyboard-first tool, focus rings are a feature, not a defect to hide.

## 7. Non-goals for the design

- No attempt to visually pack "every DBeaver feature" into the UI. If a feature doesn't have a clean, uncluttered way to present itself, it waits for a later phase rather than compromising the core screens.
- No heavy onboarding/tutorial flow — the product should be self-evident from the empty states and command palette.
