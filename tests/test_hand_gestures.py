import math
import unittest
from itertools import product
from types import SimpleNamespace

from hand_gestures import (
    FINGER_NAMES,
    finger_states_from_landmarks,
    predict_digit,
    train_digit_classifier,
)


class HandGestureTests(unittest.TestCase):
    @staticmethod
    def make_hand(
        extended_fingers,
        thumb_extended=True,
        rotation=0.0,
        scale=1.0,
        finger_bend_degrees=0.0,
    ):
        points = [SimpleNamespace(x=0.5, y=0.5, z=0.0) for _ in range(21)]
        origin_x, origin_y = 0.5, 0.85

        def set_point(index, x, y):
            rotated_x = x * scale
            rotated_y = y * scale
            cosine = math.cos(rotation)
            sine = math.sin(rotation)
            points[index] = SimpleNamespace(
                x=origin_x + rotated_x * cosine - rotated_y * sine,
                y=origin_y + rotated_x * sine + rotated_y * cosine,
                z=0.0,
            )

        set_point(0, 0, 0)
        for index, x, y in ((5, -0.13, -0.30), (9, -0.04, -0.34),
                            (13, 0.06, -0.32), (17, 0.15, -0.27)):
            set_point(index, x, y)
        for finger_index, (mcp, x, y) in enumerate(
            ((5, -0.13, -0.30), (9, -0.04, -0.34), (13, 0.06, -0.32), (17, 0.15, -0.27))
        ):
            chain = ((mcp, x, y), (mcp + 1, x + 0.01, y + 0.07),
                     (mcp + 2, x - 0.01, y + 0.03), (mcp + 3, x + 0.02, y + 0.09))
            if extended_fingers[finger_index]:
                segment_length = 0.09
                direction = -math.pi / 2
                chain_points = [(mcp, x, y)]
                for segment in range(3):
                    direction += math.radians(finger_bend_degrees) if segment else 0
                    x += segment_length * math.cos(direction)
                    y += segment_length * math.sin(direction)
                    chain_points.append((mcp + segment + 1, x, y))
                chain = tuple(chain_points)
            for index, point_x, point_y in chain:
                set_point(index, point_x, point_y)

        thumb_chain = ((2, -0.19, -0.20), (3, -0.26, -0.25), (4, -0.33, -0.29))
        if not thumb_extended:
            thumb_chain = ((2, -0.16, -0.17), (3, -0.15, -0.25), (4, -0.12, -0.28))
        for index, point_x, point_y in thumb_chain:
            set_point(index, point_x, point_y)
        return SimpleNamespace(landmark=points)

    def test_classifier_recognizes_all_combinations_of_raised_fingers(self):
        classifier = train_digit_classifier()
        for states in product((False, True), repeat=len(FINGER_NAMES)):
            with self.subTest(states=states):
                self.assertEqual(predict_digit(classifier, states), sum(states))

    def test_classifier_rejects_incomplete_hand_state(self):
        with self.assertRaises(ValueError):
            predict_digit(train_digit_classifier(), (True, False))

    def test_landmark_features_detect_an_open_hand(self):
        landmarks = self.make_hand((True, True, True, True))
        self.assertEqual(finger_states_from_landmarks(landmarks), (True, True, True, True, True))

    def test_landmark_features_detect_fingers_with_a_natural_bend(self):
        landmarks = self.make_hand((True, True, True, True), finger_bend_degrees=36)
        self.assertEqual(finger_states_from_landmarks(landmarks), (True, True, True, True, True))

    def test_landmark_features_do_not_count_curled_fingers_as_raised(self):
        landmarks = self.make_hand((True, True, True, True), finger_bend_degrees=45)
        self.assertEqual(finger_states_from_landmarks(landmarks), (True, False, False, False, False))

    def test_landmark_features_do_not_count_a_thumb_folded_across_the_palm(self):
        landmarks = self.make_hand((True, True, False, False), thumb_extended=False)
        for index, (x, y) in zip(
            (2, 3, 4),
            ((-0.19, -0.20), (-0.12, -0.15), (-0.05, -0.10)),
        ):
            landmarks.landmark[index].x = 0.5 + x
            landmarks.landmark[index].y = 0.85 + y
        self.assertEqual(
            finger_states_from_landmarks(landmarks),
            (False, True, True, False, False),
        )

    def test_landmark_features_detect_a_closed_fist(self):
        landmarks = self.make_hand((False, False, False, False), thumb_extended=False)
        self.assertEqual(finger_states_from_landmarks(landmarks), (False, False, False, False, False))

    def test_landmark_features_are_rotation_and_scale_independent(self):
        landmarks = self.make_hand((True, False, True, False), rotation=1.15, scale=1.3)
        self.assertEqual(
            finger_states_from_landmarks(landmarks),
            (True, True, False, True, False),
        )

    def test_landmark_features_allow_extended_fingers_to_point_sideways(self):
        landmarks = self.make_hand((False, True, False, True), rotation=1.57, thumb_extended=False)
        self.assertEqual(
            finger_states_from_landmarks(landmarks),
            (False, False, True, False, True),
        )

if __name__ == "__main__":
    unittest.main()
