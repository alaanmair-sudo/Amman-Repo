# Figma Make prompt — Permit Review Platform (creative brief)

> Looser sibling of `figma-make-prompt.md`. Goals + high-level flow + cultural texture, no screen-by-screen spec. Hands creative authority to Figma Make.

---

## Brief

Imagine a reviewer in Amman staring down a queue of permit applications. Each one is a stack of architectural drawings, a deed in Arabic script, a regulatory site plan, a floor schedule. Each one is also someone's home, someone's office, someone's school. The decision matters. The reviewer has minutes, not weeks.

We've built an AI that does the cross-checking — it reads the drawings, reads the PDFs, finds the discrepancies, computes the violations, drafts a verdict. We need a UI that turns its findings into a decision the reviewer can make with confidence and speed.

Design that UI. **Surprise me.**

## What the platform is

A permit-review system for the **Greater Amman Municipality (أمانة عمان الكبرى)**. A licensed engineering consultant drops in their drawings + paperwork. AI cross-checks every declared value against the drawing. A reviewer at the municipality decides approve / send back / reject.

## What I want users to feel

- **Submitters**: relief that the system catches mistakes before the reviewer does. A friend, not a gatekeeper.
- **Reviewers**: trust in what the AI has done — but never coerced by it. The verdict is a recommendation; the human signs off. They should feel powerful, not babysat.
- **Both**: that this is a serious civic instrument, not a startup demo. There's gravity here. Public funds. Building safety. Neighborhoods.

## The journey, in four moments

1. **Arrival.** Submitter enters, classifies their application, drops their files. Documents read in real time. Live signals tell them what's being found.

2. **Verdict-in-the-making.** AI finishes. The submitter sees a draft of what the reviewer will see. If there's anything the reviewer will catch, it's already on screen. They fix it now — or accept the consequence and submit.

3. **The reviewer's bench.** Reviewer opens the application. Within a glance: did it pass, did it fail, what's the headline issue? Within a minute: the full reasoning, the drawing with violations marked, every PDF-declared value beside every AI-measured value. Decision.

4. **Memory.** Both sides can revisit any past decision. The history is a record, not a graveyard.

How many screens that takes is your call.

## What's special about the content

- The application centers on a **CAD drawing**. Buildings exist in geometry. Setbacks are measured in metres. Whatever you design, the drawing is not a thumbnail in the corner — it's the document being judged. Treat it like one.
- **Arabic, right-to-left, primary.** English secondary. Technical terms (DWG, layer names, coordinates) stay English even in Arabic mode.
- **Discrepancy** is the conceptual core: declared (in PDFs) vs measured (from CAD). One number per row. Most match. The ones that don't are the whole story.
- **Areas in dunum** — a Jordanian unit, 1000 m². Deeds say things like "٤ دونم ٨٧٧٫١٧٠" and that means 4,877.17 m². Honor this duality.
- **Violations carry money.** Fines in Jordanian Dinars. Multi-thousand sums. The numbers are not abstract.

## A real example to ground the design

Plot 234 in تلاع العلي. Lot 4 دونم 877.170 = 4,877.17 m². Building footprint 320 m². Required front setback 5.0 m. Measured front setback 4.7 m. The 30 cm shortfall produces an 8.4 m² violation strip along the street-facing edge and a 1,680 JOD fine. Otherwise everything reconciles. Submitter is محمد أحمد الخطيب. The reviewer's job: decide whether 30 cm is worth a revision or a rubber-stamp with a fine.

That should be vivid on the screen.

## What to avoid

- Generic SaaS dashboard. Everything-on-cards. Sidebars-and-tabs. Stripe clones. Linear clones. Notion clones. Use them as references for craft, never as templates.
- Color-only verdict signals. Some reviewers have colour vision deficiency.
- The AI as the protagonist. The AI is a scribe and an inspector. The reviewer is the protagonist.
- Cuteness. This is not an app where someone confetti-pops on approve.

## What to lean into

- **Material.** Permits used to be paper, ink, stamps. Drawings used to be drafted with pens. There's a vocabulary there worth borrowing.
- **Place.** Amman has seven hills, ancient stone, Byzantine and Roman bones, a citadel, a desert wind. The platform serves a city — design it like it knows the city.
- **Type.** Arabic typography is its own art. Don't treat Arabic as an afterthought translation of an English design — design with it from the first sketch.
- **Density.** Reviewers want signal, not air. Don't be afraid of small text and tight grids — but make the hierarchy uncompromising so a glance still works.
- **The drawing.** Render it richly. Layers, dimensions, hatched violations, dashed envelopes. Make a reviewer want to inspect it.

## Deliverable

Whatever screens you think the four-moment journey requires. Pick a visual direction with conviction. Don't ask me to decide between two options — make the call and show me.

Make it good enough that a reviewer at GAM, opening it for the first time, says: *"finally, a tool that takes us seriously."*
