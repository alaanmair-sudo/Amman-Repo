# Figma Make prompt — Permit Review Platform

> Copy everything below the divider into Figma Make. It describes the product, users, data, and screens — and explicitly leaves the aesthetic open.

---

## Context

Design the UI for an AI-powered building permit review platform. This is a real internal tool for **أمانة عمان الكبرى (Greater Amman Municipality, Jordan)**. Pick your own opinionated visual direction — don't default to generic SaaS dashboard chrome. I'm describing functionality, data, and personas; the aesthetic is yours to choose.

Target: desktop-first (1440px and up). Reviewers and consultants work on workstations alongside CAD software. Mobile/tablet is out of scope.

## What the platform does

A licensed engineering consultant uploads four documents per permit application. The system reads them with AI, cross-checks them against each other, and produces a verdict for a municipality reviewer to decide on. Manual reviews used to take weeks; AI reviews take minutes.

## The review pipeline (three sequential stages)

1. **Structure validation** — Are all four documents present, parseable, and complete?
2. **Discrepancy review** — Do values declared in the PDFs agree with what the CAD drawing actually shows? (Declared lot area vs measured polygon area, declared floor totals vs computed totals, required setbacks vs measured setbacks, etc.)
3. **Violation review** — Does the design comply with the regulatory site plan? (Setbacks respected, coverage within limits, building inside the lot polygon.) If not, compute the violation polygon area and the resulting fine in Jordanian Dinars.

## Personas

- **Submitter / consultant** — uploads documents, sees pre-submission AI-flagged issues, can revise drawings or submit anyway. Wants to avoid back-and-forth with the reviewer.
- **Municipality reviewer** — works through a queue of pending applications. Approves clean cases quickly; focuses attention on flagged ones. Decisions: approve / return-for-revision / reject.
- **Admin** — aggregate stats, user management.

## The four input documents

- **CAD drawing** (DWG/DXF/DWF) — building polygon, lot polygon, optional STREET polyline, dimensions on layered drawings.
- **سند التسجيل (deed)** — Arabic land registration PDF. Plot number, basin number/name, village, owner name, lot area in dunum (1 dunum = 1000 m²; e.g. "4 دونم 877.170" = 4877.170 m²), declared number of floors.
- **مخطط موقع تنظيمي (regulatory site plan)** — Arabic municipal regulatory PDF. Required setbacks (front/side/rear in metres), use type (e.g. residential D), corner-lot flag, max coverage ratio.
- **خطة مساحة الطابقية (floor-area plan)** — Arabic per-floor breakdown table. Rows: {floor name, dimensions like "16 × 20", quantity, sign +/-, printed area}. The system verifies dim × qty × sign matches printed total within ±1 m².

## What the AI does

- Drives AutoCAD via an MCP server: extracts polylines, builds polygons, classifies edges as front/side/rear based on STREET layer proximity, computes per-edge setbacks, computes the buildable envelope (lot inset by required setbacks), computes the violation polygon (building footprint outside envelope), computes the fine (violation area × configurable JOD rate per m²).
- Reads the three Arabic PDFs and extracts structured data.
- Streams its reasoning live as tool calls — the UI should be able to surface this stream in real time.

## Screens to design (8 total)

### 1. Login
Username + password fields. Demo accounts visible. Should signal the platform's identity and the gravity of what it does (government-grade review tool).

### 2. Dashboard / reviewer queue
- List of all permit applications visible to the reviewer.
- Filters: stage, verdict (PASS / WARN / FAIL / FAIL-SERIOUS), application type, district, submitter, date range.
- Per row: ID, submitter name (Arabic), plot, district, type, current stage, AI verdict, fine in JOD, last updated.
- Aggregate stats: pending count, reviewed today, average processing time, auto-pass rate, total fines this week.
- Quick actions: open the review screen, quick-approve a clean case.

### 3. Application classification (intake step 1)
Submitter chooses application type from a list of ~15 municipal types in Arabic. Examples: initial consultation (preliminary approval), technical consultation, proposed permit on vacant land, proposed permit over existing, amended plan permit, occupancy permit, occupancy renewal, additions permit, central planning committee review, deposit forfeiture, etc.

### 4. Document upload (intake step 2)
- Four upload zones, one per document. Each shows state: empty / uploading / parsed / error.
- As each file uploads, system parses it and shows extracted fields inline (e.g. "plot 234 · basin 12 · 4 دونم 877.170").
- Live AI-checks panel updates as Stages 1–3 run in the background.

### 5. Pre-submit summary (intake step 3)
- Once analysis completes, show every issue the reviewer is likely to flag.
- Per issue: what was declared, what was measured, the delta, the consequence (fine / revision / rejection).
- Two actions: revise & re-upload, or submit anyway with known issues acknowledged (the reviewer will see a badge).

### 6. Reviewer review (the most important screen)
The reviewer's primary surface. Must surface all of the following without leaving the page:

- **Identity header**: app ID, submitter, plot, district, application type, submission timestamp.
- **Three-stage verdict strip**: Stage 1/2/3 each shown as PASS/WARN/FAIL with one-line summary.
- **CAD visualization**: rendered drawing showing lot polygon, building footprint, buildable envelope (dashed), violation polygon (hatched if any), street polyline, dimension callouts on every side. Should support zoom, pan, layer toggles. The CAD visualization is a first-class citizen here — it's the document being reviewed.
- **KPI tiles**: lot area, building footprint, coverage %, floor totals, min setback, violation area in m², estimated fine in JOD.
- **Discrepancy reconciliation**: side-by-side rows showing every PDF-declared value against the AI-measured value, with the delta. (Lot area: deed vs CAD. Floor totals: printed vs computed. Setbacks: required vs measured. Coverage: max vs actual.) This is the conceptual heart of the product — surface it accordingly.
- **Floor breakdown table**: every row from the floor-area PDF with computed-vs-printed verification.
- **Compliance verdict**: violation area + fine + severity flag. ("Serious" means the building exits the lot polygon entirely — a critical error that always blocks approval.)
- **AI summary paragraph**: human-readable explanation of the findings, in Arabic and English.
- **Live AI reasoning feed**: scrollable timeline of tool calls and reasoning with timestamps. Should feel ambient, not centerpiece — reviewers value it but mostly skim it.
- **Decision actions**: Approve / Return for revision / Reject. Returning for revision opens a notes field that auto-populates from the flagged issues.

### 7. Submitter status view
The consultant's view of their submitted application. Status (pending / approved / needs-revision / rejected), reviewer's notes if returned, timeline of stages, ability to upload corrected files if returned.

### 8. Decision history
A reviewer's past decisions: searchable, filterable, replayable (clicking opens the original review screen as it appeared at decision time).

## Locale & accessibility

- **Primary language is Arabic, right-to-left.** Use Noto Kufi Arabic or equivalent.
- Secondary language is English (toggle in topbar). Technical terms stay in English (CAD, DWG, layer names like BUILDING / LOT / STREET).
- Numbers in Western Arabic numerals (1234) by default.
- Currency: Jordanian Dinar (JOD). Areas in m² and dunum.
- Don't rely on color alone for verdict states — use type weight, iconography, and layout too. Some reviewers have color vision deficiency.

## Sample data to populate the design

Use **APP-2026-04219** for the review screen:
- Submitter: محمد أحمد الخطيب
- Type: ترخيص مقترح على ارض خالية (proposed permit on vacant land)
- Plot 234, basin 12 (الياسمين), village تلاع العلي
- Lot area: 4 دونم 877.170 = 4,877.17 m²
- 4 floors, 1,256 m² total (تسوية أولى 396 + أرضي 320 + طابق أول 288 + طابق ثاني 252)
- Building footprint 320 m², coverage 6.6%
- Required setbacks (site plan): front 5.0, side 3.0, rear 4.0 m
- Measured setbacks (CAD): north 4.7, south 4.0, east 3.1, west 8.5 m
- Verdict: front setback 0.3 m short → 8.4 m² violation polygon → 1,680 JOD fine (at 200 JOD/m²)
- Severity: minor (building stays inside lot)

**Queue items** for the dashboard:
- 04218 · مؤسسة الأبراج للإنشاءات · plot 812 شفا بدران · over existing · PASS · 0 JOD · 3 min ago
- 04217 · سلوى نواف الدلاعلة · plot 114 أبو نصير · additions · FAIL (serious) · 14,400 JOD · 11 min ago
- 04216 · عمر طارق نجداوي · plot 56 ماركا · initial consult · PASS · — · 34 min ago
- 04215 · مكتب الهندسة الذهبية · plot 991 صويلح · occupancy · WARN · 320 JOD · 1 hr ago
- 04214 · شركة الفنار للمقاولات · plot 428 الجبيهة · vacant land · PASS · 0 JOD · 2 hr ago
- 04213 · أحمد فؤاد العبسي · plot 772 خلدا · amended plan · FAIL · 3,200 JOD · 3 hr ago

## What I want from you

Make confident, opinionated choices. The product is serious civic technology dealing with regulated, high-stakes decisions — design it accordingly. Pick the visual direction, typography, color, density, and layout that you think best serves the users and the content. Produce all 8 screens.
