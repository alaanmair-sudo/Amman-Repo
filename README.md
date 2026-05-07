# Amman Permit Review Platform

End-to-end AI-driven review platform for أمانة عمان الكبرى (Greater Amman
Municipality) building permit submissions. Reads the consultant's drawings
(DWG/DXF natively, DWF via a commercial converter) and PDF artifacts (deed,
site plan, floor plans, parking) and runs three review stages:

1. **Structure validation** — required artifacts present and parseable.
2. **Discrepancy review** — AI-extracted drawing values cross-checked against
   the consultant-declared values (deed dunum vs. drawing area, declared
   floor areas vs. floor-plan geometry, site-plan setbacks vs. drawing).
3. **Violation review** — code compliance: per-edge setbacks, buildable
   envelope, violation polygon, fines per zoning category, coverage, and
   serious lot-crossing flags.

Ships as both a **FastAPI web app** (login, reviewer/submitter dashboards,
upload + SSE progress + report viewer) and a **CLI** (`setback_tool.py`) for
the geometric core.

The CAD pipeline drives AutoCAD LT 2024+ via
[puran-water/autocad-mcp](https://github.com/puran-water/autocad-mcp).

## Platform support

| Component | Windows | macOS / Linux |
| --- | --- | --- |
| Web app code (FastAPI, frontend, AI review modules) | ✅ | ✅ |
| AutoCAD-driven geometry pipeline (CLI + agent CAD tools) | ✅ | ❌ — needs AutoCAD LT 2024+ |
| DWF → DWG conversion | ✅ (with commercial converter) | ❌ |
| PDF analysis (deed / site plan / floor plan / parking) | ✅ | ✅ |

Working from a Mac is fine for editing the web app, prompts, and review
modules. Anything that touches AutoCAD or DWF will only run on the Windows
machine.

## Prerequisites

- **Python 3.10+**
- **uv** ([install](https://docs.astral.sh/uv/getting-started/installation/)) — only needed if you'll run the autocad-mcp pipeline
- **AutoCAD LT 2024 or newer** — only needed for the CAD pipeline; AutoLISP support was added in LT 2024
- A commercial **DWF-to-DWG converter** CLI (e.g. reaConverter, dwgConvert, Any DWG) — only needed if you will process DWF files. Autodesk does not provide a DWF-to-DWG conversion.
- An **Anthropic API key** for the AI review modules (deed, site plan, floor plan, parking, agent)

## Getting started

This repo intentionally **does not** ship secrets, machine-specific paths, or
the vendored autocad-mcp clone. Each contributor sets those up locally from
the committed `*.example` templates.

### macOS / Linux

```bash
# 1. Clone this repo
git clone https://github.com/alaanmair-sudo/Amman-Repo.git
cd Amman-Repo

# 2. (Optional, Windows only) Clone the autocad-mcp dependency
#    Skip on macOS/Linux — the CAD pipeline can't run there anyway.
# git clone https://github.com/puran-water/autocad-mcp.git
# (cd autocad-mcp && uv sync)

# 3. Copy the example files and fill them in
cp .env.example .env
cp config.yaml.example config.yaml
cp users.json.example users.json

# 4. Install Python deps
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Windows (PowerShell)

```powershell
# 1. Clone this repo
git clone https://github.com/alaanmair-sudo/Amman-Repo.git
cd Amman-Repo

# 2. Clone the autocad-mcp dependency into ./autocad-mcp
git clone https://github.com/puran-water/autocad-mcp.git
cd autocad-mcp
uv sync
cd ..

# 3. Copy the example files and fill them in
copy .env.example .env
copy config.yaml.example config.yaml
copy users.json.example users.json

# 4. Install Python deps
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

# 5. In AutoCAD LT: APPLOAD autocad-mcp/lisp-code/mcp_dispatch.lsp
#    (add it to Startup Suite so it auto-loads)
```

### Then edit

- **`.env`** — paste your Anthropic API key into `ANTHROPIC_API_KEY=...`. Get
  one at https://console.anthropic.com/settings/keys.
- **`config.yaml`**:
  - `autocad_mcp.python_exe` — absolute path to the autocad-mcp venv's
    Python (`.venv/Scripts/python.exe` on Windows, `.venv/bin/python` on
    macOS/Linux). Only used when the CAD pipeline runs.
  - `dwf_converter.command` / `dwf_converter.args` — your converter CLI and
    arg template (supports `{input}` / `{output}` placeholders). Windows-only.
  - `layers.building` / `layers.lot` — layer names in your drawings (matched
    case-insensitively by default)
  - `compliance.fines_by_category` — per-zoning-category fine rates (JOD/m²)
    from the official Amman fines table; the lookup is tolerant of
    parentheses and the leading "ال" definite article
  - `agent.model` — Claude model used by the AI review modules
- **`users.json`** — replace the placeholder accounts with real ones for the
  web app's login screen.

> **Never commit `.env`, `config.yaml`, or `users.json`.** They are gitignored.
> If `git status` ever shows them, stop and check `.gitignore` before pushing.

## Run the web app

```bash
uvicorn app.main:app --reload --port 8000
```

Then open http://localhost:8000 and log in with one of the accounts from
`users.json`. The app handles uploads, runs the AI review modules, streams
progress over SSE, and serves the reviewer/submitter dashboards. Saved
analyses land under `analysis/{name}_{YYYY-MM-DD}_{HHMMSS}.md`.

> Note: uvicorn's `--reload` is unreliable on this Windows setup — if a
> backend edit doesn't seem to have taken effect, kill and restart uvicorn
> manually. Frontend assets auto-bust their `?v=` cache string on save.

## Run the CLI (Windows + AutoCAD only)

Drawing with known layers `BUILDING` and `LOT`:

```powershell
# Open AutoCAD LT first (the File IPC backend needs a running AutoCAD window)
python setback_tool.py path\to\drawing.dwg --annotate --output-dir reports
```

Outputs:

- `reports/drawing_setbacks.json`
- `reports/drawing_setbacks.md`
- `reports/drawing_annotated.dwg` (with `--annotate`)
- `reports/drawing_annotated.pdf` (if `output.pdf: true` in config)

DWF inputs are converted to DWG first via the configured converter.

## MCP client usage (Windows)

The upstream autocad-mcp is a standard MCP server. Registering it in any
compatible MCP client config lets you drive AutoCAD interactively, using the
same backend this tool uses:

```json
{
  "mcpServers": {
    "autocad-mcp": {
      "command": "C:\\...\\autocad-mcp\\.venv\\Scripts\\python.exe",
      "args": ["-m", "autocad_mcp"],
      "env": { "AUTOCAD_MCP_BACKEND": "file_ipc" }
    }
  }
}
```

The MCP client can then call tools like `drawing`, `entity`, `layer`,
`annotation` directly — or shell out to `setback_tool.py` for the full
pipeline.

## Architecture

```
app/                              FastAPI web app
  main.py                           routes, SSE, static, login
  auth.py                           token auth, role gating
  jobs.py                           in-memory job store + saved analyses
  agent.py                          Claude tool-use loop (CAD pipeline)
  tools.py                          agent tools: open, extract, compute, annotate
  pdf_analyzer.py                   deed extractor (dunum / zoning / coords)
  site_plan_extractor.py            site-plan PDF → required setbacks
  floor_plan_analyzer.py            floor-plan PDF → declared vs. measured areas
  special_provisions.py             buildable-envelope / coverage logic
  validation.py                     structure + discrepancy checks
  static/                           login + per-page UI (overview, dashboard,
                                    reports, timeline, maps, reviewer, settings)
  prompts/system.md                 agent system prompt

setback_tool.py                   CLI orchestrator
  ├── dwf_convert.py              DWF → DWG via configured converter
  ├── mcp_client.py               stdio → autocad-mcp → AutoCAD LT 2024+
  │                                 (uses system.execute_lisp for polyline
  │                                 vertex extraction; entity.get only
  │                                 returns details for LINE/CIRCLE)
  ├── dxf_native.py               ezdxf-based DWG/DXF reader (no AutoCAD)
  ├── geometry.py                 shapely polygons + nearest-edge distances
  ├── street_classifier.py        STREET-layer-based front/back/side tagging
  └── report.py                   JSON + markdown output
```

## Verification

1. **Smoke test (web)** — `uvicorn app.main:app --port 8000`, log in, upload
   a sample DWG + site-plan PDF + deed, watch the SSE stream complete.

2. **Smoke test (CLI, Windows)** — open AutoCAD LT 2024+, APPLOAD the
   dispatcher. Run the CLI against a simple sample.

3. **Sample DWG** — make a drawing with a closed polyline on layer `LOT`
   (30×30 rectangle) and a closed polyline on layer `BUILDING` (10×10 offset
   so each side has a different setback, e.g. 5/10/8/12). Run the tool with
   `--annotate`. Verify:
   - Markdown report shows 4 edges with the expected distances
   - The annotated DWG has 4 dimension lines on the `SETBACK_DIMS` layer
   - Opening the annotated DWG in AutoCAD shows the dimensions visually

4. **DWF path** — publish the same drawing as DWF, delete the DWG, run the
   tool against the DWF. Confirm the converter runs, a temp DWG is produced,
   and the output numbers match step 3 (within a small tolerance).

5. **Edge cases** — building outside lot → tool errors loudly; building
   touching lot → distance 0.0; non-rectilinear building → `shapely` handles
   it without special cases.
