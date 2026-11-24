"""Conservative short tracks and review candidates on a calibrated pitch."""
from math import dist

from scipy.optimize import linear_sum_assignment

TEAMS = ("us", "them")
MAX_GAP = 0.40  # seconds between observations


class Tracks:
    def __init__(self):
        self.active = {}
        self.next_id = 1

    def update(self, people, t):
        self.active = {i: p for i, p in self.active.items() if t - p["time"] <= MAX_GAP}
        ids = list(self.active)
        assigned = {}
        if people and ids:
            costs = []
            for i in ids:
                prev = self.active[i]
                dt = t - prev["time"]
                row = []
                for p in people:
                    distance = dist(prev["xy"], p["xy"])
                    compatible = p["team"] == prev["team"] or "unknown" in (p["team"], prev["team"])
                    row.append(distance if compatible and distance <= 0.7 + 10 * dt else 1e5)
                costs.append(row)
            # Unmatched tracks/detections are allowed. Ambiguous crossings get new IDs.
            for r, c in zip(*linear_sum_assignment(costs)):
                cost = costs[r][c]
                if cost >= 1e5:
                    continue
                rivals = costs[r][:c] + costs[r][c+1:] + [row[c] for j, row in enumerate(costs) if j != r]
                if any(other <= cost + 0.4 for other in rivals):
                    continue
                assigned[c] = ids[r]
        for index, p in enumerate(people):
            if index in assigned:
                track_id = assigned[index]
            else:
                track_id = self.next_id
                self.next_id += 1
            p["id"] = track_id
            self.active[track_id] = dict(p, time=t)
        return people


def nearby(ball, people):
    """Return a kit-labelled player, 'loose', or None (unobservable/contested)."""
    if ball is None or not people:
        return None
    ranked = sorted((dist(ball, p["xy"]), i) for i, p in enumerate(people))
    d, i = ranked[0]
    if d > 2:
        return "loose"
    if len(ranked) > 1 and ranked[1][0] - d < 0.65:
        return None
    return people[i] if people[i]["team"] in TEAMS else None


class Events:
    def __init__(self, pitch):
        self.pitch = pitch
        self.seconds = dict(us=0.0, them=0.0, unknown=0.0)
        self.events = []
        self.previous_time = None
        self.previous_ball = None
        self.ball_track = 0
        self.last_near = None
        self.source = None
        self.released = False

    def observe(self, t, ball, players):
        dt = 0 if self.previous_time is None else t - self.previous_time
        if self.previous_time is not None and dt <= 0:
            raise ValueError("Observation times must increase")
        gap = dt > MAX_GAP
        jump = (ball is not None and self.previous_ball is not None and
                dist(ball, self.previous_ball) > 1.5 + 40 * dt)
        if ball is not None and (self.previous_ball is None or gap or jump):
            self.ball_track += 1
        near = nearby(ball, players)
        if gap or jump or near is None:
            self.source = self.last_near = None
            self.released = False
        if jump:
            near = None
        owner = None
        if isinstance(near, dict):
            if near["id"] == self.last_near:
                owner = near
            self.last_near = near["id"]
        else:
            self.last_near = None

        self.seconds[owner["team"] if owner else "unknown"] += dt
        if self.source and t - self.source["time"] > 2.5:
            self.source = None
        if owner:
            if (self.source and self.released and self.source["id"] != owner["id"] and
                self.source["team"] == owner["team"] and dist(ball, self.source["xy"]) >= 3):
                self.emit("pass_candidate", t, receiver=owner["id"])
            self.source = dict(id=owner["id"], team=owner["team"], xy=ball, time=t)
            self.released = False
        elif self.source and isinstance(near, dict) and near["team"] != self.source["team"]:
            self.source = None
        elif self.source and near == "loose":
            self.released = True
            # A fast release whose observed segment reaches the goal area aimed
            # through the measured mouth. An airborne cross can look similar.
            x, y = ball
            sx, sy = self.source["xy"]
            attacks_right = (self.pitch.attack == "xmax") == (self.source["team"] == "us")
            goal_x = self.pitch.length if attacks_right else 0
            dx = x - sx
            if dx * (1 if attacks_right else -1) >= 3 and abs(goal_x - x) <= 3:
                goal_y = sy + (goal_x - sx) * (y - sy) / dx
                if abs(goal_y - self.pitch.width / 2) <= self.pitch.goal_width / 2 and (
                    dist(ball, self.source["xy"]) / (t - self.source["time"]) >= 7
                ):
                    self.emit("shot_candidate", t)
                    self.source = None

        self.previous_time = t
        self.previous_ball = ball
        return owner["id"] if owner else None

    def emit(self, kind, t, **fields):
        src = self.source
        self.events.append(dict(kind=kind, start=src["time"], end=t, team=src["team"],
                                player=src["id"], **fields))
