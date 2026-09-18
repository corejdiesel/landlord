# Design rules

## Concept: civic calm

The trust of a well-made public service with the warmth of a good stationery
brand. A beautifully typeset ledger, not a dashboard.

Explicitly avoid: purple gradients, glassmorphism, illustration-pack people,
card grids with drop shadows, anything that looks like default SaaS.

## Type

- One characterful serif for headings and figures. Dates and countdowns are the
  hero — they get the serif, at size, with tabular numerals.
- One humanist sans for UI, **18px base**. Not 14, not 16.
- Tabular numerals (`font-variant-numeric: tabular-nums`) on every date, money
  figure and countdown, so columns line up and digits don't jitter.

## Colour

Paper and ink. Warm off-white ground, near-black ink, one deep accent (bottle
green by default, oxblood as the alternative — both in the tokens file).

**Status is never carried by colour alone.** Every status carries a shape and a
word as well. A red dot on its own is not a status.

Light and dark via CSS variables. Both are first class.

## Readable at 75

The audience is largely over 60, on mixed devices, anxious about getting it
wrong. So:

- 18px base, generous line height, generous tap targets (44px minimum)
- AA contrast minimum, AAA for body text
- No icon-only controls. No hover-only affordances. No tooltips carrying
  information you need.
- Screen-reader labels on every countdown: "41 days remaining, due 14 March 2027"
- Print stylesheets that actually work — a paper route exists for the government
  service and our packs must print beautifully.

## The stamp

Completed obligations get a dated, slightly imperfect stamp mark. The Defence
File and Registration Pack carry the same language in print. One moment of
delight, used sparingly — a stamp on every card is not a motif, it's wallpaper.

## Motion

Minimal and functional. Respect `prefers-reduced-motion` — and mean it, not just
on decorative animation.
