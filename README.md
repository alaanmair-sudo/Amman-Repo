# Building-to-Lot Setback Tool

Reads a new-building drawing (DWG/DXF natively, DWF via commercial converter)
and computes the minimum perpendicular setback from each building edge to its
nearest lot boundary edge. Produces a text report (JSON + markdown) and an
optional annotated DWG with dimension lines on a `SETBACK_DIMS` layer.

Drives AutoCAD LT 2024+ via [puran-water/autocad-mcp](https://github.com/puran-water/autocad-mcp).

## Prerequisites

- **Windows 10/11**
- **AutoCAD LT 2024 or newer** (AutoLISP support is required, added in LT 2024)
- **Python 3.10+**
- **uv** ([install](https://docs.astral.sh/uv/getting-started/installation/))
- A commercial **DWF-to-DWG converter** CLI (e.g. dwgConvert, Any DWG) — only
  needed if you will process DWF files. Autodesk does not provide a DWF-to-DWG
  conversion.

## Getting started (first-time setup)

This repo intentionally **does not** ship secrets, machine-specific paths, or
the vendored autocad-mcp clone. Each contributor sets those up locally from
the committed `*.example` templates.

```powershell
# 1. Clone this repo
git clone https://github.com/<owner>/<repo>.git
cd <repo>

# 2. Clone the autocad-mcp dependency into ./autocad-mcp
git clone https://github.com/puran-water/autocad-mcp.git
cd autocad-mcp
uv sync
cd ..

# 3. Copy the example files and fill them in
copy .env.example .env
copy config.yaml.example config.yaml
copy users.json.example users.json

# 4. Install Python dependencies for this tool
python -m pip install -r requirements.txt

# 5. In AutoCAD LT: APPLOAD autocad-mcp/lisp-code/mcp_dispatch.lsp
#    (add it to Startup Suite so it auto-loads)
```

Then edit:

- **`.env`** — paste your Anthropic API key into `ANTHROPIC_API_KEY=...`. Get
  one at https://console.anthropic.com/settings/keys.
- **`config.yaml`**:
  - `autocad_mcp.python_exe` — absolute path to `autocad-mcp/.venv/Scripts/python.exe`
  - `dwf_converter.command` / `dwf_converter.args` — your converter CLI and arg
    template (supports `{input}` / `{output}` placeholders)
  - `layers.building` / `layers.lot` — layer names in your drawings (matched
    case-insensitively by default)
- **`users.json`** — replace the placeholder accounts with real ones for the
  web app's login screen.

> **Never commit `.env`, `config.yaml`, or `users.json`.** They are gitignored.
> If `git status` ever shows them, stop and check `.gitignore` before pushing.

## Use

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

## MCP client usage

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
setback_tool.py  (CLI orchestrator)
    │
    ├── dwf_convert.py   ──► dwgConvert / Any DWG  (if input is .dwf)
    │
    ├── mcp_client.py    ──► stdio ──► autocad-mcp  ──► AutoCAD LT 2024+
    │                                   │
    │                                   └── system.execute_lisp (for polyline
    │                                       vertex extraction — upstream
    │                                       entity.get only returns details
    │                                       for LINE/CIRCLE)
    │
    ├── geometry.py      ──► shapely (polygon build + nearest_points per edge)
    │
    └── report.py        ──► JSON + markdown
```

## Verification

1. **Smoke test** — open AutoCAD LT 2024+, APPLOAD the dispatcher. Run
   `python -c "import asyncio; from mcp_client import connect_autocad_mcp; asyncio.run((lambda: None)())"`
   to confirm imports. Then run the CLI against a simple sample.

2. **Sample DWG** — make a drawing with a closed polyline on layer `LOT`
   (30×30 rectangle) and a closed polyline on layer `BUILDING` (10×10 offset
   so each side has a different setback, e.g. 5/10/8/12). Run the tool with
   `--annotate`. Verify:
   - Markdown report shows 4 edges with the expected distances
   - The annotated DWG has 4 dimension lines on the `SETBACK_DIMS` layer
   - Opening the annotated DWG in AutoCAD shows the dimensions visually

3. **DWF path** — publish the same drawing as DWF, delete the DWG, run the
   tool against the DWF. Confirm the converter runs, a temp DWG is produced,
   and the output numbers match step 2 (within a small tolerance).

4. **Edge cases** — building outside lot → tool errors loudly; building
   touching lot → distance 0.0; non-rectilinear building → `shapely` handles
   it without special cases.
