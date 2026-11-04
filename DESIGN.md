---
name: LEAD CRM
description: A calm dark operator console for LEAD's staff and class buyers. Blue acts, yellow flags.
colors:
  night-canvas: "#0e0f13"
  raised-slate: "#17181e"
  muted-slate: "#1e2028"
  sunken-slate: "#272a34"
  hairline: "#262932"
  hairline-strong: "#3a3e4a"
  chalk: "#f4f5f8"
  chalk-muted: "#a3a8b8"
  chalk-subtle: "#8e94a6"
  charcoal-rail: "#1a1b22"
  charcoal-raised: "#2b2d35"
  on-charcoal: "#9ea3b3"
  lead-blue: "#a1bace"
  lead-blue-hover: "#b8cadb"
  on-blue: "#0e0f13"
  blue-wash: "#24292f"
  logo-disc: "#3d3d3d"
  lead-yellow: "#fbe33b"
  on-yellow: "#1b1d29"
  yellow-wash: "#3a2f10"
  on-action: "#ffffff"
  success: "#34d399"
  success-wash: "#11301f"
  warning: "#f5be2e"
  warning-wash: "#3a2f10"
  danger: "#f87171"
  danger-wash: "#3a1616"
  chart-violet: "#8b7cf6"
  chart-apricot: "#f59e5b"
typography:
  display:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 700
    lineHeight: 1
  headline:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.875rem"
    fontWeight: 600
    lineHeight: 1.2
  title:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.25rem"
    fontWeight: 600
    lineHeight: 1.4
  title-card:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
  body:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
  body-dense:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.4
  label:
    fontFamily: "Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 700
    letterSpacing: "0.025em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  hair: "1px"
  sm: "10px"
  md: "16px"
  lg: "24px"
  full: "9999px"
spacing:
  "1": "4px"
  "2": "8px"
  "3": "12px"
  "4": "16px"
  "5": "20px"
components:
  button-primary:
    backgroundColor: "{colors.lead-blue}"
    textColor: "{colors.on-blue}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "36px"
  button-primary-hover:
    backgroundColor: "{colors.lead-blue-hover}"
  button-outline:
    backgroundColor: "{colors.night-canvas}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.full}"
    padding: "0 16px"
    height: "36px"
  button-outline-hover:
    backgroundColor: "{colors.sunken-slate}"
  button-register:
    backgroundColor: "{colors.lead-yellow}"
    textColor: "{colors.on-yellow}"
    typography: "{typography.body}"
    rounded: "{rounded.full}"
    padding: "8px 16px"
  button-register-disabled:
    backgroundColor: "{colors.muted-slate}"
    textColor: "{colors.chalk-subtle}"
  input:
    backgroundColor: "{colors.sunken-slate}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.sm}"
    padding: "4px 12px"
    height: "36px"
  search-pill:
    backgroundColor: "{colors.sunken-slate}"
    textColor: "{colors.chalk}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.full}"
    padding: "8px 12px 8px 36px"
  nav-item:
    textColor: "{colors.on-charcoal}"
    typography: "{typography.body-dense}"
    rounded: "{rounded.full}"
    padding: "10px 14px"
  nav-item-hover:
    backgroundColor: "{colors.charcoal-raised}"
    textColor: "{colors.on-action}"
  nav-item-active:
    backgroundColor: "{colors.lead-blue}"
    textColor: "{colors.on-blue}"
  badge:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.lead-blue}"
    rounded: "{rounded.full}"
    padding: "2px 10px"
    height: "24px"
  badge-success:
    backgroundColor: "{colors.success-wash}"
    textColor: "{colors.success}"
  badge-warning:
    backgroundColor: "{colors.warning-wash}"
    textColor: "{colors.warning}"
  card:
    backgroundColor: "{colors.raised-slate}"
    textColor: "{colors.chalk}"
    rounded: "{rounded.md}"
    padding: "20px"
  table-head:
    backgroundColor: "{colors.sunken-slate}"
    textColor: "{colors.chalk-subtle}"
    typography: "{typography.label}"
    height: "40px"
    padding: "0 16px"
  table-cell:
    textColor: "{colors.chalk}"
    typography: "{typography.body-dense}"
    padding: "12px 16px"
---

# Design System: LEAD CRM

## Overview

**Creative North Star: "The Control Desk"**

A calm, dark operator console. The room is near-black and quiet. The tools sit on raised slate panels, and the controls are pill-shaped. Two colours carry all the meaning. Blue is the hand that acts: the primary button, the active nav item, the link. Yellow is the flag that asks for attention: a highlight, a count, a "needs you" chip, and on the public site, the one buy action. Everything else is a step of grey.

The same system serves two surfaces. The CRM is a dense desk for staff who work in it all day at 1280px and wider. The public schedule, register and enquiry pages are the same desk turned to face a buyer on a phone: wider spacing, bigger headings, one yellow Register button per class card. Both render dark by default (`<html class="dark">`). `app/globals.css` also holds a light counterpart of every token, from `design.pen`. That light set is not the shipped look and is not documented here.

Components are quiet and exact. Rounding is generous, but density, alignment and tabular order lead. There are no shadows. Depth comes from tonal steps between slate surfaces and a one-pixel hairline.

**Key Characteristics:**

- Dark by default: a near-black canvas, raised slate panels, chalk text.
- Two signal colours with fixed jobs: blue acts, yellow flags.
- Fully rounded pills for every control; 16px corners for panels.
- Flat: tonal layering and hairlines, no shadows.
- One typeface, Inter, at small sizes with semibold and bold doing the hierarchy work.
- The LEAD logo: the real file, with its yellow upright bar and steel-blue strokes on a grey disc.

## Colors

A near-monochrome slate ramp with the two colours of the LEAD logo, its steel blue and its yellow, and a small set of status washes. Both brand colours are sampled from the logo file (`public/brand/lead-logo.webp`): blue #a1bace, yellow #fbe33b.

### Primary

- **LEAD Blue** (`lead-blue`): every action in the CRM. Primary buttons, the active sidebar item, the avatar disc, links, focus rings, and the first chart series. It brightens to **Lifted Blue** (`lead-blue-hover`) on hover. The blue is pale, so text on it is always **Ink on Blue** (`on-blue`, 9.5:1), never white. Light mode uses a darker step, #48647f, which takes white text.
- **Blue Wash** (`blue-wash`): the quiet ground behind blue text in the default badge and the accent surface.

### Secondary

- **LEAD Yellow** (`lead-yellow`): the attention flag. In the CRM it marks highlights and counts, such as the small chip on the dashboard's deals card, and never a button. On the public site it is the Register button, the one money action on a class card. Text on yellow is always **Ink on Yellow** (`on-yellow`).
- **Yellow Wash** (`yellow-wash`): the ground behind yellow text in warning badges.

### Tertiary

- **Logo Disc** (`logo-disc`): the grey disc of the LEAD logo. It lives in the logo file only. Not a UI colour.
- **Chart Violet** (`chart-violet`) and **Chart Apricot** (`chart-apricot`): series 2 and 3 in data visualisation, after LEAD blue. Success and LEAD yellow are series 4 and 5.

### Neutral

- **Night Canvas** (`night-canvas`): the page itself, on both surfaces.
- **Raised Slate** (`raised-slate`): cards, panels, the top bar, popovers.
- **Muted Slate** (`muted-slate`): disabled controls and the faint inner layer.
- **Sunken Slate** (`sunken-slate`): inputs, the search pill, table header rows, secondary buttons. It sits lower than the panel it is on.
- **Charcoal Rail** (`charcoal-rail`) and **Charcoal Raised** (`charcoal-raised`): the CRM sidebar and its hover state.
- **Hairline** (`hairline`) and **Strong Hairline** (`hairline-strong`): 1px borders. The strong one outlines inputs and selects.
- **Chalk** (`chalk`), **Chalk Muted** (`chalk-muted`), **Chalk Subtle** (`chalk-subtle`): primary text, secondary text, and metadata.

### Status

- **Success**, **Warning** and **Danger**, each with its own wash. Status always shows as coloured text on its own wash, never as a solid fill. Destructive buttons follow the same pattern: danger text on a danger tint with a danger border.

### Named Rules

**The Blue Acts, Yellow Flags Rule.** In the CRM, every clickable action is blue, and yellow only draws the eye to a number or a state. On the public site, yellow is the Register button and nothing else. Blue covers the secondary links there.

**The No Solid Status Rule.** Success, warning and danger show as text on their wash. A full-strength status fill is never used for a surface.

## Typography

**Display Font:** Inter (with system-ui, sans-serif)
**Body Font:** Inter (with system-ui, sans-serif)
**Label/Mono Font:** Geist Mono, for codes and figures that must align

**Character:** One neutral sans at small, tight sizes. Weight does the hierarchy work, not size: bold for numbers, semibold for titles, regular for reading.

On Chinese pages, Inter is loaded for Latin glyphs only and the stack falls through to PingFang SC, Hiragino Sans GB, Microsoft YaHei and Noto Sans SC. No CJK webfont ships, because of the 1MB page budget.

### Hierarchy

- **Display** (bold, 28px, line-height 1): the dashboard greeting and big stat numerals, such as deal value per stage.
- **Headline** (semibold, 24px on mobile and 30px from 640px, line-height 1.2): the one H1 on each public page.
- **Title** (semibold, 20px): CRM list and detail headers. **Card Title** (semibold, 18px): class names on public schedule cards.
- **Body** (regular, 14px): form text, descriptions, most CRM copy. **Body Dense** (13px): table cells, sidebar items, the search pill and stat captions.
- **Label** (bold, 11px, 0.025em tracking, uppercase): table column headers. Badges use 12px semibold, sentence case.

### Named Rules

**The Weight Not Size Rule.** The CRM stays between 11px and 28px. Hierarchy comes from weight and colour step (chalk, muted, subtle) before it comes from a bigger size.

## Layout

The CRM is a floating shell on the night canvas. The page has 16px padding. A 224px charcoal sidebar floats as a rounded panel, sticky, full height minus the padding. From 768px it can close to a 56px icon rail (the choice is kept in the `crm_sidebar` cookie); under 768px it is always the rail. To its right, a pill-shaped top bar holds global search, the user's email and the avatar. The work area sits below with 16px gaps. List screens follow one skeleton (`components/list-kit.tsx`): title row, filter row, table, pagination. No list loads more than 100 rows.

The public site is a single centred column, max 1024px (`max-w-5xl`), with 16px side gutters on phones and 24px from 640px. The header is a hairline-bottomed bar: the LEAD wordmark on the left, Schedule, Talk to us and the language switch on the right. Class cards sit in a grid that uses subgrid rows, so the title, details and action line up across a row.

Spacing is a 4px Tailwind step. The working set is 4, 8, 12, 16 and 20px. 8px is the default gap between related items, 12px between groups in a row, and 16px between sections and panels. Card padding is 20px.

## Elevation & Depth

Flat. No shadow anywhere in the app. Depth comes from three tonal steps: the night canvas at the bottom, raised slate for panels and cards, and sunken slate for things you type into. A 1px hairline outlines every panel. Hover is a tonal shift (raised to sunken, or a 50% muted wash on table rows), never a lift.

### Named Rules

**The Tonal Step Rule.** To separate a layer, step the surface tone and add a hairline. Never add a shadow.

## Shapes

Rounded, with a clear scale. Controls are fully round: buttons, nav items, the search pill, the top bar, badges and the avatar. Inputs and selects take 10px corners. Panels, cards and table frames take 16px. The sidebar takes 24px. 1px corners appear nowhere in UI chrome.

One drift: the public class card uses a 28.8px corner (`rounded-2xl`), which is off this scale. Prefer 16px for new cards.

## Components

### Buttons

Quiet pills that say one thing.

- **Shape:** fully round (9999px), 36px tall by default; 28px small, 40px large.
- **Primary:** LEAD blue with white semibold 14px text, 16px side padding. Hover lifts to Lifted Blue. Pressing moves the button down 1px.
- **Outline / Secondary / Ghost:** hairline or sunken-slate pills that take a slate tone on hover. Ghost has no border.
- **Destructive:** danger text on a danger tint with a danger border at 60%. Never a solid red fill.
- **Register (public site only):** LEAD yellow with ink text, 8px by 16px. When a class is full or registration is closed, it becomes a muted-slate pill with subtle text, plus a screen-reader reason.
- **Focus:** a 3px ring in the focus colour at 50%, with the border taking the ring colour.

### Chips / Badges

- **Style:** a 24px pill with 12px semibold text, led by a 6px dot in the text colour.
- **Variants:** blue (default), muted, success, warning and danger, each as text on its own wash. Outline is a hairline pill.

### Cards / Containers

- **Corner Style:** 16px.
- **Background:** raised slate on the night canvas.
- **Shadow Strategy:** none. See Elevation & Depth.
- **Border:** 1px hairline.
- **Internal Padding:** 20px.

### Inputs / Fields

- **Style:** 36px tall, 10px corners, a strong hairline border, a faint fill (strong hairline at 30%), 12px side padding. Text is 16px on phones (so iOS does not zoom) and 14px from 768px.
- **Focus:** the border takes the ring colour, plus a 3px ring at 50%.
- **Error / Disabled:** errors set the border to danger with a danger ring at 40%. Disabled fields drop to 50% opacity.

### Navigation

- **CRM sidebar:** a charcoal rail with 24px corners. Items are 13px pills with a 16px lucide icon. At rest the text is on-charcoal; hover takes charcoal-raised with white text; the active page is a solid LEAD blue pill with Ink on Blue semibold text. A panel icon at the top right closes the sidebar. Closing narrows it to the rail over 200ms on `cubic-bezier(0.2, 0, 0, 1)`; the main column reflows with it. Icons keep a fixed left inset so they never move; labels fade out and are clipped, and stay readable to screen readers. On the closed rail, hovering or focusing the logo disc reveals the open icon. Reduced motion skips the animation.
- **Public header:** the LEAD wordmark (semibold, 16px) and three text links in chalk-muted that turn chalk on hover. No pills and no fills.

### Tables

- **Head:** a sunken row of 12px semibold labels in normal case ("Seats sold", not "SEATS SOLD") in chalk-subtle, 40px tall.
- **Cells:** 13px text, 12px by 16px padding, hairline row dividers, a 50% muted wash on hover.
- **Fit at 1280px:** every list fits 1280px with the sidebar open, without sideways scroll. When columns run out, related facts share one cell on two lines: the lead fact at 13px, the supporting one under it at 12px in chalk-muted (code over course, language over mode, price over HRDC, name over phone and email). One flexible column takes the leftover width and has a minimum width (`min-w-*` on the table), so below 1280px the table scrolls inside its frame instead of squeezing that column to nothing. Every table has a loading skeleton, an empty state that names the next action, and an error state with retry.

### The LEAD Logo (signature)

The real logo, never redrawn. Files live in `public/brand/`:

- `lead-logo.webp`: the original, with a black wordmark, for light surfaces.
- `lead-logo-white.webp`: the official white-wordmark logo, for the dark CRM. The sidebar and the sign-in card use it at 30–32px tall; the closed sidebar clips it to the disc.
- `lead-mark.png`: the disc alone, square. The source of the browser icons: `app/favicon.ico` (16, 32, 48px), `app/icon.png` (192px) and `app/apple-icon.png` (180px, the disc on night canvas, since iOS fills transparency with black). Regenerate all three from it if the mark changes.

Do not stretch it, recolour the disc or the strokes, or rebuild it from spans.

### Upcoming Class Seat Cards

The dashboard opens with one card per class starting in the next 14 days, three across at 1280px, under a section header in the deals style (title, count chip, window, All classes link). Seats sold is the headline: 28px bold count over capacity, the percentage, and an 8px bar. The footer gives seats left and days to start. A class within 7 days and under half sold carries a warning badge, "Needs a push" (thresholds in `dashboard/classes-panel.tsx`). The whole card opens the class.

### Deals Hero Card (signature)

The dashboard's one gradient: a 135° sweep of the logo blue, from #BCCDE0 through LEAD blue to #8AA3B9, with 28px bold night-canvas numerals, a dark slate caption (#2C3742, 4.6:1 at the darkest corner) and a yellow count chip. It is the only gradient in the system. Do not repeat it elsewhere.

## Do's and Don'ts

### Do:

- **Do** use LEAD blue for every CRM action and keep yellow for highlights and counts. On the public site, keep yellow for Register only.
- **Do** separate layers with a tonal step and a 1px hairline.
- **Do** keep every control a full pill and every panel at 16px corners.
- **Do** show status as coloured text on its own wash, with the 6px dot. Labels that are not a state, such as tags, drop the dot (`before:hidden`).
- **Do** keep CRM text between 11px and 28px and build hierarchy with weight and the chalk steps.
- **Do** use Body Dense (13px) for table cells and sidebar items, so a 1280px screen shows a full working list.

### Don't:

- **Don't** add shadows. The system is flat.
- **Don't** add a second gradient. The deals hero card is the only one.
- **Don't** use yellow for a CRM button, or blue for the public Register button.
- **Don't** use a solid status fill (green, amber or red) as a surface.
- **Don't** darken Chalk Subtle again. It was #6e7486 (3.8:1 on raised slate) until 4 Nov 2026; at #8e94a6 it passes 4.5:1 on every surface, down to 4.73:1 on sunken slate, so table headers and metadata are readable.
- **Don't** put white text on LEAD blue in dark mode. It measures about 2:1. Use Ink on Blue.
