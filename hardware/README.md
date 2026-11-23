# Dual-camera case (prototype)

Arrow-shaped, 3D-printable case for a Raspberry Pi 5 + 2 × Camera Module 3 Wide.
The nose points at the pitch; each camera sits behind one angled face, 90° apart
(≈10° overlap). Tilt the whole case down on the pole/tripod head.

Files: `camera_case.scad` (editable, OpenSCAD), `camera_case_body.stl`, `camera_case_lid.stl`.

Before printing:
- **Verify** the Camera Module 3 hole spacing and lens position in the `.scad`
  against the official drawing or with a caliper.
- Print in **PETG or ASA** (PLA softens in the sun). 3 walls, 20% infill.

Hardware: 8 × M2 self-tapping screws (cameras), 4 × M2.5 (Pi), 2 × M3 (lid),
1 × 1/4"-20 hex nut (pressed into the floor, fits standard tripod/pole heads).
