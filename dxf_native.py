"""Pure-Python DXF reader via ezdxf, exposing the same shape as mcp_client for
the agent tools. Used when the input is a .dxf file — avoids the AutoCAD tab
churn where `_.OPEN` creates a new tab and the LISP dispatcher doesn't follow.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

import ezdxf

from mcp_client import Polyline


@dataclass
class DXFReader:
    path: Path
    doc: Any = None

    # Async-shaped methods so this is a drop-in for AutoCADMCPClient in the
    # tool executor. The underlying ezdxf work is synchronous and fast.

    async def open_drawing(self, path: str | Path | None = None) -> dict:
        if path is not None:
            self.path = Path(path)
        self.doc = ezdxf.readfile(str(self.path))
        msp = self.doc.modelspace()
        return {"opened": str(self.path), "entity_count": len(msp)}

    async def list_layers(self) -> list[dict]:
        return [
            {"name": l.dxf.name, "color": getattr(l.dxf, "color", 7)}
            for l in self.doc.layers
        ]

    async def extract_polylines(self, layer_name: str) -> list[Polyline]:
        """Mirror mcp_client.AutoCADMCPClient.extract_polylines — only LWPOLYLINE,
        POLYLINE, and LINE on the given layer."""
        msp = self.doc.modelspace()
        out: list[Polyline] = []
        # Case-insensitive layer match
        target_low = layer_name.lower()
        for e in msp:
            elayer = e.dxf.layer
            if elayer.lower() != target_low:
                continue
            t = e.dxftype()
            if t == "LWPOLYLINE":
                pts = [(float(p[0]), float(p[1])) for p in e.get_points()]
                out.append(
                    Polyline(
                        handle=e.dxf.handle,
                        layer=elayer,
                        closed=bool(e.closed),
                        vertices=pts,
                    )
                )
            elif t == "POLYLINE":
                pts = []
                for v in e.vertices:
                    loc = v.dxf.location
                    pts.append((float(loc[0]), float(loc[1])))
                out.append(
                    Polyline(
                        handle=e.dxf.handle,
                        layer=elayer,
                        closed=bool(getattr(e, "is_closed", False)),
                        vertices=pts,
                    )
                )
            elif t == "LINE":
                s = e.dxf.start
                x = e.dxf.end
                out.append(
                    Polyline(
                        handle=e.dxf.handle,
                        layer=elayer,
                        closed=False,
                        vertices=[(float(s[0]), float(s[1])), (float(x[0]), float(x[1]))],
                    )
                )
        return out
