"""Pre-processor: if input is DWF, shell out to a commercial DWF-to-DWG converter.

AutoCAD LT cannot read DWF entities natively (DWFATTACH creates an underlay with
no enumerable geometry; Autodesk has no official DWF-to-DWG conversion). A
commercial CLI converter (e.g. dwgConvert, Any DWG) is required. The user
configures the command and arg template in config.yaml.
"""

from __future__ import annotations

import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Sequence


class DWFConversionError(RuntimeError):
    pass


def normalize_to_dwg(
    input_path: Path,
    converter_cmd: str,
    converter_args: Sequence[str],
    timeout_seconds: int,
) -> tuple[Path, Path | None]:
    """If input is DWG/DXF, return it unchanged. If DWF, convert to a temp DWG.

    Returns (usable_path, temp_dir_to_cleanup_or_None).
    """
    suffix = input_path.suffix.lower()
    if suffix in {".dwg", ".dxf"}:
        return input_path, None
    if suffix not in {".dwf", ".dwfx"}:
        raise DWFConversionError(f"Unsupported file extension: {suffix}")

    if not shutil.which(converter_cmd) and not Path(converter_cmd).exists():
        raise DWFConversionError(
            f"DWF converter '{converter_cmd}' not found on PATH or as a direct file. "
            "Install dwgConvert or Any DWG Converter and set the command in config.yaml."
        )

    tmp_dir = Path(tempfile.mkdtemp(prefix="setback_dwf_"))
    output_path = tmp_dir / (input_path.stem + ".dwg")

    resolved = [
        a.format(input=str(input_path), output=str(output_path))
        for a in converter_args
    ]
    cmd = [converter_cmd, *resolved]

    try:
        proc = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
            check=False,
        )
    except subprocess.TimeoutExpired as e:
        raise DWFConversionError(f"DWF conversion timed out after {timeout_seconds}s") from e

    if proc.returncode != 0 or not output_path.exists():
        raise DWFConversionError(
            f"DWF conversion failed (exit {proc.returncode}).\n"
            f"cmd: {' '.join(cmd)}\nstderr: {proc.stderr.strip()[:400]}"
        )

    return output_path, tmp_dir
