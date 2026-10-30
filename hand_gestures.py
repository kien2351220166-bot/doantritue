from __future__ import annotations

from itertools import product
from typing import Sequence

import numpy as np
from sklearn.tree import DecisionTreeClassifier


FINGER_NAMES = ("Ngón cái", "Ngón trỏ", "Ngón giữa", "Ngón áp út", "Ngón út")
FINGER_JOINTS = ((5, 6, 7, 8), (9, 10, 11, 12), (13, 14, 15, 16), (17, 18, 19, 20))


def _joint_angle(first: np.ndarray, joint: np.ndarray, last: np.ndarray) -> float:
    first_vector = first - joint
    last_vector = last - joint
    lengths = float(np.linalg.norm(first_vector) * np.linalg.norm(last_vector))
    if lengths < 1e-6:
        return 0.0
    cosine = float(np.clip(np.dot(first_vector, last_vector) / lengths, -1.0, 1.0))
    return float(np.degrees(np.arccos(cosine)))


def finger_states_from_landmarks(
    landmarks: object,
    image_size: tuple[int, int] | None = None,
) -> tuple[bool, ...]:
    width, height = image_size or (1, 1)
    depth_scale = float(width)
    points = np.asarray(
        [
            (point.x * width, point.y * height, getattr(point, "z", 0.0) * depth_scale)
            for point in landmarks.landmark
        ],
        dtype=np.float32,
    )
    palm_size = float(np.linalg.norm(points[9] - points[0]))
    if palm_size < 1e-6:
        return (False, False, False, False, False)
    palm_axis = (points[9] - points[0]) / palm_size

    extended_fingers = []
    for mcp, pip, dip, tip in FINGER_JOINTS:
        segment_lengths = sum(
            float(np.linalg.norm(points[end] - points[start]))
            for start, end in ((mcp, pip), (pip, dip), (dip, tip))
        )
        straightness = float(np.linalg.norm(points[tip] - points[mcp])) / max(segment_lengths, 1e-6)
        pip_angle = _joint_angle(points[mcp], points[pip], points[dip])
        dip_angle = _joint_angle(points[pip], points[dip], points[tip])
        palm_extension = float(np.dot(points[tip] - points[mcp], palm_axis) / palm_size)
        extended_fingers.append(
            straightness >= 0.78 and pip_angle >= 135 and dip_angle >= 125 and palm_extension >= 0.42
        )

    thumb_segment_lengths = (
        float(np.linalg.norm(points[3] - points[2])) +
        float(np.linalg.norm(points[4] - points[3]))
    )
    thumb_straightness = float(np.linalg.norm(points[4] - points[2])) / max(thumb_segment_lengths, 1e-6)
    thumb_angle = _joint_angle(points[2], points[3], points[4])
    thumb_tip_to_index = float(np.linalg.norm(points[4] - points[5]) / palm_size)
    thumb_joint_to_index = float(np.linalg.norm(points[3] - points[5]) / palm_size)
    thumb_outward_extension = (
        float(np.linalg.norm(points[4] - points[0])) -
        float(np.linalg.norm(points[3] - points[0]))
    ) / palm_size
    thumb_extended = (
        thumb_straightness >= 0.78 and thumb_angle >= 135 and
        thumb_tip_to_index - thumb_joint_to_index > 0.10 and thumb_outward_extension >= 0.08
    )
    return (thumb_extended, *extended_fingers)


def train_digit_classifier() -> DecisionTreeClassifier:
    patterns = list(product((0, 1), repeat=len(FINGER_NAMES)))
    labels = [sum(pattern) for pattern in patterns]
    classifier = DecisionTreeClassifier(max_depth=len(FINGER_NAMES), random_state=42)
    classifier.fit(patterns, labels)
    return classifier


def predict_digit(classifier: DecisionTreeClassifier, finger_states: Sequence[bool]) -> int:
    if len(finger_states) != len(FINGER_NAMES):
        raise ValueError(f"Expected {len(FINGER_NAMES)} finger states.")
    features = np.asarray([[int(state) for state in finger_states]], dtype=np.uint8)
    return int(classifier.predict(features)[0])
