"""Quick PDF dimension inspector for diagnosing measurement-viewer scale."""
import sys
from pypdf import PdfReader

path = sys.argv[1] if len(sys.argv) > 1 else r"uploads\20260428_140239_238b37_School Tanthemi.pdf"
r = PdfReader(path)
print(f"File: {path}")
print(f"Pages: {len(r.pages)}")
for i, p in enumerate(r.pages):
    mb = p.mediabox
    cb = p.cropbox
    width_pts = float(mb.width)
    height_pts = float(mb.height)
    width_mm = width_pts * 25.4 / 72
    height_mm = height_pts * 25.4 / 72
    print(f"--- Page {i+1} ---")
    print(f"  MediaBox  : [{float(mb.left):.2f}, {float(mb.bottom):.2f}, {float(mb.right):.2f}, {float(mb.top):.2f}]")
    print(f"  CropBox   : [{float(cb.left):.2f}, {float(cb.bottom):.2f}, {float(cb.right):.2f}, {float(cb.top):.2f}]")
    print(f"  Width pts : {width_pts:.4f}  ({width_mm:.2f} mm)")
    print(f"  Height pts: {height_pts:.4f}  ({height_mm:.2f} mm)")
    print(f"  Rotation  : {p.rotation}")
    user_unit = p.get("/UserUnit")
    print(f"  UserUnit  : {user_unit if user_unit is not None else '(absent => default 1.0)'}")
    # Anything that smells like a Measure dictionary or VP entry
    if "/VP" in p:
        print(f"  /VP       : {p['/VP']}")
    if "/Measure" in p:
        print(f"  /Measure  : {p['/Measure']}")
print("--- Doc info ---")
info = r.metadata
if info:
    for k, v in info.items():
        print(f"  {k}: {v}")
