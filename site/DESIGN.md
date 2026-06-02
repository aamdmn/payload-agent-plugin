# payload-agent — Site Design System

The guideline for the landing page and docs. Keep it minimal, simple, and unique.
When in doubt, remove something.

## Concept

Swiss / editorial monochrome. Thin Geist display type, Geist Mono as a structural
labeling device, hairline rules, generous whitespace.

Two rules carry the whole brand:

1. **Color lives in the product, not the chrome.** The site is black & white. The only
   full color anywhere is the content the agent creates inside the hero demo (product
   imagery, the admin's green "accent color" toggle, etc.). The marketing surface is the
   gallery; the agent's output is the art.
2. **One accent, one meaning.** A single electric blue marks *live / agentic* moments
   only — links, focus rings, and the agent-activity cursor. It is never decorative.
   Primary buttons and structure stay monochrome.

Minimal everywhere, with one loud living exception (the demo).

## Foundations

### Color

Pure white is the default canvas; pure black is the dark-mode toggle. No off-white, no
tinted dark. The theme toggle flips **both** the site and the embedded admin demo (we
have both admin modes in Paper).

```css
/* Light (default) */
--bg:        #FFFFFF;
--fg:        #000000;
--secondary: #666666;  /* labels, lede; AA on white */
--muted:     #999999;  /* large/decorative only — fails AA for body */
--hairline:  #EAEAEA;
--accent:    #0B5FFF;  /* links, focus, agent activity — verify AA on small text */

/* Dark (toggle) */
--bg:        #000000;
--fg:        #FAFAFA;  /* not pure white — thin weight halates on pure black */
--secondary: #A1A1A1;
--muted:     #6B6B6B;
--hairline:  #1C1C1C;
--accent:    #5E9EFF;  /* brighter so it pops on black */
```

Alternative accent: reuse the demo's green (`#34C759`) to tie site and product together.
Blue is the default because it reads as link/devtool and stays distinct from the green
the agent paints into content.

### Typography

Self-hosted **Geist** (sans) and **Geist Mono**. Honor the thin aesthetic on display
type; keep body legible.

| Role            | Family     | Size       | Weight        | Tracking | Line-height |
|-----------------|------------|------------|---------------|----------|-------------|
| Display / H1    | Geist      | 56–72px    | 300 Light     | −0.02em  | 1.0         |
| H2              | Geist      | 32–40px    | 300 Light     | −0.015em | 1.1         |
| H3 / feature    | Geist      | 18–20px    | 400 Regular   | −0.01em  | 1.3         |
| Lede            | Geist      | 18–20px    | 400 Regular   | 0        | 1.5         |
| Body            | Geist      | 15–16px    | 400 Regular   | 0        | 1.5         |
| Mono label      | Geist Mono | 12–13px    | 400/500       | +0.08em  | 1.2         |
| Code            | Geist Mono | 13–14px    | 400           | 0        | 1.7         |

- The very largest hero headline may go 200 ExtraLight on white only (thin needs size +
  contrast). Never thinner than 400 below 24px, and never thin on the black canvas.
- **Mono labels are the signature texture**: eyebrows, section numbers (`01 / 02 / 03`),
  field labels, the install command. Uppercase, open tracking.

### Space & layout

- 4px base unit. Section rhythm: 96–128px vertical padding.
- Content max-width ~1140px; hero copy column caps ~520px.
- 1px `--hairline` rules separate major sections — architectural, blueprint feel.
- Asymmetry over grid sameness; let the hero breathe, group related items tightly.

### Radius & borders

- Radius: 10px on interactive chrome (buttons, install bar, demo window). 0 on rules.
- Borders are always 1px `--hairline`. No shadows on the marketing surface (shadows are
  allowed *inside* the demo, since that is real product UI).

### Motion

- UI / hover: 150–220ms, ease-out. Subtle (`translateY(-1px)`, opacity, filter).
- Section entrances: short rise (8px, ~500ms) on first view.
- The demo is the one place with rich choreography (see below).
- Everything respects `prefers-reduced-motion: reduce` — entrances and the demo loop
  fall back to their final static state.

### Accent usage (strict)

Allowed: text links, focus rings, the agent typing cursor / activity pulse, an optional
1px underline on hover. Not allowed: filled buttons, backgrounds, icons-for-decoration,
section dividers. If you are reaching for the accent and it is not "live," use `--fg`.

## Components

- **Top nav:** wordmark (`payload-agent`, mono or 500) left; links right (Docs, GitHub,
  npm) in `--secondary`; theme toggle at the far right. Hairline bottom border on scroll.
- **Primary button:** solid `--fg` bg / `--bg` text. Monochrome. Hover lifts 1px.
- **Ghost button:** 1px hairline, `--fg` text. Hover fills `--bg`-adjacent gray.
- **Install bar:** mono, `$` prompt in `--accent`, command in `--fg`, hairline box.
- **Feature rows:** info on surface, no cards. `01`–`04` mono numbers, thin title,
  `--secondary` body. Separated by hairline rules.
- **Code window:** hairline frame, mono filename in the bar, monochrome syntax (vary
  weight/opacity, not hue) so it stays black & white.
- **Footer:** minimal — license + Docs / GitHub links.

## Hero demo (centerpiece)

Paper.dev-style split. Left = copy + CTAs + install command. Right = a browser-chrome
window showing the Payload admin with the payload-agent chat docked over it (like the
Claude Code window in the reference).

**Scripted loop** (the product's north star, shown literally):

1. User message appears: *"Add a player spotlight for Messi, then translate the page to
   Slovak."*
2. Agent replies; a new **block animates into** the layout builder.
3. Fields **type themselves in** (player name, stats, description) — accent cursor leads.
4. Locale switcher flips **EN → SK**; fields re-fill with translated copy.
5. Brief hold, then reset and loop.

Rules:
- The admin chrome is monochrome-ish (real Payload UI); the **content** it fills in is the
  only full color on the page.
- The demo theme is coupled to the site theme toggle (light admin ↔ dark admin).
- Reduced-motion: show the finished, populated Slovak state, no typing.
- Build the admin chrome from the Paper file via `get_jsx` / `get_computed_styles` so it
  matches the real admin, not an approximation.

## Docs (Starlight)

Re-theme Starlight to this system via CSS custom properties + a custom CSS file:

- Same `--bg` / `--fg` / `--accent`; Geist for prose, Geist Mono for code blocks.
- Thinner sidebar, hairline dividers, monochrome code highlighting.
- Landing and docs must read as one product.

## Tech & assets

- Stack stays **Astro + Starlight**. Add `@astrojs/react` + `framer-motion`; build the
  hero demo as a single `client:visible` React island. Everything else is static
  Astro/CSS.
- Self-host Geist (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`) —
  drop the current Google-Fonts Inter link.
- Reference for craft: `.context/caltext` (the iPhone clip-path frame, framer-motion
  entrance patterns, reduced-motion handling).

## Build sequence (beta-first)

1. Foundations: tokens, fonts, theme toggle, base layout + nav/footer.
2. Hero shell: split layout, copy, CTAs, install bar (static, no demo yet).
3. Feature rows + code window.
4. Demo island: admin chrome (exported from Paper) → chat → scripted self-writing loop.
5. Re-theme Starlight docs to match.
6. Polish pass: spacing, contrast, reduced-motion, mobile.
