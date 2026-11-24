import unittest

from boots import BootCheck


class FootwearTest(unittest.TestCase):
    foot = [600, 300, 615, 309]
    people = [{"box": [430, 280, 610, 330]}]

    def setUp(self):
        self.guard = BootCheck((1280, 720))

    def test_repeated_boot_does_not_establish_a_ball(self):
        for time in (0, 0.1, 0.2):
            self.assertTrue(self.guard.possible_boot(time, self.foot, self.people))

    def test_ball_approaching_foot_has_short_lived_support(self):
        self.assertFalse(self.guard.possible_boot(0, [595, 351, 610, 360], self.people))
        self.assertFalse(self.guard.possible_boot(0.1, self.foot, self.people))
        self.assertTrue(self.guard.possible_boot(0.5, self.foot, self.people))

    def test_swinging_boot_outside_player_box(self):
        self.assertTrue(self.guard.possible_boot(0, [600, 264, 610, 274], self.people))

    def test_distant_ball_does_not_explain_boot(self):
        self.guard.possible_boot(0, [200, 700, 210, 710], self.people)
        self.assertTrue(self.guard.possible_boot(0.2, self.foot, self.people))
