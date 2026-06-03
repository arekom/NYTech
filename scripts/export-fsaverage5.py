"""Export fsaverage5 inflated cortical surface to a compact binary asset
for the Confirmation-screen BrainCanvas component.

This script runs ONCE — its output is committed to the repo at
`public/brain/fsaverage5.bin` and the JS side fetches it at page load.
fsaverage5 is a static FreeSurfer template that hasn't changed in years,
so there's no maintenance cadence.

─── How to run ───────────────────────────────────────────────────────────
  pip install nilearn numpy
  python scripts/export-fsaverage5.py

  # On Windows PowerShell:
  py -m pip install nilearn numpy
  py scripts/export-fsaverage5.py

First run downloads ~50 MB of nilearn template data to a user cache
(~/nilearn_data). Subsequent runs are instant. PyTorch / transformers /
the rest of the brain-service stack are NOT required — this script only
needs nilearn for the mesh fetch.

─── Output format (little-endian) ────────────────────────────────────────
  Header (24 bytes):
    uint32 magic     = 0x534F4D42  ("SOMB")
    uint32 version   = 1
    uint32 lh_vert_count
    uint32 rh_vert_count
    uint32 lh_face_count
    uint32 rh_face_count

  LH block:
    vertices  lh_vert_count * 3 * float32   (xyz, inflated coordinates)
    sulc      lh_vert_count * float32       (sulcal depth, for shading)
    faces     lh_face_count * 3 * uint16    (triangle vertex indices)

  RH block: same shape as LH.

Total size: ~570 KB raw, ~170-220 KB gzipped (Vercel auto-gzips static
assets, so the over-the-wire cost is the gzipped size).

The frontend reads this with one fetch + Uint8Array view + a handful of
typed-array views (Uint32Array for header, Float32Array for verts/sulc,
Uint16Array for faces). No JSON parsing, no zlib decompression in JS.
"""
from __future__ import annotations

import struct
import sys
from pathlib import Path

import numpy as np
from nilearn import datasets, surface

MAGIC = 0x534F4D42  # "SOMB"
VERSION = 1


def _load_surface_data():
    """Fetch fsaverage5 and return (lh_verts, lh_faces, lh_sulc, rh_verts, rh_faces, rh_sulc)."""
    print("Fetching fsaverage5 from nilearn ...", file=sys.stderr)
    fsavg = datasets.fetch_surf_fsaverage("fsaverage5")

    # Use the PIAL surface (the actual cortical fold geometry) — matches
    # the Meta TRIBE v2 demo look: visible gyri and sulci with activation
    # overlaid as a hot heatmap. Pial coords are in shared MNI-like space
    # so LH and RH are already anatomically positioned (LH at negative X,
    # RH at positive X) without needing manual per-hemisphere offsets.
    lh_verts, lh_faces = surface.load_surf_mesh(fsavg["pial_left"])
    rh_verts, rh_faces = surface.load_surf_mesh(fsavg["pial_right"])

    # Sulcal depth (per-vertex scalar). render.py uses this as bg_map to
    # tint folds darker, which gives the brain its recognizable texture.
    # We ship it so the canvas can do the same in its shader.
    lh_sulc = surface.load_surf_data(fsavg["sulc_left"]).astype(np.float32)
    rh_sulc = surface.load_surf_data(fsavg["sulc_right"]).astype(np.float32)

    return lh_verts, lh_faces, lh_sulc, rh_verts, rh_faces, rh_sulc


def _validate(lh_verts, lh_faces, lh_sulc, rh_verts, rh_faces, rh_sulc):
    """Cheap sanity checks so we don't ship corrupt data."""
    assert lh_verts.shape[1] == 3, f"LH verts not (N, 3): {lh_verts.shape}"
    assert rh_verts.shape[1] == 3, f"RH verts not (N, 3): {rh_verts.shape}"
    assert lh_faces.shape[1] == 3, f"LH faces not (N, 3): {lh_faces.shape}"
    assert rh_faces.shape[1] == 3, f"RH faces not (N, 3): {rh_faces.shape}"
    assert lh_sulc.shape[0] == lh_verts.shape[0], "LH sulc count mismatch"
    assert rh_sulc.shape[0] == rh_verts.shape[0], "RH sulc count mismatch"

    # Faces are vertex indices — must fit in uint16 (max 65535) for our format.
    # fsaverage5 has ~10242 verts per hemisphere so we're well under.
    assert int(lh_faces.max()) < 65536, f"LH face indices > uint16: {lh_faces.max()}"
    assert int(rh_faces.max()) < 65536, f"RH face indices > uint16: {rh_faces.max()}"


def _pack(lh_verts, lh_faces, lh_sulc, rh_verts, rh_faces, rh_sulc) -> bytes:
    header = struct.pack(
        "<IIIIII",
        MAGIC,
        VERSION,
        lh_verts.shape[0],
        rh_verts.shape[0],
        lh_faces.shape[0],
        rh_faces.shape[0],
    )

    # Force little-endian and the exact dtype the frontend will read.
    lh_v = np.ascontiguousarray(lh_verts, dtype="<f4")
    lh_s = np.ascontiguousarray(lh_sulc, dtype="<f4")
    lh_f = np.ascontiguousarray(lh_faces, dtype="<u2")

    rh_v = np.ascontiguousarray(rh_verts, dtype="<f4")
    rh_s = np.ascontiguousarray(rh_sulc, dtype="<f4")
    rh_f = np.ascontiguousarray(rh_faces, dtype="<u2")

    return (
        header
        + lh_v.tobytes()
        + lh_s.tobytes()
        + lh_f.tobytes()
        + rh_v.tobytes()
        + rh_s.tobytes()
        + rh_f.tobytes()
    )


def main():
    repo_root = Path(__file__).resolve().parent.parent
    out_path = repo_root / "public" / "brain" / "fsaverage5.bin"
    out_path.parent.mkdir(parents=True, exist_ok=True)

    lh_v, lh_f, lh_s, rh_v, rh_f, rh_s = _load_surface_data()
    _validate(lh_v, lh_f, lh_s, rh_v, rh_f, rh_s)

    packed = _pack(lh_v, lh_f, lh_s, rh_v, rh_f, rh_s)
    out_path.write_bytes(packed)

    print(
        f"Wrote {len(packed):,} bytes ({len(packed) / 1024:.1f} KB) to {out_path}",
        file=sys.stderr,
    )
    print(
        f"  LH: {lh_v.shape[0]:,} verts, {lh_f.shape[0]:,} faces",
        file=sys.stderr,
    )
    print(
        f"  RH: {rh_v.shape[0]:,} verts, {rh_f.shape[0]:,} faces",
        file=sys.stderr,
    )


if __name__ == "__main__":
    main()
