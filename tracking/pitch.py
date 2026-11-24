"""Calibration for one fixed, rectilinear camera view."""
import cv2
import numpy as np


def line_segments(image):
    # Bright, low-saturation paint. The segment overlay is for human review.
    hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)
    mask = cv2.inRange(hsv, (0, 0, 150), (179, 85, 255))
    edges = cv2.Canny(mask, 50, 150)
    minimum = max(20, image.shape[1] // 22)
    lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=minimum // 2,
                            minLineLength=minimum, maxLineGap=minimum // 5)
    return [] if lines is None else lines.reshape(-1, 4).tolist()


class Pitch:
    def __init__(self, config, size):
        if list(size) != config["image_size"]:
            raise ValueError("Calibration image_size differs from the recording")
        self.length, self.width = config["pitch_size_m"]
        self.goal_width = config["goal_width_m"]
        if not (0 < self.length < 150 and 0 < self.goal_width < self.width < 120):
            raise ValueError("Check the measured pitch and goal sizes")
        self.attack = config["us_attacks"]
        if self.attack not in ("x0", "xmax"):
            raise ValueError("Set us_attacks to x0 or xmax for this clip")
        rows = np.asarray(config["anchors"], dtype=float)
        check = np.asarray(config["checks"], dtype=float)
        for data, minimum in ((rows, 4), (check, 1)):
            if data.ndim != 2 or data.shape[1] != 4 or len(data) < minimum:
                raise ValueError("Supply four or more anchors and at least one separate check point")
            if not np.isfinite(data).all() or (data < 0).any() or (
                data > [size[0]-1, size[1]-1, self.length, self.width]
            ).any():
                raise ValueError("Landmark coordinates are outside the image or pitch")
        all_points = np.vstack([rows, check])
        for cols in (all_points[:, :2], all_points[:, 2:]):
            if len(np.unique(cols, axis=0)) != len(cols):
                raise ValueError("Each anchor and check must be a different landmark")
        self.hull = cv2.convexHull(rows[:, :2].astype("float32"))
        if cv2.contourArea(self.hull) < 0.01 * size[0] * size[1]:
            raise ValueError("Spread the anchors across the playing area in this view")
        self.matrix, _ = cv2.findHomography(rows[:, :2], rows[:, 2:], method=0)
        if self.matrix is None or not np.isfinite(self.matrix).all() or np.linalg.matrix_rank(self.matrix) < 3:
            raise ValueError("Degenerate calibration landmarks")
        # The image of the ground plane must stay finite throughout the anchor hull.
        denominators = rows[:, :2] @ self.matrix[2, :2] + self.matrix[2, 2]
        if denominators.min() <= 0 <= denominators.max():
            raise ValueError("Inconsistent landmark order puts the horizon inside the calibrated area")
        self.error = max(float(np.linalg.norm(self.project(row[:2]) - row[2:])) for row in all_points)
        if not np.isfinite(self.error) or self.error > 1.5:
            raise ValueError(f"Landmark error {self.error:.2f} m exceeds 1.5 m")

    def project(self, xy):
        x, y, w = self.matrix @ [*xy, 1]
        if abs(w) < 1e-10:
            raise ValueError("Unstable pitch projection")
        return np.array([x/w, y/w])

    def locate(self, box, size, *, ball=False):
        values = np.asarray(box, dtype=float)
        if values.shape != (4,) or not np.isfinite(values).all():
            return None
        top, left, bottom, right = values
        if not (0 <= top < bottom <= 1000 and 0 <= left < right <= 1000):
            return None
        x = (left + right) / 2000 * (size[0] - 1)
        y = ((top + bottom) / 2 if ball else bottom) / 1000 * (size[1] - 1)
        if cv2.pointPolygonTest(self.hull, (x, y), False) < 0:
            return None
        return self.project((x, y)).tolist()
