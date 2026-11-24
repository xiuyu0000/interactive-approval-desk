#!/usr/bin/env python3
"""
Zero-dependency geometric self-test of the reference coordinates in
references/svg-layout-and-visual-patterns.md (Pattern A: three columns, two corridors,
straight horizontal tracks with label pills, a top banner and a bottom return bus).

It does NOT read a page: the template draws its SVG in the browser, so real pages are
checked by round_template/test.js, which runs the page's own window.__check() in every view.
Run this after changing the reference numbers, or adapt LAYOUT to sanity-check a hand-planned
viewAll() before building.

Checks (the same four kinds as window.__check):
1. pill  ↔ node   — a label pill overlaps an entity box (4px padding)
2. pill  ↔ pill   — two label pills overlap (6px padding)
3. track → node   — a track passes through the interior of an entity box
4. track → pill   — a track passes through the interior of another track's pill

Usage:
  python3 verify_svg_collisions.py
"""

PILL_H = 23

# Reference layout (references/svg-layout-and-visual-patterns.md, sections 1–2)
NODES = [  # (id, x, y, w, h)
    ("O1_TOP", 45, 18, 1110, 68),
    ("O8", 45, 114, 230, 80),
    ("O3", 45, 214, 230, 84),
    ("O2", 45, 316, 230, 84),
    ("O4", 45, 418, 230, 82),
    ("O5", 465, 114, 270, 140),
    ("O6", 465, 270, 270, 230),
    ("O9", 925, 114, 230, 92),
    ("O7", 925, 224, 230, 146),
    ("EXT", 925, 388, 230, 112),
]
TRACKS = [  # (label, x1, x2, y, pill_width): straight horizontal edge with a pill at its midpoint
    ("Track 1L", 275, 465, 226, 150),
    ("Track 2L", 275, 465, 284, 150),
    ("Track 3L", 275, 465, 358, 156),
    ("Track 4L", 275, 465, 456, 154),
    ("Track 1R", 735, 925, 158, 154),
    ("Track 2R", 735, 925, 236, 152),
    ("Track 3R", 735, 925, 315, 156),
    ("Track 4R", 735, 925, 444, 154),
    ("Bottom Return Bus", 45, 1155, 540, 540),
]


def boxes_overlap(b1, b2, pad=4):
    """True if boxes (x1, y1, x2, y2) come closer than pad pixels."""
    return not (b1[2] + pad <= b2[0] or b2[2] + pad <= b1[0] or b1[3] + pad <= b2[1] or b2[3] + pad <= b1[1])


def pill_box(track):
    label, x1, x2, y, w = track
    cx = (x1 + x2) / 2
    return (cx - w / 2, y - PILL_H / 2, cx + w / 2, y + PILL_H / 2)


def hseg_crosses_interior(x1, x2, y, box, inset=1):
    """True if the horizontal segment y, x1..x2 runs through the inside of box (edges excluded)."""
    bx1, by1, bx2, by2 = box
    if not (by1 + inset < y < by2 - inset):
        return False
    return min(x1, x2) < bx2 - inset and max(x1, x2) > bx1 + inset


def verify(nodes=NODES, tracks=TRACKS, pad_node=4, pad_pill=6):
    errors = []
    nboxes = [(nid, (x, y, x + w, y + h)) for nid, x, y, w, h in nodes]
    pills = [(t[0], pill_box(t)) for t in tracks]
    for i, (pl, pb) in enumerate(pills):
        for nid, nb in nboxes:
            if boxes_overlap(pb, nb, pad_node):
                errors.append(f"[PILL-NODE] pill '{pl}' overlaps node '{nid}'")
        for pl2, pb2 in pills[i + 1:]:
            if boxes_overlap(pb, pb2, pad_pill):
                errors.append(f"[PILL-PILL] pill '{pl}' overlaps pill '{pl2}'")
    for label, x1, x2, y, _w in tracks:
        for nid, nb in nboxes:
            if hseg_crosses_interior(x1, x2, y, nb):
                errors.append(f"[TRACK-NODE] track '{label}' (y={y}) runs through node '{nid}'")
        for pl, pb in pills:
            if pl != label and hseg_crosses_interior(x1, x2, y, pb):
                errors.append(f"[TRACK-PILL] track '{label}' (y={y}) runs through pill '{pl}'")
    return errors


if __name__ == "__main__":
    errs = verify()
    if errs:
        print("\n".join(errs))
        raise SystemExit(1)
    print(f"OK: {len(NODES)} nodes, {len(TRACKS)} tracks — 0 pill-node, pill-pill, track-node or track-pill collisions.")
