"""TRACK-001 / PERF-001: tracking defaults and the OpenMP thread pool.

Each case imports main in a fresh interpreter, because the defaults are read
from the environment at import time and ultralytics mutates OMP_NUM_THREADS.
"""
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
pytestmark = pytest.mark.skipif(
    any(importlib.util.find_spec(m) is None for m in ("ultralytics", "mediapipe", "torch")),
    reason="needs the ML stack (backend image)")

PROBE = """
import json, os, main, torch
print(json.dumps({
    "omp": os.environ.get("OMP_NUM_THREADS"), "torch": torch.get_num_threads(),
    "stride": main.DETECT_STRIDE, "yolo_stride": main.YOLO_FALLBACK_STRIDE,
    "jump": main.JUMP_CONFIRM_FRAMES, "decay": main.SPEAKER_SCORE_DECAY,
    "yolo": os.path.basename(str(main.model.ckpt_path)),
}))
"""


def probe(**env):
    clean = {k: v for k, v in os.environ.items()
             if k not in ("OMP_NUM_THREADS", "TORCH_THREADS", "DETECT_STRIDE",
                          "JUMP_CONFIRM_FRAMES", "YOLO_MODEL_PATH")}
    clean.update(env)
    out = subprocess.run([sys.executable, "-c", PROBE], cwd=ROOT, env=clean,
                         capture_output=True, text=True, check=True).stdout
    return json.loads(out.strip().splitlines()[-1])


def test_defaults_detect_every_second_frame_with_yolov8_small_and_real_threads():
    got = probe()
    assert got["yolo"] == "yolov8s.pt"
    assert (got["stride"], got["yolo_stride"]) == (2, 4)
    # ultralytics would otherwise force OMP_NUM_THREADS=1 (single-threaded
    # TransNetV2, YOLO and faster-whisper).
    assert int(got["omp"]) == min(8, os.cpu_count()) and got["torch"] == int(got["omp"])
    # The damping keeps its tuned timing in frames: 3 detections x 4 frames.
    assert got["jump"] * got["stride"] == 12
    assert got["decay"] ** (4 / got["stride"]) == pytest.approx(0.85)


def test_stride_four_restores_the_previous_tracker_exactly():
    got = probe(DETECT_STRIDE="4", YOLO_MODEL_PATH="yolov8n.pt")
    assert (got["stride"], got["jump"], got["yolo"]) == (4, 3, "yolov8n.pt")
    assert got["decay"] == pytest.approx(0.85)


def test_explicit_settings_win():
    got = probe(OMP_NUM_THREADS="3", JUMP_CONFIRM_FRAMES="1")
    assert (got["omp"], got["torch"], got["jump"]) == ("3", 3, 1)
    assert probe(TORCH_THREADS="5")["torch"] == 5
