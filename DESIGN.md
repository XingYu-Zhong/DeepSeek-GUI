---
# DESIGN.md frontmatter — machine-readable design tokens for design agents
# (e.g. Stitch, Figma plugins). Values are extracted from the live
# codebase (src/renderer/src/styles/*.css + src/renderer/src/index.css), not
# invented. Anything not in this block is editorial, not authoritative.

schema_version: 1
project: Kun
single_runtime: kun
themes: [light, dark, system]

# ---------- 1. Palette (raw hex from --ds-* tokens) ----------
palette:
  light:
    bg_app: "#f5f7fa"            # --bg-app / --ds-bg-main
    bg_sidebar: "#f4f7fb"         # --bg-sidebar / --ds-bg-sidebar
    bg_canvas: "#fbfcfe"          # --ds-bg-canvas
    surface_card: "rgba(255,255,255,0.90)"   # --ds-surface-card
    surface_elevated: "rgba(255,255,255,0.98)"
    surface_subtle: "#eef2f7"     # --ds-surface-subtle
    surface_hover: "rgba(15,23,42,0.055)"
    border: "rgba(15,23,42,0.12)" # --ds-border
    border_muted: "rgba(15,23,42,0.08)"
    border_strong: "rgba(15,23,42,0.18)"
    text: "#222222"               # --ds-text
    text_muted: "#5f6878"
    text_faint: "#8a93a4"
    text_placeholder: "#949dad"
    accent: "#0088ff"             # --ds-accent
    accent_soft: "rgba(0,136,255,0.14)"
    bubble_user: "rgba(0,0,0,0.06)"
    bubble_user_fg: "#222222"
    success: "#128a4a"
    success_soft: "rgba(17,185,129,0.14)"
    danger: "#c92a2a"
    danger_soft: "rgba(239,68,68,0.12)"
    diff_added: "#128a4a"
    diff_added_soft: "rgba(18,138,74,0.10)"
    diff_removed: "#c92a2a"
    diff_removed_soft: "rgba(201,42,42,0.10)"
    skill: "#7c3aed"
    skill_soft: "rgba(124,58,237,0.12)"
    warning_soft: "rgba(245,158,11,0.14)"
    selection: "rgba(0,136,255,0.18)"
    scrollbar_thumb: "rgba(95,104,120,0.22)"
    scrollbar_thumb_hover: "rgba(95,104,120,0.32)"
  dark:
    bg_app: "#101010"
    bg_sidebar: "#141414"
    bg_canvas: "#181818"
    surface_card: "rgba(24,24,24,0.92)"
    surface_elevated: "#202020"
    surface_subtle: "#202020"
    surface_hover: "rgba(255,255,255,0.10)"
    border: "rgba(255,255,255,0.10)"
    border_muted: "rgba(255,255,255,0.10)"
    border_strong: "rgba(255,255,255,0.16)"
    text: "#ffffff"
    text_muted: "#c7c7c7"
    text_faint: "#858585"
    text_placeholder: "#7a7a7a"
    accent: "#339cff"
    accent_soft: "rgba(51,156,255,0.18)"
    bubble_user: "rgba(255,255,255,0.08)"
    bubble_user_fg: "#ffffff"
    success: "#40c977"
    success_soft: "rgba(64,201,119,0.18)"
    danger: "#fa423e"
    danger_soft: "rgba(250,66,62,0.18)"
    diff_added: "#40c977"
    diff_added_soft: "rgba(64,201,119,0.16)"
    diff_removed: "#fa423e"
    diff_removed_soft: "rgba(250,66,62,0.16)"
    skill: "#ad7bf9"
    skill_soft: "rgba(173,123,249,0.16)"
    warning_soft: "rgba(245,158,11,0.18)"
    selection: "rgba(51,156,255,0.24)"
    scrollbar_thumb: "rgba(170,170,170,0.28)"
    scrollbar_thumb_hover: "rgba(200,200,200,0.38)"

# ---------- 2. Typography ----------
typography:
  family:
    sans: "SF Pro Text, 'PingFang SC', 'Noto Sans SC', 'Helvetica Neue', Arial, sans-serif"
    display: "SF Pro Display, 'PingFang SC', 'Noto Sans SC', sans-serif"
    mono: "SF Mono, 'JetBrains Mono', 'IBM Plex Mono', monospace"
  size_scale_px:  # values actually used in JSX
    [9, 10, 10.5, 11, 11.5, 12, 12.5, 13, 13.5, 14, 14.5, 15, 16, 18, 24, 30]
  size_rhythm:
    caption: 11
    label_small: 11.5
    chip: 10
    chip_md: 12
    body_sm: 12.5
    body: 13
    body_lg: 14
    body_xl: 14.5
    title_sm: 15
    title: 16
    title_lg: 18
    display: 24
    hero: 30
  weight_scale: [400, 500, 600, 700]
  leading:
    tight: 5
    snug: 6
    normal: 7
  tracking:
    normal: 0
    wide: 0.04
  ui_zoom_factor:
    small: 0.82
    medium: 0.88
    large: 1.00
  # Where each scale is used:
  usage:
    hero: "Welcome card, marketing-style headings"
    title_lg: "Topbar session title, settings section H2"
    title: "Card titles, dialog title"
    title_sm: "Strong inline label"
    body_xl: "Settings subtitle, session header sub"
    body_lg: "Primary form input text, list row primary"
    body: "Default body, button text, table cell"
    body_sm: "Secondary metadata, list row secondary"
    label_small: "Tab label, table header"
    caption: "Helper text, hint line"
    chip: "Status chip, tag"

# ---------- 3. Spacing & sizing ----------
spacing:
  base_unit_px: 4
  scale: [0, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 8, 10, 12]
  # Tailwind px values: 1=4 1.5=6 2=8 2.5=10 3=12 4=16 5=20 6=24 8=32
  card_padding:
    tight: "px-3 py-2"     # 12x8
    normal: "px-4 py-3"    # 16x12
    loose: "px-5 py-4"     # 20x16
  block_gap: [1, 1.5, 2, 2.5, 3]
  # Fixed panel sizes (from Workbench.tsx defaults)
  layout:
    left_sidebar_default_px: 268
    left_sidebar_min_px: 236
    left_sidebar_max_px: 420
    right_inspector_default_px: 360
    right_inspector_min_px: 280
    right_inspector_max_px: 760
    sidebar_hard_min_px: 180

# ---------- 4. Border radius ----------
radius:
  scale_px: [4, 6, 8, 10, 12, 14, 16, 18, 22, 28, 9999]
  alias:
    sm: 6        # rounded-md
    md: 8        # rounded-lg
    lg: 12       # rounded-xl — most card surfaces
    xl: 14       # tailwind xl
    "2xl": 16    # rounded-2xl
    "2.5xl": 18  # rounded-[18px] — topbar dropdown
    "3xl": 22    # rounded-3xl
    composer: 28 # .ds-chat-composer
    pill: 9999   # rounded-full — chip / pill button / avatar
  usage:
    chip: pill
    pill_button: pill
    avatar: pill
    card_default: lg
    dialog: "3xl"
    topbar_dropdown: "2.5xl"
    composer: composer
    inline_code: sm
    icon_only_button: md

# ---------- 5. Elevation (shadows + dark-mode shadows) ----------
elevation:
  light:
    chip: "inset 0 1px 0 rgba(255,255,255,0.78)"
    card_soft: "0 10px 28px rgba(15,23,42,0.06)"
    card_strong: "0 14px 36px rgba(15,23,42,0.09)"
    panel: "0 16px 44px rgba(15,23,42,0.06)"
    shell: "0 12px 30px rgba(15,23,42,0.08)"
    composer: "0 18px 46px rgba(15,23,42,0.10), 0 5px 16px rgba(15,23,42,0.06)"
    dropdown: "0 18px 52px rgba(15,23,42,0.18)"
    topbar: "0 16px 42px rgba(15,23,42,0.05), inset 0 1px 0 rgba(255,255,255,0.64)"
  dark:
    chip: "inset 0 1px 0 rgba(255,255,255,0.045)"
    card_soft: "0 16px 42px rgba(0,0,0,0.22)"
    card_strong: "0 22px 56px rgba(0,0,0,0.30)"
    panel: "0 22px 58px rgba(0,0,0,0.35)"
    shell: "0 38px 96px rgba(0,0,0,0.55)"
    composer: "0 28px 78px rgba(0,0,0,0.45), 0 0 0 1px rgba(255,255,255,0.06)"
    dropdown: "0 22px 58px rgba(0,0,0,0.38)"
    topbar: "0 18px 44px rgba(0,0,0,0.24), inset 0 1px 0 rgba(255,255,255,0.07)"

# ---------- 6. Motion ----------
motion:
  timing_ms:
    micro: 140       # hover bg, border, color
    standard: 150     # card hover, transform
    deep: 300
  easing: ease       # mostly linear ease
  special:
    pulse: 1800      # ms, ease-in-out, infinite (logo / status dot)
    shiny_text: 2400 # ms, ease-in-out, infinite (streaming shimmer)
  transform:
    card_lift: "translateY(-1px)"
    button_press: "scale(0.985)"
  when_to_use:
    micro: "chip hover, menu item hover, focus ring swap"
    standard: "card hover, composer border on focus, topbar glass"
    deep: "modal open, route transition"

# ---------- 7. Z-index ----------
z_index:
  background: -2
  background_overlay: -1
  base: 0
  sticky: 10
  dropdown: 50
  modal: 100
  toast: 200

# ---------- 8. Window chrome & layout container ----------
window:
  app_region: drag           # html/body/-webkit-app-region
  no_drag_class: ds-no-drag  # add to anything clickable in the title bar
  macos_top_inset_px: 42     # safe area for traffic-light controls
  app_icon: src/asset/img/kun.png
  secondary_logos: [kun_mac.png, kun_tray.png]

# ---------- 9. Iconography ----------
icons:
  library: lucide-react
  default_size_px: 16
  common_sizes_px: [14, 16, 18, 20, 24]
  color: currentColor

# ---------- 10. Component patterns (the recurring building blocks) ----------
components:
  card:
    base: "border border-ds-border bg-ds-card rounded-xl shadow-sm"
    strong: "border-ds-border-strong bg-ds-elevated shadow-[ds-shadow-card-strong] backdrop-blur-xl"
  button_primary:
    base: "inline-flex items-center gap-1.5 rounded-full bg-accent px-4 py-2 text-[13px] font-semibold text-white transition hover:brightness-110"
    shadow: "0 10px 24px rgba(0,136,255,0.22)"
  button_secondary:
    base: "inline-flex items-center gap-1.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] font-medium text-ds-ink shadow-sm transition hover:bg-ds-hover disabled:opacity-50"
  button_pill:
    base: "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition"
  input:
    base: "w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[14px] text-ds-ink shadow-sm focus:border-accent/40 focus:outline-none focus:ring-1 focus:ring-accent/30"
  chip:
    base: "inline-flex items-center gap-1 rounded-full bg-accent/10 px-1.5 py-0.5 text-[10px] font-semibold text-accent"
    muted: "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[12.5px] font-medium text-ds-muted bg-ds-subtle shadow-sm"
  user_bubble:
    base: "rounded-xl bg-ds-userbubble px-3 py-2 text-[13px] font-medium text-ds-userbubbleFg shadow-sm"
  code_inline:
    base: "rounded-md bg-ds-inline-code-bg px-1.5 py-0.5 font-mono text-[12px] text-ds-ink"
  code_block:
    base: "rounded-xl border border-ds-border-muted bg-ds-pre-bg p-3 font-mono text-[12px] leading-5 text-ds-ink"
  status_dot:
    base: "h-2 w-2 rounded-full bg-accent animate-pulse"
  kbd:
    base: "rounded bg-ds-kbd-bg px-1.5 py-0.5 font-mono text-[11px] text-ds-muted shadow-[inset_0_1px_0_rgba(255,255,255,0.45)]"
  modal:
    container: "fixed inset-0 z-100 flex items-center justify-center bg-black/40 backdrop-blur-sm"
    panel: "w-full max-w-md rounded-3xl border border-ds-border bg-ds-elevated p-6 shadow-[ds-shadow-panel]"

# ---------- 11. Topography & gradient backgrounds ----------
backgrounds:
  app_gradient_light: "linear-gradient(180deg, #fbfcfe 0%, #ffffff 100%)"
  app_gradient_dark: "linear-gradient(180deg, #101010 0%, #181818 100%)"
  sidebar_gradient_light: "linear-gradient(180deg, rgba(248,251,254,0.98) 0%, rgba(242,247,252,0.98) 100%)"
  sidebar_gradient_dark: "linear-gradient(180deg, #181818 0%, #141414 45%, #101010 100%)"
  topbar_gradient_light: "linear-gradient(180deg, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.58) 58%, rgba(255,255,255,0.30) 100%)"
  topbar_gradient_dark: "linear-gradient(180deg, rgba(32,32,32,0.86) 0%, rgba(24,24,24,0.70) 58%, rgba(18,18,18,0.42) 100%)"
  body_glaze_light: "linear-gradient(180deg, rgba(255,255,255,0.50), transparent 22%), linear-gradient(120deg, rgba(255,255,255,0.22), transparent 34%, rgba(255,255,255,0.12) 74%, transparent)"
  body_glaze_dark: "linear-gradient(180deg, rgba(255,255,255,0.04), transparent 24%), linear-gradient(120deg, rgba(255,255,255,0.03), transparent 35%, rgba(255,255,255,0.02) 72%, transparent)"
  composer_glow: "radial-gradient(circle at top left, rgba(0,136,255,0.07), transparent 28%), radial-gradient(circle at right 14% bottom 18%, rgba(0,136,255,0.04), transparent 24%), linear-gradient(180deg, rgba(255,255,255,0.08), transparent 28%)"

# ---------- 12. i18n & copy tone ----------
i18n:
  locales: [zh, en]
  default: zh
  tone: "helpful, direct, never robotic; first-person plural when describing product ('we ship'), second-person for the user. No emoji in production copy."
  error_format: "human sentence ending in punctuation; never raw stack traces"

# ---------- 13. Brand & voice ----------
brand:
  product_name: "Kun"
  tagline: "把 Kun 的本地智能体能力带进桌面窗口"
  hero_kw: [Code, Write, Connect phone]
  pillars:
    - "本地优先 (Local-first): settings, sessions, logs all on disk; model calls use your own DeepSeek API key."
    - "可观察 (Observable): every tool call, file change, reasoning step surfaces in the UI."
    - "可控制 (Controllable): approval policy + sandbox mode + interrupt + revert."
  voice: "Direct, no marketing fluff. Show what the agent did, not how great it is."

# ---------- 14. Accessibility ----------
a11y:
  focus_ring: "1px ring-1 ring-accent/30 with 40% accent border"
  focus_visible_only: true
  hit_target_min_px: 32
  contrast_target: WCAG_AA
  selection_color: var(--ds-selection)
  respects_prefers_reduced_motion: false  # TODO: pending
  keyboard_shortcuts:
    Enter: "send message"
    Shift_Enter: "newline in composer"
    Ctrl_Enter: "send message"
    Esc: "close panel / dismiss popover"

# ---------- 15. Don't (anti-patterns enforced by the codebase) ----------
dont:
  - "Use a second live agent runtime — Kun is the only one."
  - "Add AgentSwitcher / ConnectionStatusBar / RuntimeDiagnosticsDialog."
  - "Add CodeWhale/Reasonix adapters, process managers, RPC bridges, updaters, importers."
  - "Add a design/drawing starter card in the core workbench."
  - "Add /usage or /runtime slash command that opens a runtime control panel."
  - "Save settings under agents.codewhale or agents.reasonix; only agents.kun."
  - "Use emoji in production copy or as functional UI affordance."
  - "Apply a tint or hue that isn't in the palette above."
  - "Use a font outside the three declared families."
  - "Use a border radius smaller than 4px on a clickable surface."
---

# Kun — DESIGN.md

> 单一权威设计文档。所有屏幕、所有组件、所有视觉决策,都从这里出。

---

## 0. How to read this file

This file has two layers, on purpose:

- **YAML frontmatter (`---` block at the top)** — machine-readable design
  tokens (exact hex values, font stacks, spacing scale, radius scale,
  shadows, motion timings, component recipes). Design agents (Stitch,
  Figma plugins, future codegen tools) read this and apply it verbatim.
  When you change a value, change it here **and** in
  `src/renderer/src/styles/*.css` / `src/renderer/src/index.css` so the running
  app and this file stay in sync.
- **Markdown body** — the human-readable *why*. Design intent,
  principles, anti-patterns, and per-screen rules. This is what a
  contributor reads when they're deciding whether a new screen is
  on-brand.

Treat the frontmatter as the source of truth for values and the
markdown as the source of truth for judgment. If they ever conflict,
the frontmatter wins, and the markdown needs an update.

---

## 1. Project at a glance

Kun (formerly DeepSeek GUI) is a local desktop workbench built
around its namesake **Kun** runtime. The desktop shell is Electron; the runtime is a TypeScript
package that speaks HTTP/SSE; the renderer is React 19 + Zustand 5;
the visual system is TailwindCSS 3 with a hand-built token layer on
top.

The product is **not** another chat shell. It exists to let a real
agent do real work in a real project on a real machine, with the
human staying in the loop on every mutating call.

**Two workbenches plus connected entry points, one runtime:**

| Surface | Job to be done |
| --- | --- |
| **Code** | Bound to a local repo, drives the agent through tool calls, file changes, commands, and review. |
| **Write** | A long-form writing space: Markdown files, FIM completion, selection-scoped inline agent. |
| **Connect phone** | Background automation: Feishu / Lark channels, webhook / relay, scheduled tasks. Internal route and storage names still use `claw` for compatibility. |

All product surfaces share the same Kun HTTP/SSE boundary, the same
settings (API key, base URL, model), and the same visual system.

---

## 2. Design principles

These six rules are not aspirations — they are how the product is
already built. New screens must follow them, not re-interpret them.

1. **One runtime, one boundary.** Code, Write, and Connect phone all call
   `kun serve` over `127.0.0.1:port`. The renderer never
   embeds an agent loop and never speaks a second protocol. This
   keeps upgrades and debugging boring.
2. **Local-first, observable, controllable.** Settings, sessions,
   and runtime state live on disk under the OS app-data folder.
   Every tool call, file change, and reasoning step is shown in
   the UI. The user can interrupt, approve, deny, or revert at any
   point.
3. **No agent switcher, no runtime console.** The product
   intentionally does not surface runtime diagnostics, provider
   selection, or model-control panels. If a runtime detail is
   important, it goes in Settings, not in the main canvas.
4. **The renderer maps HTTP, it does not implement agent logic.**
   Approvals, steering, compaction, fork, resume, usage — all
   come from Kun endpoints, never re-implemented in React.
5. **Stable visual identity, not visual novelty.** A new screen
   should look like a sibling of an existing one, not a fresh
   experiment. New components earn their place by replacing
   multiple existing ones, not by adding a new style.
6. **Calm by default.** The default surface is a near-white (or
   near-black) canvas with restrained surfaces, no chroma in the
   chrome, and a single accent that only appears on actionable
   elements. Status, danger, and skill are the only other colors
   you may reach for.

---

## 3. How the project should look and feel

> **This section is the editorial companion to the YAML frontmatter
> above.** Values in the frontmatter are the contract; values here
> are the *why* and the *when*.

### 3.1 The "feel" in one paragraph

A near-paper canvas (light) or near-charcoal canvas (dark), a single
**blue accent** that only lights up when the user can act on
something, pill-shaped chrome on a desktop title bar, generous
whitespace, layered translucent surfaces that read as "glass", and
text that is dense but never crowded. The product feels like a
**calm professional tool** — closer to a code editor than to a
chat app. It must not feel like a marketing site.

### 3.2 Canvas, surface, elevation

The renderer paints two layers behind the chrome:

- **Base canvas** (`--ds-bg-canvas`, `#ffffff` light / `#181818` dark)
  is the central work area. The chat timeline, the writing editor,
  and the file tree all live on this canvas.
- **Surrounding surface** (`--ds-bg-main`, `#f5f7fa` light / `#101010`
  dark) is the app shell. Sidebars, topbar, and inspectors
  rest on it. The contrast between canvas and surface is
  intentionally small — about 4% — so the eye reads them as one
  workspace, not two zones.

On top of those, three translucent glass surfaces stack:

- `ds-card` / `ds-surface-card` — cards, list rows, popover triggers.
- `ds-elevated` / `ds-surface-elevated` — dialogs, dropdowns, the
  composer shell, anything that must lift off the page.
- `ds-subtle` / `ds-surface-subtle` — quiet secondary surfaces
  (e.g. settings tabs that are not currently active).

Glass effect is achieved with `backdrop-blur-xl` (24px) plus a faint
`inset 0 1px 0 rgba(255,255,255,0.45)` highlight on chips, and the
topbar carries a 3-stop vertical gradient
(`topbar_gradient_light` / `topbar_gradient_dark`) so the title bar
reads as a soft glass strip.

A subtle body glaze (`body_glaze_light` / `body_glaze_dark`)
sits on `body::after` to add a soft directional light without ever
introducing a new color.

### 3.3 Color, when to use it

The accent is **electric blue** (`#0088ff` light / `#339cff` dark).
Use it for *exactly* these things:

- The primary action button ("Send", "Allow", "Save").
- A focused form control's border + ring.
- Status dots that mean "this is live and doing something".
- Hyperlink-style chip labels (e.g. a feature flag toggle).
- Selection background (`--ds-selection`).

Do **not** use accent for:

- Decorative background fills larger than a chip.
- Body text or headings.
- Disabled state — disabled elements are *opacity 0.45*, not
  recolored.

Other named colors are reserved for their semantic:

- `--ds-success` / `--ds-success-soft` — completed tools, cached
  read, OK health pings.
- `--ds-danger` / `--ds-danger-soft` — failed tools, denied
  approvals, errors, retry badges.
- `--ds-skill` / `--ds-skill-soft` — anything related to a user-loaded
  Skill (purple is the "this came from a plugin" hue).
- `--ds-diff-added` / `--ds-diff-removed` — file change diff blocks.
  These are the **only** colors that may sit side-by-side on a code
  block.
- `--ds-warning-soft` — non-fatal warnings (e.g. token cache
  missing, retry-pending).

Everything else — text, borders, the canvas itself, the sidebar —
stays in the neutral palette. If a screen needs more than accent
plus these named semantic colors, it is probably a sign the
information architecture should change first.

### 3.4 Typography

Three families, and only three:

- **Sans (body)**: SF Pro Text → PingFang SC → Noto Sans SC → Helvetica
  Neue → Arial. The product is bilingual (zh + en), so the cascade
  covers macOS, Windows, and Linux. Set as
  `body { font-family: ... }` in `index.css`.
- **Display (hero, welcome)**: SF Pro Display, same CJK fallback.
  Used sparingly — only in welcome cards and modal hero copy.
- **Mono**: SF Mono → JetBrains Mono → IBM Plex Mono. Used for code
  blocks, inline code, kbd hints, command lines, model ids,
  and tool result detail.

The size rhythm in `typography.size_rhythm` is the only allowed
ladder. If you find yourself reaching for `text-[15.5px]` you're
probably between two rungs — pick the closer one or restructure.

Default `leading` is `leading-relaxed` for body prose, `leading-5`
or `leading-6` for compact UI lists, and tight (`leading-tight`)
only for hero headings. Never `leading-none` except in chips.

`tracking-wide` is reserved for the small uppercase section labels
(`text-[11px] font-semibold uppercase tracking-wide text-ds-faint`)
that appear above settings groups. Nothing else uses letter-spacing.

### 3.5 Spacing & rhythm

The product uses Tailwind's default 4-px scale. Three rules:

1. **Card padding is `px-3 py-2` (tight) or `px-4 py-3` (normal).**
   `px-5 py-4` is reserved for hero cards and full-screen modals.
2. **Inline element gap is `gap-1` to `gap-3`.** Beyond `gap-4`,
   you're starting a new region; use vertical margin instead.
3. **Section spacing is `mt-3` to `mt-6`.** Anything tighter than
   `mt-3` should be `gap-*` on a flex parent; anything wider than
   `mt-6` should probably be a new card or a divider.

The fixed three-pane layout sizes are part of the design system,
not an accident. Don't let a new screen override the sidebar
defaults — that's what `--ds-layout-left-sidebar-width` is for.

### 3.6 Radius, shape, and "softness"

The product reads as **soft but not round**. Pill controls (`rounded-full`)
on the title bar, large `rounded-xl` / `rounded-2xl` cards in the
body, and a single oversized `rounded-[28px]` shell for the
composer. Smaller radii (`rounded-md`, `rounded-lg`) appear on
inline code, kbd, and icon-only buttons.

Two hard rules:

- **No square corners on a clickable surface.** Minimum 6px.
- **No fully-rounded corners on a card surface.** Cards are
  `rounded-xl` to `rounded-3xl`, never pill-shaped.

### 3.7 Elevation & shadow

Three elevation tiers, in increasing depth:

1. **Card soft** — list rows, side panels, in-page popovers.
   Subtle, single shadow.
2. **Card strong / panel** — modals, dropdowns, the composer.
   Deeper shadow + `backdrop-blur-xl` to read as "lifted glass".
3. **Shell** — the main app shell, the welcome screen, the
   settings root. Largest shadow, used sparingly.

Chips and pill buttons get an *inset* highlight
(`inset 0 1px 0 rgba(255,255,255,0.78)` light) so they look pressed
out of a glass surface, not painted onto one.

Never use a colored shadow. All shadows are black or near-black
with low alpha.

### 3.8 Motion

Motion is **functional, not decorative**. It exists to:

- Confirm a click (button press, focus ring swap) — 140 ms.
- Reveal a hover state (card lift, chip background) — 150 ms.
- Smooth a route or panel change — 200-300 ms.
- Indicate liveness (status dot, streaming shimmer) — looped, 1.8-2.4 s.

Two looped animations exist in the system:

- `pulse` on status dots and the work logo.
- `ds-shiny-text` on streaming assistant text (a 2.4s linear
  shimmer, not a typewriter).

Everything else is one-shot. Do not animate entry/exit of dialogs
beyond a 200ms opacity+scale. Do not animate hover on rows
containing many cells. Do not animate the composer.

### 3.9 Layout grammar

Every screen in Kun follows the same macro-grammar:

- **Topbar**: a translucent strip with the back button, session
  title, mode switcher, and right-side action cluster. The topbar
  is *always* draggable for window move; interactive elements
  inside it must opt out with `.ds-no-drag`.
- **Left sidebar**: workspace roots (Code) / channels (Connect phone,
  internal `claw`) /
  spaces (Write). Collapsible, drag-resizable, 268 px default.
- **Center column**: the work surface — message timeline (Code /
  Connect phone) or editor (Write). Never bleed into the sidebars.
- **Right inspector**: optional, context-driven — Changes,
  Todo, Browser, Plan, File, Write Assistant, and SDD Assistant.
  Drag-resizable, 360 px default. The Write assistant and SDD
  assistant both use this slot.

A new screen should fit into this grammar. If it can't, that is a
signal the grammar needs to grow — and the change goes in this file
first.

### 3.10 Voice and copy

- The product is bilingual. Strings live under
  `src/renderer/src/locales/{zh,en}/` and are loaded through
  `react-i18next`. New strings ship in both locales at the same
  time.
- Tone is direct, helpful, and slightly opinionated. First-person
  plural when describing the product ("we ship", "we ship Code,
  Write, and Connect phone"), second person for the user. No emoji. No
  marketing language. Error messages are full sentences ending in
  punctuation; never a raw stack trace.
- The product name is "Kun" (formerly "DeepSeek GUI"). The bundled
  runtime shares the name; say "Kun runtime" when the distinction matters.
  The main workbenches are "Code" and "Write"; the phone/IM surface is
  "Connect phone" in English and "连接手机" in zh copy. Internal code may
  still say `claw`, but production copy should not expose it as the product name.

### 3.11 Theme switching

Three modes: `system`, `light`, `dark`. The choice is in Settings →
General. `system` listens to `prefers-color-scheme` and updates
live. The theme is applied as `data-theme` on `<html>`; Tailwind
`dark:` variants and CSS custom properties both pick it up. UI
font scale is independent (small / medium / large) and is applied
as a CSS `--ds-ui-scale` zoom factor.

Every new screen must work in both themes without per-screen
overrides. The token system is the contract.

### 3.12 What "on-brand" looks like — quick test

Before shipping a new screen, run this checklist:

- [ ] Sits in the standard three-pane + topbar grammar (or
      explicitly extends it in this file).
- [ ] Uses only the four families of color (neutral, accent,
      status, skill/diff).
- [ ] Uses only the three font families and the size rhythm.
- [ ] Uses the radius ladder (no square clickables, no round cards).
- [ ] Uses elevation tiers, not custom shadows.
- [ ] All interactive elements have a focus ring (`ring-1
      ring-accent/30`).
- [ ] Strings exist in both `zh` and `en` locale files.
- [ ] No emoji, no marketing copy, no extra runtime surface.
- [ ] No agent switcher, no runtime diagnostics, no legacy
      CodeWhale/Reasonix import.

If any box is unchecked, fix it before merging.

---

## 4. Top-level architecture

```text
┌─────────────────────────────────────────────────────────────┐
│ Renderer (React 19 + Zustand 5)                             │
│  AppShell  →  Workbench  →  (Code | Write | Connect phone) UI│
│       │                                                      │
│       │ window.dsGui.runtimeRequest / startSse              │
│       ▼                                                      │
│ Preload (contextBridge, contextIsolated)                    │
│  dsGui.* IPC surface                                         │
│       │                                                      │
│       ▼                                                      │
│ Main process (Node)                                          │
│  RuntimeHost  →  kunRuntimeAdapter                    │
│  Settings / Connect phone runtime / Terminal / Updater / Logger│
│       │                                                      │
│       │ spawn child process + HTTP/SSE                       │
│       ▼                                                      │
│ Kun (TypeScript package)                              │
│  serve --host 127.0.0.1 --port 7878                          │
│  /health · /v1/* · SSE /v1/threads/{id}/events              │
│  cache-first AgentLoop · ports & adapters · append-only log  │
│       │                                                      │
│       │ HTTPS to model API                                   │
│       ▼                                                      │
│ DeepSeek (or OpenAI-compatible) chat/completions             │
└─────────────────────────────────────────────────────────────┘
```

Three lessons baked into this shape:

1. The renderer **does not know** which runtime it talks to
   beyond "kun". Switching providers is not a product
   surface; it's a main-process concern.
2. The main process **does not implement agent logic**. It
   spawns the child, forwards HTTP, and forwards SSE. It also
   owns GUI-only services (settings, updater, Connect phone runtime,
   workspace
   files, external editors, and Write export/completion) that the
   renderer can ask for.
3. Kun **is** the agent. Loop, tool host, stores, model
   client, server — all in one process, behind one HTTP/SSE
   boundary.

---

## 5. Core runtime: Kun

The Kun package (`kun/`) is the single active agent
runtime. It is a TypeScript ESM package that ships its own HTTP
server and is built before the Electron app.

### 5.1 Module layout

```text
kun/src/
  cli/             # Command-line entrypoints (serve)
  contracts/       # Zod schemas and inferred types for HTTP/SSE
  domain/          # Thread, Turn, Item, Event, Approval, Usage entities
  ports/           # ModelClient, ToolHost, ThreadStore, SessionStore,
                   # ApprovalGate, EventBus, WorkspaceInspector, Clock
  adapters/        # DeepSeek-compatible model client, local tool host,
                   # in-memory and file-backed stores, workspace inspector
  services/        # Thread and turn orchestration services
  loop/            # Cache-first AgentLoop, InflightTracker,
                   # SteeringQueue, ContextCompactor
  cache/           # ImmutablePrefix, LRU cache, TTL-LRU cache
  telemetry/       # Usage counter, cache telemetry
  server/          # HTTP server, router, auth, SSE, response helpers,
                   # runtime-factory, route handlers
  prompt/          # System prompt for the Kun identity
  shared/          # Shared types with the GUI
```

### 5.2 Hexagonal shape

Kun is structured as **ports & adapters**:

- `contracts/` — the boundary. Zod schemas describe every HTTP/SSE
  DTO. This is what the GUI imports indirectly through its mapper
  (`src/renderer/src/agent/kun-contract.ts`).
- `domain/` — entities. Thread, Turn, Item, Event, Approval, Usage.
  No I/O.
- `ports/` — interfaces. The agent loop only knows about
  `ModelClient`, `ToolHost`, `ThreadStore`, `SessionStore`,
  `ApprovalGate`, `EventBus`, `WorkspaceInspector`, `Clock`,
  `IdGenerator`. These are intentionally small.
- `adapters/` — concrete implementations. The default
  `DeepseekCompatModelClient` speaks the
  `POST {baseUrl}/v1/chat/completions` shape; the default
  `LocalToolHost` runs tools in-process with approval gating.
- `services/` — orchestration. `ThreadService` and `TurnService`
  own the lifecycle of a thread and a turn; they wire stores,
  models, and tools together.
- `loop/` — the agent loop. Pure orchestration over the ports.
- `server/` — the thin HTTP transport that exposes everything.

A new capability should land as a new port + adapter, never as a
new server handler that reaches into the loop directly. The
boundary is the test.

### 5.3 Cache-first agent loop

The loop is built around DeepSeek's native cache hit/miss
telemetry. The principles:

- **Immutable prompt prefix** with a sha256 fingerprint. The
  system prompt, tool schemas, pinned constraints, and few-shots
  form the prefix; mutation goes through `setSystemPrompt`,
  `setTools`, `setPinnedConstraints`, `setFewShots`, which
  invalidate the fingerprint. `verifyImmutablePrefix` is called
  at the start of every model step — a drift throws immediately.
- **Append-only session log.** Every turn is a JSONL stream;
  the next replay skips malformed lines but keeps the rest.
  Indexes are atomic JSON writes.
- **Bounded TTL/LRU caches.** Tools, model responses, and
  computed fingerprints are cached with explicit eviction.
- **Inflight tracking with guaranteed cleanup.** `InflightTracker`
  is the authoritative source for SSE event pairs.
  `run(record, work)` registers an id, runs the work, and
  removes the id in a `finally` — even on abort.
- **Mid-turn steering.** `SteeringQueue` collects user messages
  posted while a turn is running and injects them as user inputs
  at the next safe loop boundary.
- **Context compaction.** `ContextCompactor` folds long histories
  into a single `compaction` item, always preserving the
  pinned constraints from the immutable prefix. Soft threshold
  16k tokens, hard threshold 24k tokens.
- **Tool pair healing.** Before sending history to the model,
  Kun drops orphan `tool_result`s and tool calls with
  missing results, to avoid 400/retry storms.

Cache hit rate is reported as `hit / (hit + miss)` using
DeepSeek's native `prompt_cache_hit_tokens` /
`prompt_cache_miss_tokens` fields. Compat fields
(`cached_tokens`, `cache_read_input_tokens`) are fallback only.

A healthy warm thread should hold ≥ 90% cache hit rate.
Verified on 2026-06-02: 12 short turns warm ran 94.7% hit; 24
short turns on the same warm prefix ran 95.2% overall, 98.1% on
the latest turn.

### 5.4 HTTP/SSE surface

The HTTP server is built on a hand-rolled `Router` that supports
`:id` params. Bearer-token auth via
`Authorization: Bearer <runtime-token>`, or `--insecure` for
local dev only. The routes:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/health` | unauthenticated health probe |
| GET | `/v1/workspace/status?path=…` | git/branch status for a workspace |
| GET | `/v1/threads?include=side` | list threads (most recent first; `side` hidden by default) |
| POST | `/v1/threads` | create a thread |
| GET | `/v1/threads/{id}` | read thread + turns |
| PATCH | `/v1/threads/{id}` | update title/status/approval/sandbox/relation |
| DELETE | `/v1/threads/{id}` | delete a thread |
| POST | `/v1/threads/{id}/fork` | fork (relation: `fork` default, or `side`) |
| POST | `/v1/threads/{id}/turns` | start a turn |
| GET | `/v1/threads/{id}/turns/{turnId}` | read a turn |
| POST | `/v1/threads/{id}/turns/{turnId}/steer` | queue steering text |
| POST | `/v1/threads/{id}/turns/{turnId}/interrupt` | abort a turn |
| POST | `/v1/threads/{id}/compact` | fold old history |
| GET | `/v1/threads/{id}/events?since_seq=N` | SSE backlog + live |
| POST | `/v1/approvals/{id}` | allow / deny |
| POST | `/v1/user-inputs/{id}` and `/v1/user-input/{id}` | submit / cancel user input answers |
| POST | `/v1/sessions/{id}/resume-thread` | resume a session into a thread |
| GET | `/v1/usage` | cumulative token / cache / turn counters |

SSE frames use `id: <seq>`, `event: <kind>`, and JSON `data:`. A
late-joining client passes `since_seq` (or `Last-Event-ID`) and
receives the backlog before live events. A heartbeat is sent
every 15 s to keep idle proxies alive.

### 5.5 Thread record & relation

Every thread persisted under `{data-dir}/threads/{id}/thread.json`
carries `relation` metadata:

- `primary` — top-level thread (default).
- `fork` — manual fork that switches the user away.
- `side` — "by-the-way" side conversation inherited from a
  parent snapshot. Excluded from the default thread listing; pass
  `?include=side` to opt in. Has `parentThreadId` set;
  promoting back to `primary` clears it.

The `fork` and `side` lineage also store `forkedFromThreadId`,
`forkedFromTitle`, `forkedAt`, and message/turn counts at fork
time. The GUI surfaces these in the sidebar.

### 5.6 Approval & sandbox

`ToolHostContext` carries `approvalPolicy` and the tool host
gates at two layers: `policy: 'never'` blocks up front;
`on-request` / `suggest` / `untrusted` always prompt unless
the call is in the `allowList`. Tools that need to be scoped
to a specific mode (e.g. `create_plan` only inside a `plan`
thread) declare a `shouldAdvertise(ctx)` predicate that filters
both the listing and the execution.

`SandboxMode` (`read-only` / `workspace-write` /
`danger-full-access` / `external-sandbox`) is enforced by the
workspace inspector and the file/tool adapters.

### 5.7 Persistence

`--data-dir` is the on-disk root for everything the runtime
owns:

```text
{data-dir}/
  threads/
    index.json
    {threadId}/
      thread.json     # ThreadRecord
      messages.jsonl  # TurnItem append-only
      events.jsonl    # RuntimeEvent append-only
      session.json    # latest AgentSession projection
```

Atomic JSON writes for `index.json`, `thread.json`, and
`session.json`. JSONL streams tolerate malformed lines (the
next replay skips them).

---

## 6. Desktop shell (Electron)

### 6.1 Process roles

- **Main** (`src/main/`) — Node process. Owns the Kun
  child process, settings store, updater, Connect phone runtime,
  file/git/editor helpers, Write services, IPC handlers, logger,
  GUI updater, macOS/Windows code-signing glue.
- **Preload** (`src/preload/`) — `contextBridge` surface.
  Exposes a typed `window.dsGui` API to the renderer. No Node
  access leaks into the renderer.
- **Renderer** (`src/renderer/`) — Chromium process. React 19
  SPA. Runs Code / Write / Connect phone UIs.

### 6.2 Module layout

```text
src/
  main/
    index.ts                        # app entry, IPC wiring, lifecycle
    ipc/                            # app IPC handlers and Zod schemas
    runtime/                        # runtime adapter (process, host, port, token)
    services/                       # git, workspace, editor, write-* services
    settings-store.ts               # JSON-backed settings store
    claw-runtime.ts                 # Connect phone IM / webhook / scheduled-task engine (internal claw name)
    claw-schedule-mcp-*             # schedule MCP config + standalone server
    gui-updater.ts                  # electron-updater integration
    logger.ts                       # structured logger
    resolve-kun-binary.ts     # CLI / dev-script / packaged binary resolver
  preload/
    index.ts                        # contextBridge surface (window.dsGui)
    index.d.ts                      # API type definitions
  shared/                           # types + constants shared by main and renderer
  renderer/
    src/
      App.tsx                       # Suspense shell
      AppShell.tsx                  # routes Workbench / Settings / InitialSetup
      agent/                        # AgentProvider interface + Kun impl
      components/                   # Workbench, Settings, ChangeInspector, …
      hooks/
      lib/                          # formatters, helpers, plan store, etc.
      locales/{zh,en}/              # i18n
      plan/                         # Plan-mode prompt, store, panel
      store/                        # Zustand chat store + actions
      write/                        # Write-mode workspace, inline edit, RAG
```

### 6.3 The dsGui API surface

`window.dsGui` is the only thing the renderer is allowed to call
on the system. It includes:

- `runtimeRequest(path, method, body)` — generic JSON request to
  Kun.
- `startSse(threadId, sinceSeq, streamId)` / `stopSse` /
  `onSseEvent` — SSE subscription for a thread.
- `getSettings` / `setSettings` — typed settings I/O.
- Workspace / file / git helpers (`pickWorkspaceDirectory`,
  `listWorkspaceDirectory`, `readWorkspaceFile`,
  `writeWorkspaceFile`, `watchWorkspaceFile`, `getGitBranches`,
  `switchGitBranch`, `createAndSwitchGitBranch`).
- Terminal (`createTerminalSession`, `writeTerminalSession`,
  `resizeTerminalSession`, `closeTerminalSession`,
  `onTerminalData`, `onTerminalExit`).
- Write-mode services (`exportWriteDocument`,
  `requestWriteInlineCompletion`,
  `listWriteInlineCompletionDebugEntries`,
  `clearWriteInlineCompletionDebugEntries`).
- Connect phone / internal Claw (`getClawStatus`, `runClawTask`,
  `startClawImInstallQr`, `pollClawImInstall`,
  `createClawTaskFromText`, `mirrorClawChannelMessageToFeishu`,
  `onClawChannelActivity`).
- Shell / notifications / updater / logger (`openExternal`,
  `showTurnCompleteNotification`, `getGuiUpdateState`,
  `checkGuiUpdate`, `downloadGuiUpdate`, `installGuiUpdate`,
  `onGuiUpdateState`, `logError`, `getLogPath`, `openLogDir`).

Every method on this surface is typed in `src/shared/ds-gui-api.ts`
and validated at the IPC boundary by Zod schemas in
`src/main/ipc/app-ipc-schemas.ts`.

### 6.4 The runtime adapter

The main process owns the Kun child process through a
`LocalHttpRuntimeAdapter`:

- `kunRuntimeAdapter.resolveExecutable(settings)` —
  finds the right binary or falls back to the dev script.
- `kunRuntimeAdapter.ensureRunning(settings)` — starts
  the child if it isn't already.
- `kunRuntimeAdapter.stopAndWait()` — graceful shutdown
  for app exit.
- `kunRuntimeAdapter.getBaseUrl(settings)` — base URL
  for the current settings.
- `kunRuntimeAdapter.reclaimPort(port)` — recover a
  stuck port.

`runtimeRequestViaHost` is the single chokepoint: it ensures the
runtime is running, then forwards the request with the bearer
token, default 15 s GET / 60 s POST timeout, and an `Accept:
application/json` header.

---

## 7. Renderer (React 19 + Zustand 5)

### 7.1 Top-level shape

```text
App
  └── AppShell  (Suspense)
        ├── Workbench          (routes: chat / claw / write / plugins / schedule; claw = Connect phone)
        │     ├── Sidebar      (left, drag-resizable, 268 px)
        │     ├── Topbar       (translucent glass strip)
        │     ├── Center column
        │     │     ├── MessageTimeline  (Code / Connect phone)
        │     │     └── WriteWorkspaceView (Write)
        │     ├── Right inspector  (optional, 360 px)
        │     │     ├── ChangeInspector
        │     │     ├── TodoPanel
        │     │     ├── DevBrowserPanel
        │     │     ├── PlanPanel
        │     │     ├── WorkspaceFilePreviewPanel
        │     │     ├── WriteAssistantPanel
        │     │     └── SddAssistantPanel
        │     ├── PluginMarketplaceView  (route = 'plugins')
        │     └── ScheduleTasksView      (route = 'schedule')
        ├── SettingsView       (route = 'settings')
        └── InitialSetupDialog (first-run)
```

### 7.2 State

A single `useChatStore` (Zustand) holds all renderer state. The
store is split into modules under `src/renderer/src/store/`:

- `chat-store.ts` — main store, route, thread list, workbench
  panels, status flags.
- `chat-store-types.ts` — the store's TS surface.
- `chat-store-app-actions.ts`, `chat-store-claw-actions.ts`,
  `chat-store-side-actions.ts` — action creators grouped by
  domain (`claw` is the internal Connect phone domain).
- `chat-store-runtime-helpers.ts` — pure helpers around the
  runtime.
- `chat-store-schedulers.ts` — busy watchdog, completion poll,
  startup probe.

Persistence is layered:

- `localStorage` — UI-only state (panel sizes, collapsed flags,
  composer model, write thread registry, code workspace roots,
  fork registry).
- `electron-store` (main) — settings, Connect phone config (internal Claw key), write
  workspace config.
- `~/.deepseekgui/kun` (Kun) — threads,
  events, sessions, usage.

### 7.3 The AgentProvider interface

The renderer talks to the runtime through one interface,
`AgentProvider` (`src/renderer/src/agent/types.ts`). Today the
only implementation is `KunRuntimeProvider`
(`src/renderer/src/agent/kun-runtime.ts`), which is a thin
HTTP/SSE client. Its DTOs live in
`src/renderer/src/agent/kun-contract.ts` and the
DTO-to-ChatBlock mapping lives in
`src/renderer/src/agent/kun-mapper.ts`.

`getProvider()` (in `registry.ts`) returns a single cached
instance. `resetProviderCacheForTests()` exists for unit tests
and must not be called outside of them.

### 7.4 Workbench internals

`Workbench.tsx` is the central layout component. It reads the
current route from the store, lays out the left sidebar, center
surface, and optional right inspector, and lazy-loads the heavy panels
(`ChangeInspector`, `TodoPanel`, `PlanPanel`, `WorkspaceFilePreviewPanel`,
`DevBrowserPanel`, `PluginMarketplaceView`, `ScheduleTasksView`)
via `React.lazy`. Panel sizes and the selected right-panel mode are persisted to `localStorage`
under `deepseekgui.layout.*` keys.

The chat timeline is a virtualized list of `ChatBlock`s. Each
block kind has its own renderer:

- `user` / `assistant` — markdown, with a streaming shimmer on
  the assistant block.
- `reasoning` — collapsible block with monospace text.
- `tool` — file_change, command_execution, tool_call, with
  inline detail and a "show in inspector" action.
- `compaction` — fold summary.
- `approval` — pending / allowed / denied / error states.
- `user_input` — structured question with option buttons.
- `system` — informational messages (e.g. runtime up, runtime
  down, model switched).

### 7.5 Workbench routes, one store

The store distinguishes the main workbench and entry routes through `route`
(`chat`, `write`, `claw`, `plugins`, `schedule`) plus thread metadata.
The Code / Write mode switcher lives in the sidebar; Connect phone uses the
legacy `claw` route internally. Switching does not change the runtime contract,
only which renderer and local workflow state the store pulls in.

- **Code** — default mode, full agent flow, workspace roots,
  todo panel, changes inspector, plan panel, file preview, and dev browser.
- **Write** — write-thread registry isolates Write sessions
  from Code / Connect phone sessions. Uses the same Kun but a
  separate `WRITE_ASSISTANT_THREAD_TITLE` namespace. Inline
  completion and selected-text agent go through dedicated
  main-process services.
- **Connect phone** — internal `claw` channel registry. Each IM channel has its
  own thread id, model, and workspace root. Runs through
  `ClawRuntime` (main process), which calls Kun over
  HTTP just like the renderer does.

---

## 8. Data persistence (renderer + main)

| Data | Where | Format | Owner |
| --- | --- | --- | --- |
| Settings | OS app-data dir | JSON | `JsonSettingsStore` (main) |
| Session list / workbench layout | `localStorage` | JSON | Renderer |
| Write thread registry | `localStorage` | JSON | Renderer |
| Connect phone channels | OS app-data dir | JSON | `JsonSettingsStore` |
| Threads / turns / events | `~/.deepseekgui/kun` | JSON + JSONL | Kun |
| Usage counters | Kun data dir | JSON | Kun |
| Skill / MCP files | Kun data dir + workspace | Markdown / JSON | Kun + renderer |
| GUI logs | OS app-data dir / `log/` | NDJSON | `logger.ts` |
| Inline completion debug | OS app-data dir | NDJSON | `write-inline-completion-service.ts` |

Default OS app-data paths (derived from the Electron `productName`,
which current builds still ship as `DeepSeek GUI`):

- macOS: `~/Library/Application Support/DeepSeek GUI`
- Windows: `%APPDATA%\DeepSeek GUI`
- Linux: `~/.config/DeepSeek GUI`

Uninstalling the app does not remove app data. Documented in
the README and respected by the install script.

---

## 9. Key subsystems

### 9.1 Tool execution & approval

- `LocalToolHost` (`kun/src/adapters/tool/local-tool-host.ts`)
  holds the registered tools and their policies. Policies:
  `auto`, `on-request`, `suggest`, `never`, `untrusted`.
- A tool with `shouldAdvertise(ctx)` is gated at the listing
  layer too — this is how `create_plan` stays scoped to plan
  threads.
- Approval requests emit a `RuntimeEvent` of kind
  `approval_requested`; the GUI shows the approval block and
  POSTs the decision to `/v1/approvals/{id}`. The agent loop
  resumes on `allow`, errors out on `deny`.

### 9.2 Plan mode

Plan threads expose a `create_plan` tool. The renderer advertises
a `GuiPlanContext` on the active turn, the loop gates the tool,
the model writes a Markdown plan, and the renderer stores it as a
`GuiPlanArtifact`. The `Build` button promotes a plan artifact
into a new `agent`-mode thread, preserving the plan as the
opening turn.

Plan-mode prompt injection sits *after* the immutable prefix as
a second system message, so the cached prefix is untouched.

### 9.3 Context compaction

`ContextCompactor` estimates token count, folds long histories
into a single `compaction` item, and always preserves the
immutable prefix's pinned constraints. Soft threshold 16k
tokens, hard threshold 24k tokens. The GUI renders the
compaction block inline with a "show replaced" detail.

### 9.4 Write-mode completion & RAG

- **FIM short completion** — debounced 650 ms, max 96 tokens,
  min accept score 0.52. Used while typing.
- **Inspirational long completion** — debounced 2.8 s, max
  256 tokens, min accept score 0.36. Used at sentence/paragraph
  boundaries.
- **RAG** — write workspace Markdown files are indexed
  on-demand with BM25 + keyword match; relevant snippets are
  injected as hidden Markdown comments.
- **Selected-text inline agent** — selected text is captured
  with file path and line range, then submitted as a
  structured prompt. The agent returns Markdown edits the
  user can apply or ignore.
- **Export** — `write-export-service.ts` converts the current
  Markdown document to HTML / PDF / DOC / DOCX, preserving
  headings, lists, code blocks, tables, and local images.

### 9.5 Connect phone automation

- `ClawRuntime` (main process) creates and reuses Kun
  threads for each IM channel and each scheduled task.
- Feishu / Lark integration uses `@larksuiteoapi/node-sdk`.
  Install is device-flow QR code; the renderer polls
  `claw:im-install:poll` until authorized.
- Webhook / relay is a small HTTP server in `ClawRuntime` that
  POSTs inbound webhooks into a Kun thread.
- Scheduled tasks are detected from natural-language Connect phone
  prompts (`claw-scheduled-task-detector.ts`) and stored under
  `claw.scheduledTasks` in settings.
- A standalone `claw-schedule-mcp-server` process can be
  launched separately (`--claw-schedule-mcp-server`) to host
  the schedule tools over MCP, hiding the macOS dock icon when
  running headless.

### 9.6 Updater

`electron-updater` driven by `gui-updater.ts`. Channels:
`stable`, `beta`, `nightly`. The Settings page surfaces state
and check / download / install actions. macOS / Windows only;
Linux users build from source.

### 9.7 Logging

`logger.ts` writes structured NDJSON to the OS app-data log
directory. The renderer can open the log dir, and `log:error`
lets any UI surface report a category / message / detail
tuple. A startup trace is enabled by
`DEEPSEEK_GUI_STARTUP_TRACE=1` and prints to stdout for
postmortem timing.

---

## 10. Security model

- **Auth** — every `/v1/*` request carries
  `Authorization: Bearer <runtime-token>` unless the runtime
  was started with `--insecure` (local dev only). The token is
  generated and stored in settings.
- **Approval policy** — `auto` (default), `on-request`,
  `untrusted`, `never`, `suggest`. Per-tool policies can override.
- **Sandbox mode** — `read-only` / `workspace-write` (default) /
  `danger-full-access` / `external-sandbox`. Enforced by the
  workspace inspector and the file/tool adapters.
- **Renderer isolation** — `contextIsolation: true`, no
  `nodeIntegration`, no `webviewTag` exposure. The renderer
  only sees the `window.dsGui` API surface.
- **External links** — `openExternal` is the only way to leave
  the app; URLs are validated against an allow-list.
- **Markdown rendering** — `rehype-harden` strips unsafe
  nodes. Code blocks go through `shiki` with a fixed theme.
- **Settings file** — written atomically, debounced, never
  read on the renderer side. Legacy `codewhale` / `reasonix`
  keys are migrated to `kun` once and discarded.

---

## 11. Constraints (do not violate)

These are enforced by `docs/AGENTS.md` and reflect real product
decisions. New work must respect them.

- **One live agent runtime: Kun.** No second live
  provider, no provider switcher, no runtime diagnostics
  panel, no legacy CodeWhale / Reasonix process path.
- **No UI surface for runtime internals.** No AgentSwitcher,
  no ConnectionStatusBar, no RuntimeDiagnosticsDialog, no
  RuntimeInsightsPanel, no `/usage` or `/runtime` slash
  command.
- **Saved settings only contain `agents.kun`.** Old keys
  may only appear in migration.
- **Renderer does not implement agent logic.** Approvals,
  steering, compaction, fork, resume, usage — all come from
  Kun endpoints, never re-implemented in React.
- **No new drawing / design starter card** in the core
  workbench.
- **No emoji in production copy or as functional UI
  affordance.**

If a feature request appears to require violating a constraint,
escalate before coding.

---

## 12. Extension guide

When you need to add a new capability, follow this path. It's
intentionally boring.

1. **Add the protocol field.** New Zod schema in
   `kun/src/contracts/`. Run `npm --prefix kun run
   build`.
2. **Add the agent behavior.** In `kun/src/loop/`,
   `kun/src/services/`, or a new port + adapter pair
   under `kun/src/ports/` and `kun/src/adapters/`.
3. **Add the HTTP route.** New file under
   `kun/src/server/routes/`, registered in
   `routes/index.ts`.
4. **Map the endpoint / event in the GUI.** Add to
   `src/renderer/src/agent/kun-contract.ts` and the
   mapper `kun-mapper.ts`; expose the call in
   `kun-runtime.ts`.
5. **Add settings only under `agents.kun`.** Anything
   else gets migrated to it.
6. **Add i18n strings to both `zh` and `en` locale files.**
7. **If the surface needs a new visual element, add it to
   this file's YAML frontmatter first.** Don't invent tokens
   in the JSX.
8. **Verify** with `npm run typecheck && npm test && npm run
   build`.

---

## 13. Verification

Minimum checks for any change to the design, runtime, or
build:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke (full list in `docs/AGENTS.md`):

- Code: create thread, stream reply, approve / deny, interrupt.
- Write: open workspace, request inline completion, run
  selected-text agent.
- Connect phone: save settings, run a manual task through a Kun
  thread.
- Settings → Agents: shows only Kun.
- Cache telemetry on a hot thread should stay ≥ 90% hit.

If any check fails, the change is not ready.

---

## 14. Key files index

| Concern | File |
| --- | --- |
| App lifecycle | `src/main/index.ts` |
| Runtime adapter | `src/main/runtime/kun-adapter.ts` |
| HTTP forwarding | `src/main/runtime/runtime-host.ts` |
| Child process | `src/main/kun-process.ts` |
| Settings | `src/main/settings-store.ts`, `src/shared/app-settings.ts` |
| IPC | `src/main/ipc/register-app-ipc-handlers.ts`, `src/main/ipc/app-ipc-schemas.ts` |
| dsGui API | `src/preload/index.ts`, `src/shared/ds-gui-api.ts` |
| Agent provider | `src/renderer/src/agent/kun-runtime.ts` |
| DTO mapping | `src/renderer/src/agent/kun-mapper.ts` |
| App shell | `src/renderer/src/AppShell.tsx` |
| Workbench | `src/renderer/src/components/Workbench.tsx` |
| Chat store | `src/renderer/src/store/chat-store.ts` |
| Connect phone runtime | `src/main/claw-runtime.ts` |
| Write services | `src/main/services/write-*-service.ts` |
| Workspace/editor services | `src/main/services/workspace-*.ts`, `src/main/services/workspace-editors.ts` |
| Tokens / styles | `src/renderer/src/styles/*.css`, `src/renderer/src/index.css` |
| Agent loop | `kun/src/loop/agent-loop.ts` |
| Immutable prefix | `kun/src/cache/immutable-prefix.ts` |
| HTTP routes | `kun/src/server/routes/` |
| Tool host | `kun/src/adapters/tool/local-tool-host.ts` |
| Model client | `kun/src/adapters/model/deepseek-compat-model-client.ts` |
| Cache doc | `docs/kun-cache-optimization.md` |
| Architecture doc | `docs/kun-architecture.md` |
| Contribution doc | `docs/kun-contributing.md` |

---

## 15. References

- `docs/kun-architecture.md` — single-runtime plan and
  GUI拆改范围.
- `docs/kun-cache-optimization.md` — cache hit rate
  measurement, stable prefix rules, tool pair healing.
- `docs/kun-contributing.md` — port & adapter / FCIS
  patterns, four PR archetypes.
- `kun/README.md` — CLI flags, env vars, data dir layout,
  HTTP API.
- `docs/AGENTS.md` — agent runtime notes (constraints enforced
  on contributors).
- `README.md` / `README.en.md` — product-level overview.

This file is the design source of truth. When the code and this
file disagree, **this file is wrong** until you change both.
