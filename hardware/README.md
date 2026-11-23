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

## v2 — weather-resistant case (`camera_case_v2.*`)

Black, low-profile, rounded. About 112 × 131 × 55 mm with the lid.

Print: `PitchCam_case_body_and_lid.stl` (one file) in **black ASA** (best outdoors) or PETG.
Seal: press **2 mm silicone cord** into the lid groove.

Extra parts (~€15–25):
- 2 × clear acrylic or glass disc, **25 mm × 2 mm** — glue into the outside lens recesses with clear silicone
- 1 × **PG7 cable gland** (power cable enters through it, then a drip loop below)
- 4 × **M3 × 12 mm countersunk self-tapping** screws for the lid (no inserts needed)
- 8 × M2 (cameras), 4 × M2.5 (Pi), 1 × 1/4"-20 hex nut
- A cord or small carabiner through the rear **tether loop** to the pole

Weather: rain-resistant (gasketed lid, sealed windows, visors, underside vents), not submersible.

**Heat:** black absorbs sun. Vents are underneath and the Pi has its fan, but on hot summer
days test it in the sun first and watch the temperature on the control page; if it throttles,
print in light grey/white or add a sun-shade plate over the lid.
