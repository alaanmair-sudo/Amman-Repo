"""Thin async wrapper around puran-water/autocad-mcp over MCP stdio.

Launches `python -m autocad_mcp` as a subprocess, opens an MCP session, and
exposes high-level methods for the setback tool. Vertex extraction is done via
`system.execute_lisp` because the upstream `entity.get` only returns detailed
coordinates for LINE/CIRCLE (not polylines).
"""

from __future__ import annotations

import json
from contextlib import asynccontextmanager
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Sequence

from mcp import ClientSession, StdioServerParameters
from mcp.client.stdio import stdio_client


@dataclass
class Polyline:
    handle: str
    layer: str
    closed: bool
    vertices: list[tuple[float, float]]


EXTRACT_LISP = r"""
(defun c:mcp-extract-layer-polys (lname / ent ed etype pts result first)
  (setq result "[" first T ent (entnext))
  (while ent
    (setq ed (entget ent))
    (setq etype (cdr (assoc 0 ed)))
    (if (and (= (strcase (cdr (assoc 8 ed))) (strcase lname))
             (member etype (list "LWPOLYLINE" "POLYLINE" "LINE")))
      (progn
        (if (not first) (setq result (strcat result ",")))
        (setq first nil)
        (cond
          ((= etype "LINE")
           (setq result (strcat result
             "{\"handle\":\"" (cdr (assoc 5 ed)) "\""
             ",\"type\":\"LINE\",\"closed\":false,\"vertices\":["
             "[" (rtos (car (cdr (assoc 10 ed))) 2 8) ","
                 (rtos (cadr (cdr (assoc 10 ed))) 2 8) "],"
             "[" (rtos (car (cdr (assoc 11 ed))) 2 8) ","
                 (rtos (cadr (cdr (assoc 11 ed))) 2 8) "]]}")))
          ((= etype "LWPOLYLINE")
           (setq pts "" )
           (foreach pair ed
             (if (= (car pair) 10)
               (setq pts (strcat pts (if (= pts "") "" ",")
                 "[" (rtos (car (cdr pair)) 2 8) ","
                     (rtos (cadr (cdr pair)) 2 8) "]"))))
           (setq result (strcat result
             "{\"handle\":\"" (cdr (assoc 5 ed)) "\""
             ",\"type\":\"LWPOLYLINE\""
             ",\"closed\":" (if (= 1 (logand 1 (cdr (assoc 70 ed)))) "true" "false")
             ",\"vertices\":[" pts "]}")))
          ((= etype "POLYLINE")
           (setq pts "" )
           (setq v (entnext ent))
           (while (and v (= (cdr (assoc 0 (entget v))) "VERTEX"))
             (setq pts (strcat pts (if (= pts "") "" ",")
               "[" (rtos (car (cdr (assoc 10 (entget v)))) 2 8) ","
                   (rtos (cadr (cdr (assoc 10 (entget v)))) 2 8) "]"))
             (setq v (entnext v)))
           (setq result (strcat result
             "{\"handle\":\"" (cdr (assoc 5 ed)) "\""
             ",\"type\":\"POLYLINE\""
             ",\"closed\":" (if (= 1 (logand 1 (cdr (assoc 70 ed)))) "true" "false")
             ",\"vertices\":[" pts "]}")))
        )
      )
    )
    (setq ent (entnext ent))
  )
  (strcat result "]")
)
(c:mcp-extract-layer-polys "__LAYER_NAME__")
"""


def _unwrap(raw: Any) -> Any:
    """MCP tool results arrive as TextContent list; return the first text payload parsed as JSON."""
    if hasattr(raw, "content"):
        parts = raw.content
    else:
        parts = raw
    if isinstance(parts, list) and parts:
        first = parts[0]
        text = getattr(first, "text", first)
        return json.loads(text) if isinstance(text, str) else text
    if isinstance(parts, str):
        return json.loads(parts)
    return parts


class AutoCADMCPClient:
    def __init__(self, session: ClientSession):
        self._s = session

    async def _call(self, tool: str, **kwargs) -> Any:
        return _unwrap(await self._s.call_tool(tool, arguments=kwargs))

    async def status(self) -> dict:
        return await self._call("system", operation="status")

    async def open_drawing(self, path: str) -> dict:
        return await self._call("drawing", operation="open", data={"path": str(path)})

    async def save_drawing(self, path: str | None = None) -> dict:
        data = {"path": str(path)} if path else {}
        return await self._call("drawing", operation="save", data=data)

    async def plot_pdf(self, path: str) -> dict:
        return await self._call("drawing", operation="plot_pdf", data={"path": str(path)})

    async def list_layers(self) -> list[dict]:
        res = await self._call("layer", operation="list")
        payload = res.get("payload") if isinstance(res, dict) else res
        if isinstance(payload, str):
            payload = json.loads(payload)
        return payload.get("layers") if isinstance(payload, dict) else payload

    async def ensure_layer(self, name: str, color: str = "yellow") -> None:
        await self._call("layer", operation="create", data={"name": name, "color": color})

    async def set_current_layer(self, name: str) -> None:
        await self._call("layer", operation="set_current", data={"name": name})

    async def extract_polylines(self, layer_name: str) -> list[Polyline]:
        code = EXTRACT_LISP.replace("__LAYER_NAME__", layer_name)
        res = await self._call("system", operation="execute_lisp", data={"code": code})
        payload = res.get("payload") if isinstance(res, dict) else res
        if isinstance(payload, str):
            payload = json.loads(payload)
        items = json.loads(payload) if isinstance(payload, str) else payload
        out: list[Polyline] = []
        for it in items:
            out.append(
                Polyline(
                    handle=it["handle"],
                    layer=layer_name,
                    closed=bool(it.get("closed")),
                    vertices=[(float(x), float(y)) for x, y in it["vertices"]],
                )
            )
        return out

    async def draw_aligned_dimension(
        self, x1: float, y1: float, x2: float, y2: float, offset: float
    ) -> dict:
        return await self._call(
            "annotation",
            operation="create_dimension_aligned",
            data={"x1": x1, "y1": y1, "x2": x2, "y2": y2, "offset": offset},
        )

    async def draw_line(self, x1: float, y1: float, x2: float, y2: float, layer: str | None) -> dict:
        return await self._call(
            "entity", operation="create_line", x1=x1, y1=y1, x2=x2, y2=y2, layer=layer
        )

    async def create_text(self, x: float, y: float, text: str, layer: str | None = None, height: float = 2.5) -> dict:
        return await self._call(
            "annotation",
            operation="create_text",
            data={"x": x, "y": y, "text": text, "height": height, "layer": layer},
        )

    async def zoom_extents(self) -> dict:
        return await self._call("view", operation="zoom_extents")

    # ---- Compliance annotation: dashed envelope + hatched violations ----

    async def load_linetype(self, name: str = "DASHED") -> dict:
        """Make sure the named linetype is loaded into the drawing. Idempotent
        — if already loaded, AutoCAD returns silently."""
        code = (
            '(if (not (tblsearch "ltype" "' + name + '")) '
            '(command "_.-LINETYPE" "_Load" "' + name + '" "acad.lin" ""))'
        )
        return await self._call("system", operation="execute_lisp", data={"code": code})

    async def set_layer_linetype(self, layer: str, linetype: str = "DASHED") -> dict:
        """Set a layer's default linetype (so any entity drawn on it inherits it)."""
        code = (
            '(if (tblsearch "layer" "' + layer + '") '
            '(command "_.-LAYER" "_Ltype" "' + linetype + '" "' + layer + '" ""))'
        )
        return await self._call("system", operation="execute_lisp", data={"code": code})

    async def draw_polyline(
        self, points: Sequence[tuple[float, float]], closed: bool, layer: str | None = None
    ) -> dict:
        """Draw an LWPOLYLINE through the given points using the PLINE command."""
        if not points or len(points) < 2:
            return {"skipped": True, "reason": "need at least 2 points"}
        layer_set = ""
        if layer:
            # Switch to the target layer for the duration of the command, then
            # PLINE will deposit the entity there.
            layer_set = f'(setvar "CLAYER" "{layer}") '
        pts_lisp = " ".join(f'(list {x:.6f} {y:.6f})' for x, y in points)
        close_token = '"_C"' if closed else '""'
        code = (
            '(setq __pts (list ' + pts_lisp + ')) '
            + layer_set +
            '(command "_.PLINE") '
            '(foreach p __pts (command p)) '
            '(command ' + close_token + ')'
        )
        return await self._call("system", operation="execute_lisp", data={"code": code})

    async def hatch_polygon(
        self,
        rings: Sequence[Sequence[tuple[float, float]]],
        layer: str,
        pattern: str = "ANSI31",
        scale: float = 1.0,
    ) -> dict:
        """Hatch a polygon defined by one or more rings using BHATCH.

        We materialise each ring as a temporary closed LWPOLYLINE on the target
        layer, run -HATCH in Select-Objects mode against those polylines, then
        delete the boundary polylines again so only the hatch entity is left
        behind. This avoids picking-an-internal-point heuristics that fail for
        narrow / disconnected violation regions.
        """
        if not rings:
            return {"skipped": True, "reason": "no rings"}
        # Build the LISP: create polylines for every ring, collect their entity
        # names, run -HATCH on them, delete the helper polylines.
        ring_blocks: list[str] = []
        for ring_idx, ring in enumerate(rings):
            if len(ring) < 3:
                continue
            pts = " ".join(f'(list {x:.6f} {y:.6f})' for x, y in ring)
            ring_blocks.append(
                f'(setq __r{ring_idx} (list {pts})) '
                f'(command "_.PLINE") '
                f'(foreach p __r{ring_idx} (command p)) '
                f'(command "_C") '
                f'(setq __pl{ring_idx} (entlast)) '
                f'(setq __plist (cons __pl{ring_idx} __plist))'
            )
        if not ring_blocks:
            return {"skipped": True, "reason": "all rings degenerate"}
        rings_code = " ".join(ring_blocks)
        # ssadd builds a selection set from the helper polylines for -HATCH.
        sel_build = (
            '(setq __ss (ssadd)) '
            '(foreach pl __plist (setq __ss (ssadd pl __ss))) '
        )
        code = (
            f'(setvar "CLAYER" "{layer}") '
            '(setq __plist nil) '
            + rings_code + ' '
            + sel_build +
            f'(command "_.-HATCH" "_Properties" "{pattern}" {scale:.4f} 0 '
            '"_Select" __ss "" "") '
            '(foreach pl __plist (entdel pl)) '
        )
        return await self._call("system", operation="execute_lisp", data={"code": code})


@asynccontextmanager
async def connect_autocad_mcp(
    repo_dir: str | Path,
    python_exe: str | Path,
    backend: str = "file_ipc",
    ipc_timeout: str = "60",
):
    """Launch autocad-mcp as a stdio MCP subprocess and yield a high-level client."""
    repo_dir = Path(repo_dir).resolve()
    python_exe = Path(python_exe).resolve()
    if not python_exe.exists():
        raise FileNotFoundError(
            f"autocad-mcp python not found at {python_exe}. Run `uv sync` inside the repo first."
        )
    params = StdioServerParameters(
        command=str(python_exe),
        args=["-m", "autocad_mcp"],
        env={
            "AUTOCAD_MCP_BACKEND": backend,
            "AUTOCAD_MCP_IPC_TIMEOUT": str(ipc_timeout),
        },
        cwd=str(repo_dir),
    )
    async with stdio_client(params) as (read, write):
        async with ClientSession(read, write) as session:
            await session.initialize()
            yield AutoCADMCPClient(session)
