// Visual-only models of the parts that go in/around the case, in case
// coordinates (mm, z up), for the 3D viewer. Approximate shapes.
use <camera_case_v2.scad>

what = "pi";

back_w = 112; back_d = 106; body_h = 46; wall = 3.6; floor_t = 3.2;
cam_angle = 90; cam_center_z = 25; cam_standoff_h = 9.5; cam_lens_dy = 2.0;
pi_y = -40; pi_standoff = 6;
sock_x = 22; sock_z = 22;
mount_y = 6;
half = cam_angle / 2;
nose_len = (back_w / 2) * tan(90 - half);
$fn = 36;

module face_frame(s) {
    translate([s * back_w / 4, nose_len / 2, cam_center_z])
        rotate([0, 0, s * -half]) rotate([-90, 0, 0]) children();
}

if (what == "pi_board") translate([-42.5, pi_y - 28, floor_t + pi_standoff]) cube([85, 56, 1.6]);
if (what == "pi_parts") translate([-42.5, pi_y - 28, floor_t + pi_standoff + 1.6]) {
    translate([22, 14, 0]) cube([20, 20, 2]);                 // SoC
    translate([-1, 2, 0]) cube([21, 16, 13]);                 // ethernet
    translate([-1, 20, 0]) cube([17, 14, 15]);                // USB stack
    translate([-1, 37, 0]) cube([17, 14, 15]);                // USB stack
    translate([60, -1, 0]) cube([9, 8, 3.2]);                 // USB-C power
}
if (what == "cooler") translate([-42.5 + 20, pi_y - 28 + 8, floor_t + pi_standoff + 1.6]) {
    cube([42, 42, 7]);
    translate([21, 21, 7]) cylinder(d = 30, h = 3);
}
if (what == "cam_boards") for (s = [-1, 1]) face_frame(s)
    translate([-12.5, -12 + cam_lens_dy, -wall - cam_standoff_h - 1]) cube([25, 24, 1]);
if (what == "cam_lenses") for (s = [-1, 1]) face_frame(s) {
    translate([-4.5, -4.5, -wall - cam_standoff_h]) cube([9, 9, 6]);
    translate([0, 0, -wall - cam_standoff_h + 6]) cylinder(d = 7, h = 4);
}
if (what == "glass") for (s = [-1, 1]) face_frame(s) translate([0, 0, -2]) cylinder(d = 25, h = 2);
if (what == "socket") translate([sock_x, -back_d, sock_z]) rotate([90, 0, 0]) {
    translate([0, 0, -wall - 30]) cylinder(d = 22, h = 30 + wall);   // body through the wall
    translate([0, 0, -wall - 4]) cylinder(d = 28, h = 3, $fn = 6);   // nut inside
    cylinder(d = 28, h = 3);                                          // flange outside
}
if (what == "socket_hole") translate([sock_x, -back_d - 3.05, sock_z]) rotate([90, 0, 0]) cylinder(d = 8.5, h = 0.4);
if (what == "mount") translate([0, mount_y, 0]) {
    translate([0, 0, -10]) cylinder(d = 6.35, h = 14);   // 1/4" screw
    translate([0, 0, -14]) cylinder(d = 34, h = 6);       // head plate
    translate([0, 0, -32]) sphere(d = 26);                // ball
    translate([0, 0, -58]) cylinder(d1 = 34, d2 = 26, h = 20); // base
}
