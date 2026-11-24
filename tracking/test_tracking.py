import unittest
from types import SimpleNamespace

import cv2
import numpy as np

from events import Events, Tracks
from pitch import Pitch, line_segments


class TrackingTest(unittest.TestCase):
    def setUp(self):
        self.pitch = SimpleNamespace(length=100, width=60, goal_width=7, attack="xmax")
        self.events = Events(self.pitch)
        self.people = [dict(id=1, team="us", xy=[30, 30]), dict(id=2, team="us", xy=[40, 30])]

    def run_balls(self, balls):
        for index, xy in enumerate(balls):
            self.events.observe(index / 4, xy, self.people)

    def test_completed_transfer_with_observed_release(self):
        self.run_balls([(30, 30), (30, 30), (35, 30), (40, 30), (40, 30)])
        event, = self.events.events
        self.assertEqual((event["kind"], event["player"], event["receiver"]), ("pass_candidate", 1, 2))
        self.assertEqual(self.events.seconds, dict(us=.5, them=0, unknown=.5))

    def test_missing_ball_breaks_transfer(self):
        self.run_balls([(30, 30), (30, 30), None, (40, 30), (40, 30)])
        self.assertFalse(self.events.events)
        self.assertEqual(self.events.ball_track, 2)

    def test_turnover_or_contest(self):
        self.people[1]["team"] = "them"
        self.run_balls([(30, 30), (30, 30), (35, 30), (40, 30), (40, 30)])
        self.assertFalse(self.events.events)
        self.assertEqual(self.events.seconds["them"], .25)
        self.people[0]["xy"] = [40, 30]
        self.events.observe(1.25, (40, 30), self.people)
        self.assertEqual(self.events.seconds["unknown"], .75)

    def test_jump_and_long_gap(self):
        self.run_balls([(30, 30), (30, 30), (98, 30)])
        self.events.observe(2, (30, 30), self.people)
        self.assertEqual(self.events.ball_track, 3)
        self.assertFalse(self.events.events)
        self.assertEqual(self.events.seconds["unknown"], 1.75)

    def test_goal_direction(self):
        for attack, expected in (("xmax", 1), ("x0", 0)):
            self.pitch.attack = attack
            self.events = Events(self.pitch)
            self.people[0]["xy"] = [90, 30]
            self.run_balls([(90, 30), (90, 30), (94, 30), (98, 30)])
            self.assertEqual([e["kind"] for e in self.events.events], ["shot_candidate"] * expected)

    def test_track_matching_and_expiry(self):
        tracks = Tracks()
        def observe(t, positions):
            players = tracks.update([dict(xy=[x, 20], team="us") for x in positions], t)
            return [p["id"] for p in players]
        self.assertEqual(observe(0, [10, 20]), [1, 2])
        self.assertEqual(observe(.25, [21, 11]), [2, 1])
        self.assertEqual(observe(1, [21, 11]), [3, 4])
        self.assertEqual(observe(1.25, [11.1, 11.2]), [5, 6])

    def test_calibration_and_outside_view(self):
        config = dict(image_size=[201, 121], pitch_size_m=[100, 60], goal_width_m=7,
                      us_attacks="xmax", anchors=[[20, 20, 10, 10], [180, 20, 90, 10],
                      [180, 100, 90, 50], [20, 100, 10, 50]], checks=[[100, 60, 50, 30]])
        pitch = Pitch(config, config["image_size"])
        np.testing.assert_allclose(pitch.locate([400, 400, 500, 600], [201, 121]), [50, 30])
        self.assertIsNone(pitch.locate([0, 0, 10, 10], [201, 121]))
        config["checks"][0][-1] += 3
        with self.assertRaisesRegex(ValueError, "Landmark error"):
            Pitch(config, config["image_size"])

    def test_marking_on_green(self):
        image = np.full((240, 320, 3), (25, 140, 25), dtype=np.uint8)
        cv2.line(image, (20, 100), (200, 100), (255, 255, 255), 3)
        self.assertTrue(any(abs(y-100) < 5 and abs(v-100) < 5 for x,y,u,v in line_segments(image)))


if __name__ == "__main__":
    unittest.main()
