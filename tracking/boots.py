"""Flag ball candidates at feet which lack a recent free-ball observation."""
from math import dist, isfinite


class BootCheck:
    def __init__(self, size):
        # Express both axes in units of one thousandth of the image height.
        self.aspect = size[0] / size[1]
        self.last_clear = None

    def possible_boot(self, time, ball, people):
        if not self.valid_box(ball):
            return False
        top, left, bottom, right = ball
        center = ((left + right) / 2 * self.aspect, (top + bottom) / 2)
        radius = max(bottom - top, (right - left) * self.aspect) / 2

        nearby_height = 0
        for person in people:
            box = person["box"]
            if not self.valid_box(box):
                continue
            pt, pl, pb, pr = box
            height = pb - pt
            # A swinging boot can extend beyond a torso-centred detection box.
            margin = radius + 0.15 * height
            if (pl * self.aspect - margin <= center[0] <= pr * self.aspect + margin
                    and pb - 0.35 * height - radius <= center[1] <= pb + radius):
                nearby_height = max(nearby_height, height)

        if nearby_height:
            if self.last_clear is not None:
                last_time, last_center = self.last_clear
                dt = time - last_time
                # A recent ball moving into a player's feet can explain a touch.
                if 0 < dt <= 0.30 and dist(center, last_center) <= 2 * radius + 5 * nearby_height * dt:
                    return False
            return True

        self.last_clear = time, center
        return False

    @staticmethod
    def valid_box(box):
        return (isinstance(box, (tuple, list)) and len(box) == 4
                and all(isinstance(v, (int, float)) and isfinite(v) for v in box)
                and box[0] < box[2] and box[1] < box[3])
