// ─────────────────────────────────────────────────────────────────────────
// Dual-camera "arrow" case — Raspberry Pi 5 + 2 × Camera Module 3 Wide
//
// Top view: the pointed nose faces the pitch. Each camera sits behind one
// angled front face, so the two cameras look out left-forward and
// right-forward, `cam_angle` degrees apart (90° ≈ 10° overlap with the
// Module 3 Wide's ~102° horizontal view). The Pi 5 sits in the back.
//
// Tilt is NOT built in: both cameras are level in the case, and the whole
// case tilts down on the tripod/pole head, so one adjustment aims both.
//
// Print: body upside-down is NOT needed — print as modelled (open top),
// lid flat. PETG or ASA for outdoor use (PLA softens in summer sun).
//
// !! VERIFY before printing: camera hole spacing and lens position below
//    against the official Camera Module 3 drawing or with a caliper.
// ─────────────────────────────────────────────────────────────────────────

part = "both";          // "body", "lid" or "both"

// ── Main dimensions (mm) ────────────────────────────────────────────────
cam_angle   = 90;       // angle between the two cameras' viewing directions
back_w      = 104;      // outer width of the rear (Pi) section
back_d      = 72;       // depth of the rear section
height      = 44;       // outer height of the body (without lid)
wall        = 2.6;
floor_t     = 2.6;
lid_t       = 2.4;
corner_r    = 4;

// ── Camera Module 3 (Wide) — VERIFY ─────────────────────────────────────
cam_hole_dx     = 21;     // horizontal spacing of mounting holes
cam_hole_dy     = 12.5;   // vertical spacing of mounting holes
cam_lens_dy     = 2.0;    // lens centre above the middle of the hole pattern
cam_window_d    = 16;     // lens window (generous on purpose)
cam_standoff_h  = 8.5;    // board-to-wall distance so the lens sits just behind the window
cam_screw_d     = 1.8;    // M2 self-tapping pilot
cam_center_z    = 24;     // camera centre height above the floor bottom

// ── Raspberry Pi 5 ──────────────────────────────────────────────────────
pi_hole_dx  = 58;
pi_hole_dy  = 49;
pi_standoff = 5;
pi_screw_d  = 2.2;        // M2.5 self-tapping pilot
pi_y        = -38;        // centre of the Pi hole pattern (rear section)

// ── Mount: captive 1/4"-20 nut in the floor (fits any tripod/pole head) ─
nut_af      = 11.2;       // across flats + clearance
nut_h       = 5.6;
bolt_d      = 6.8;
mount_y     = 8;         // under the cameras, clear of the Pi

$fn = 48;
half = cam_angle / 2;
// Front faces point at ±half from straight ahead, so they run at (90-half)
// to the rear section's front edge: the nose length follows from the width.
nose_len = (back_w / 2) * tan(90 - half) ;

module outline(inset = 0) {
    offset(r = corner_r - inset) offset(delta = -corner_r)
    polygon([
        [-back_w/2, -back_d],
        [ back_w/2, -back_d],
        [ back_w/2, 0],
        [ 0, nose_len],
        [-back_w/2, 0],
    ]);
}

// Position on a front face: s = +1 right face, -1 left face.
module on_face(s) {
    // midpoint of the face, on its inner surface, facing outward
    mx = s * back_w / 4;
    my = nose_len / 2;
    translate([mx, my, cam_center_z])
        rotate([0, 0, s * -half])      // outward direction for this face
            rotate([-90, 0, 0])        // local z = outward normal
                children();
}

// Distance from outline edge to the inner surface along the face normal
face_in = wall;

module body() {
    difference() {
        union() {
            // shell
            difference() {
                linear_extrude(height) outline();
                translate([0, 0, floor_t]) linear_extrude(height) outline(wall);
            }
            // camera standoffs (inside each front face)
            for (s = [-1, 1]) on_face(s)
                for (x = [-1, 1], y = [-1, 1])
                    translate([x * cam_hole_dx/2, y * cam_hole_dy/2 - cam_lens_dy, -face_in - cam_standoff_h])
                        cylinder(d = 4.6, h = cam_standoff_h + 0.5);
            // Pi standoffs
            for (x = [-1, 1], y = [-1, 1])
                translate([x * pi_hole_dx/2, pi_y + y * pi_hole_dy/2, 0])
                    cylinder(d = 6, h = floor_t + pi_standoff);
            // lid screw bosses in the rear corners
            for (x = [-1, 1])
                translate([x * (back_w/2 - wall - 3), -back_d + wall + 3, 0])
                    cylinder(d = 7, h = height);
            // nut boss
            translate([0, mount_y, 0]) cylinder(d = nut_af + 6, h = floor_t + nut_h + 1.5);
        }
        // lens windows through each face
        for (s = [-1, 1]) on_face(s)
            translate([0, 0, -face_in - 1]) cylinder(d = cam_window_d, h = wall + 3);
        // camera screw pilots
        for (s = [-1, 1]) on_face(s)
            for (x = [-1, 1], y = [-1, 1])
                translate([x * cam_hole_dx/2, y * cam_hole_dy/2 - cam_lens_dy, -face_in - cam_standoff_h - 1])
                    cylinder(d = cam_screw_d, h = cam_standoff_h);
        // Pi screw pilots
        for (x = [-1, 1], y = [-1, 1])
            translate([x * pi_hole_dx/2, pi_y + y * pi_hole_dy/2, 1.2])
                cylinder(d = pi_screw_d, h = floor_t + pi_standoff);
        // lid screw pilots (M3 self-tap)
        for (x = [-1, 1])
            translate([x * (back_w/2 - wall - 3), -back_d + wall + 3, height - 10])
                cylinder(d = 2.6, h = 11);
        // 1/4"-20 captive nut + bolt hole (from below)
        translate([0, mount_y, -1]) cylinder(d = bolt_d, h = 10);
        translate([0, mount_y, floor_t]) cylinder(d = nut_af / cos(30), h = nut_h + 0.1, $fn = 6);
        // rear wall: USB-C power + USB (SSD) cable slot
        translate([-20, -back_d - 1, floor_t + pi_standoff]) cube([40, wall + 2, 14]);
        // side vents (rear section)
        for (s = [-1, 1], i = [0:5])
            translate([s * (back_w/2) - (s > 0 ? wall + 1 : -1) - (s > 0 ? 0 : wall + 1), -back_d + 14 + i * 8, floor_t + 10])
                cube([wall + 2, 4, height - floor_t - 18]);
    }
}

module lid() {
    difference() {
        union() {
            linear_extrude(lid_t) outline();
            // locating lip
            translate([0, 0, -2]) linear_extrude(2) difference() { outline(wall + 0.3); outline(wall + 1.8); }
        }
        for (x = [-1, 1])
            translate([x * (back_w/2 - wall - 3), -back_d + wall + 3, -3]) cylinder(d = 3.4, h = 10);
        // vent slots over the Pi
        for (i = [0:4]) translate([-25, pi_y - 20 + i * 9, -3]) cube([50, 3.5, 10]);
    }
}

if (part == "body" || part == "both") body();
if (part == "lid")  lid();
if (part == "both") translate([0, 0, height + 20]) lid();
