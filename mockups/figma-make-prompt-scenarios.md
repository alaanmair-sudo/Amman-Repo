# Figma Make prompt — Permit Review Platform (scenario brief)

> Third sibling. Six concrete moments, six users, six stakes. The designer figures out the screens.

---

## Brief

Six moments. Six users in front of the screen. Design what each one sees so they can do what they came to do — and feel right doing it.

The platform is the AI permit-review system for **Greater Amman Municipality (أمانة عمان الكبرى)**. Submitters drop in drawings + paperwork; AI cross-checks every declared value against the drawing; reviewers decide approve / send back / reject. **Arabic right-to-left primary, English secondary.** Areas in dunum (1 دونم = 1000 m²) and m². Fines in Jordanian Dinars.

That's all the system context you need. Now the scenes.

## Scene 1 — Sunday, 09:14. سامية opens her queue.

Samiyah is a senior reviewer at GAM. She has 23 applications to clear today. Six are over a week old. Before she's poured her tea, she needs to know: which are clean enough to stamp in 30 seconds, which need her real attention, and is anything urgent.

**Design what she opens to.**

## Scene 2 — Monday, 11:42. طارق tries to submit before the office closes.

Tariq is the engineering consultant for plot 234 in تلاع العلي. He's done with revisions — he thinks. He drops his four files: the CAD drawing, the deed, the regulatory site plan, the floor-area schedule. He wants to know, in real time, whether the AI is going to flag anything before he hits submit. If it is, he'd rather fix it now than get it bounced back tomorrow.

**Design what he sees as files land.**

## Scene 3 — Monday, 11:48. The system finishes. طارق reads the verdict.

The AI found one issue: the front setback is 30 cm short of the 5.0 m the regulatory site plan requires. That's an 8.4 m² violation strip along the street-facing edge and a 1,680 JOD fine. Everything else reconciles cleanly — lot area matches the deed exactly (4 دونم 877.170 = 4,877.17 m²), all four floor totals verify against the printed grand total, coverage is comfortably under the 50% allowed.

He has to choose: revise the drawing now (probably another day's work) or submit anyway with the issue acknowledged (instant submit, but the reviewer will see a flag).

**Design the moment of decision.**

## Scene 4 — Sunday, 09:22. سامية opens طارق's submission.

She has eight minutes before her next meeting. She needs three things, in this order:
1. Did the AI's analysis hold up?
2. What does the drawing actually show — layered, dimensioned, the violation hatched, the buildable envelope dashed?
3. Is 30 cm a "send back for revision" or a "stamp with fine" call?

She wants to compare what was declared in the PDFs against what was measured in the CAD, side by side. She wants to skim the AI's reasoning but not be lectured by it. She wants to feel like she's making the call — not following a recommendation she's been pushed into.

**Design her bench.**

## Scene 5 — Sunday, 09:29. She makes the call.

She decides to send it back. The violation is small, the consultant is experienced, fixing 30 cm is reasonable. She types two sentences explaining why. Submit.

**What does that interaction look like?**

## Scene 6 — Wednesday, 14:03. طارق re-uploads.

He fixed it. The corrected drawing is in. The previous verdict is history but not gone — both sides should be able to see what changed. The AI re-runs. This time it's clean.

**What does the resubmission moment look like, on both sides?**

## Things to honour

- The **CAD drawing is not a thumbnail** — render it richly, with layers, dimensions, the hatched violation polygon, the dashed buildable envelope, the street polyline.
- **Discrepancy is the conceptual heart**: PDF-declared values lined up against AI-measured values, with deltas. Most match. The ones that don't are the whole story.
- **Arabic typography is its own craft.** Design with Arabic from the first sketch, not as a translation of an English layout.
- Reviewers are professionals. **Density is welcome.** Hierarchy must be uncompromising so a glance still works.
- **The AI is a scribe, not the protagonist.** The human decides.

## Things to avoid

- Confetti, congratulations, motivational copy. This is government work.
- Colour-only verdict signals. Some reviewers have colour vision deficiency.
- Generic dashboard chrome. SaaS templates are not your reference.
- Reducing the drawing to a status icon. It is the document being judged.

## Deliver

Whatever screens (or sub-screens, or modal moments, or split states) the six scenes need. Pick a visual direction with conviction. Don't show me two options — show me the one you'd ship.

Make it good enough that Samiyah, opening it on a Sunday morning, says: *"yes, that's how my Sunday should feel."*
