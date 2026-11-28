// ─────────────────────────────────────────────────────────────────────────
// PitchCam case v3 — v2 + built-in power bank (UGREEN PB561, 106 × 68 × 13 mm)
// The power bank lies flat on the floor; the Pi sits on a printed tray above it.
// Raspberry Pi 5 + 2 × Camera Module 3 Wide, cameras `cam_angle`° apart.
//
// Weather: tongue-and-groove lid with a gasket (TPU print or 2 mm silicone
// cord), clear lens discs sealed into outside recesses under rain visors,
// sealed USB-C panel socket for power, vents only on the UNDERSIDE (rain falls
// down, air still rises through the Pi's cooler). "Rain-resistant", not
// submersible.
//
// Wind: low and rounded (sheds wind), centre of mass right over the 1/4"
// mount, plus a tether loop so it can't fall even if the mount fails.
//
// Print in BLACK ASA (best outdoors) or PETG. 3-4 walls, 25% infill.
// NOTE: black gets hot in direct sun — see README.
//
// !! VERIFY camera hole spacing / lens position with a caliper first.
// ─────────────────────────────────────────────────────────────────────────

part = "assembly";   // "body", "lid", "tray", "assembly"

// ── Overall ─────────────────────────────────────────────────────────────
cam_angle = 90;
back_w    = 112;     // width of the rear section
back_d    = 106;     // depth of the rear section (room for the USB-C socket behind the Pi)
body_h    = 56;      // body height (lid sits on top)
wall      = 3.6;
floor_t   = 3.2;
vr        = 9;       // vertical corner radius (plan view)
er        = 3;       // edge rounding radius

// ── Lid / seal ──────────────────────────────────────────────────────────
lid_t       = 3.2;
lid_crown   = 1;      // flat top (prints face-down, no supports); the case is tilted so rain runs off
groove_w    = 2.2;    // gasket groove in the body rim
groove_d    = 2.2;    // 2 mm silicone cord sits in this
tongue_w    = 1.2;
tongue_h    = 0.8;    // presses the cord ~30% when the lid is screwed down
insert_d    = 2.6;    // pilot for M3 self-tapping screws (use 4.0 for heat-set inserts)
insert_h    = 12;

// ── Cameras (Camera Module 3 Wide) — VERIFY ─────────────────────────────
cam_hole_dx    = 21;
cam_hole_dy    = 12.5;
cam_lens_dy    = 2.0;   // lens centre above middle of hole pattern
cam_center_z   = 37.5; // above the power bank
cam_standoff_h = 9.5;   // board face → inner wall
lens_hole_d    = 17;
disc_d         = 25;    // clear acrylic/glass disc, 25 × 2 mm
disc_t         = 2;
visor_len      = 14;

// ── Power bank (UGREEN PB561) ───────────────────────────────────────────
bank_l   = 106.5;  // along y
bank_w   = 69;     // along x
bank_t   = 13.5;
bank_lift = 6.5;   // rails/pad height under the bank (room for the nut trap)
bank_y0  = -102.2; // rear end of the bank (just in front of the rear wall)
bank_top = 3.2 + bank_lift + bank_t;   // floor_t + lift + thickness

// ── Pi tray (separate print) ────────────────────────────────────────────
tray_t     = 2.5;
tray_post  = [[-44, -62], [44, -62], [-44, -18], [44, -18]];
tray_z     = bank_top + 2;              // underside of the tray

// ── Pi 5 ────────────────────────────────────────────────────────────────
pi_hole_dx = 58;
pi_hole_dy = 49;
pi_standoff = 4;      // on the tray
pi_y        = -40;

// ── Mounting ────────────────────────────────────────────────────────────
nut_af   = 11.2;   // 1/4"-20 hex nut
nut_h    = 5.6;
bolt_d   = 6.8;
mount_y  = -45;    // under the bank / centre of mass
sock_d   = 22.6;   // waterproof USB-C panel socket (22 mm thread, 28 mm flange/nut)
sock_x   = 22;     // off-centre so it clears the tether loop
sock_z   = 40;     // above the power bank
$fn = 40;

half     = cam_angle / 2;
nose_len = (back_w / 2) * tan(90 - half);

module plan(inset = 0) {
    offset(r = vr - inset) offset(delta = -vr)
        polygon([[-back_w/2, -back_d], [back_w/2, -back_d], [back_w/2, 0], [0, nose_len], [-back_w/2, 0]]);
}
module rim_path(w) { difference() { plan(wall/2 - w/2); plan(wall/2 + w/2); } }

// Camera frame: origin at face midpoint on the OUTER surface, z = outward.
module on_face(s) {
    translate([s * back_w / 4, nose_len / 2, cam_center_z])
        rotate([0, 0, s * -half]) rotate([-90, 0, 0])
            translate([0, 0, 0]) children();
}
// The outer surface sits `vr`-rounded; at the face middle it's the plan edge.
module at_outer(s) { on_face(s) children(); }
module at_inner(s) { on_face(s) translate([0, 0, -wall]) children(); }

module rounded_block(h) {
    // plan shape extruded with rounded top/bottom edges
    hull() {
        translate([0, 0, er]) linear_extrude(h - 2 * er) plan();
        linear_extrude(h) plan(er);
    }
}

module lid_screw_xy() {
    for (p = [[-(back_w/2 - 9), -back_d + 9], [back_w/2 - 9, -back_d + 9],
              [-(back_w/2 - 9), -8], [back_w/2 - 9, -8]])
        translate(p) children();
}

module body() {
    difference() {
        union() {
            difference() {
                rounded_block(body_h);
                translate([0, 0, floor_t]) linear_extrude(body_h) plan(wall);
            }
            // camera standoffs
            for (s = [-1, 1]) at_inner(s)
                for (x = [-1, 1], y = [-1, 1])
                    translate([x * cam_hole_dx/2, y * cam_hole_dy/2 + cam_lens_dy  /* local +y = down */, -cam_standoff_h])
                        cylinder(d = 5, h = cam_standoff_h + 0.6);
            // rain visors over each lens
            // (in this frame local +y points DOWN, so the visor sits at -y)
            for (s = [-1, 1]) at_outer(s)
                hull() {
                    translate([-disc_d/2 - 4, -disc_d/2 - 4.5, -1]) cube([disc_d + 8, 2.6, 1]);
                    translate([-disc_d/2 - 1, -disc_d/2 - 2, visor_len]) cube([disc_d + 2, 1.6, 0.6]);
                }
            // posts that carry the Pi tray above the power bank
            for (p = tray_post) translate(p) cylinder(d = 7, h = tray_z);
            // power bank bed: two rails + a pad over the nut trap
            for (x = [-1, 1]) translate([x * (bank_w/2 - 8) - 2, bank_y0 + 4, 0]) cube([4, bank_l - 8, floor_t + bank_lift]);
            translate([-13, mount_y - 13, 0]) cube([26, 26, floor_t + bank_lift]);
            // low fences so the bank can't slide (sides + front stop)
            for (x = [-1, 1]) translate([x * (bank_w/2 + 1) - 1, bank_y0 + 10, 0]) cube([2, bank_l - 20, floor_t + bank_lift + 6]);
            translate([-bank_w/2 + 6, bank_y0 + bank_l + 0.5, 0]) cube([bank_w - 12, 2, floor_t + bank_lift + 6]);
            // lid screw bosses
            lid_screw_xy() cylinder(d = 9, h = body_h);
            // rain baffles over the vents (either side of the bank): hoods
            // open only at their ends, so splashes can't fly straight in
            for (x = [-1, 1]) translate([x * 44, pi_y, floor_t]) difference() {
                translate([-6, -13, 0]) cube([12, 26, 4.5]);
                translate([-4.5, -15, -0.01]) cube([9, 30, 3]);
            }
            // tether loop at the rear
            translate([0, -back_d + 1, 8]) rotate([90, 0, 0])
                difference() { cylinder(d = 14, h = 6); translate([0, 0, -1]) cylinder(d = 7, h = 8); }
        }
        // lens: through hole + outside recess for the clear disc
        for (s = [-1, 1]) at_outer(s) {
            translate([0, 0, -wall - 1]) cylinder(d = lens_hole_d, h = wall + 2);
            translate([0, 0, -disc_t]) cylinder(d = disc_d + 0.4, h = disc_t + 5);
        }
        // camera screw pilots (M2)
        for (s = [-1, 1]) at_inner(s)
            for (x = [-1, 1], y = [-1, 1])
                translate([x * cam_hole_dx/2, y * cam_hole_dy/2 + cam_lens_dy  /* local +y = down */, -cam_standoff_h - 1])
                    cylinder(d = 1.8, h = cam_standoff_h);
        // tray screw pilots (M2.5)
        for (p = tray_post) translate([p[0], p[1], tray_z - 8]) cylinder(d = 2.2, h = 9);
        // gasket groove in the rim
        translate([0, 0, body_h - groove_d]) linear_extrude(groove_d + 1) rim_path(groove_w);
        // lid inserts
        lid_screw_xy() translate([0, 0, body_h - insert_h]) cylinder(d = insert_d, h = insert_h + 1);
        // 1/4"-20 nut trap in the pad: slide the nut in from the side
        // (before the bank goes in); the bolt comes up through the floor
        translate([0, mount_y, -1]) cylinder(d = bolt_d, h = floor_t + bank_lift + 2);
        translate([0, mount_y, floor_t + 0.4]) {
            rotate([0, 0, 30]) cylinder(d = nut_af / cos(30), h = nut_h + 0.2, $fn = 6);
            translate([0, -nut_af/2, 0]) cube([20, nut_af, nut_h + 0.2]);
        }
        // underside vents beside the bank, under the baffles
        for (x = [-1, 1], i = [-0.5, 0.5]) translate([x * 44 + i * 5 - 1, pi_y - 10, -1]) cube([2, 20, floor_t + 2]);
        // waterproof USB-C panel socket in the rear wall
        translate([sock_x, -back_d + wall + 1, sock_z]) rotate([90, 0, 0]) cylinder(d = sock_d, h = wall + 4);
    }
}

module lid() {
    difference() {
        union() {
            // flat top with a chamfered edge
            hull() {
                linear_extrude(0.01) plan();
                translate([0, 0, lid_t + lid_crown - 0.01]) linear_extrude(0.01) plan(er);
            }
            // tongue that presses into the gasket
            translate([0, 0, -tongue_h]) linear_extrude(tongue_h + 0.01) rim_path(tongue_w);
        }
        // countersunk M3 screw holes
        lid_screw_xy() {
            translate([0, 0, -5]) cylinder(d = 3.4, h = 20);
            translate([0, 0, lid_t + lid_crown - 3.5]) cylinder(d1 = 3.4, d2 = 7, h = 2.2);
            translate([0, 0, lid_t + lid_crown - 1.31]) cylinder(d = 7, h = 10);
        }
    }
}

module tray() {
    difference() {
        union() {
            translate([-49, pi_y - 27, 0]) cube([98, 54, tray_t]);
            for (x = [-1, 1], y = [-1, 1])
                translate([x * pi_hole_dx/2, pi_y + y * pi_hole_dy/2, 0]) cylinder(d = 6, h = tray_t + pi_standoff);
        }
        for (p = tray_post) translate([p[0], p[1], -1]) cylinder(d = 2.9, h = 10);          // M2.5 to the posts
        for (x = [-1, 1], y = [-1, 1])
            translate([x * pi_hole_dx/2, pi_y + y * pi_hole_dy/2, 1]) cylinder(d = 2.2, h = 10); // M2.5 Pi screws
        // airflow slots
        for (i = [-2:2]) translate([i * 9 - 2, pi_y - 15, -1]) cube([4, 30, 5]);
    }
}

module gasket() {
    // print in TPU (or use 2 mm silicone cord in the groove instead)
    linear_extrude(groove_d + 0.6) rim_path(groove_w - 0.3);
}

if (part == "body") body();
if (part == "lid") lid();
if (part == "gasket") gasket();
if (part == "tray") tray();
if (part == "assembly") {
    color("#1b1d22") body();
    color("#24272e") translate([0, 0, body_h + tongue_h + 0.01]) lid();
    color("#3a3f47") translate([0, 0, tray_z]) tray();
    color("#2a3a55", 0.6) translate([-bank_w/2, bank_y0, floor_t + bank_lift]) cube([bank_w, bank_l, bank_t]);
}
