"""Background music removal for editor renders (AUDIO-002).

Demucs htdemucs (MIT) separates the clip's audio into a voice stem and the
rest. ``remove`` keeps only the voice; ``reduce`` keeps the rest underneath,
``reduce_db`` quieter. The video stream is copied, never re-encoded.

Runs on the RENDERED clip (seconds of audio, not the whole source): about 27 s
per 60 s clip on a Ryzen 7 5700G CPU at 8 threads. Word-censor bleeps are
applied after this, so the tone is never separated away.

Separation keeps everything the model hears as voice: sung vocals stay, and
crowd noise or room tone go with the music in ``remove`` mode.
"""
import os
import subprocess
import threading
import uuid

import numpy as np

MODES = ("off", "remove", "reduce")
DEFAULT_REDUCE_DB = 18.0
MODEL_NAME = os.environ.get("DEMUCS_MODEL", "htdemucs")
# Baked into the image (Dockerfile), outside the /app/.cache volume.
MODEL_DIR = os.environ.get("DEMUCS_MODEL_DIR", "/opt/demucs")

_LOCK = threading.Lock()
_model = None


def load_model():
    """The shared Demucs model; weights cached in MODEL_DIR (downloaded once)."""
    global _model
    if _model is None:
        import torch
        from demucs.pretrained import get_model
        previous = torch.hub.get_dir()
        torch.hub.set_dir(MODEL_DIR)
        try:
            model = get_model(MODEL_NAME)
        finally:
            torch.hub.set_dir(previous)
        model.eval()
        _model = model
    return _model


def normalize_settings(mode, reduce_db=DEFAULT_REDUCE_DB):
    """Validated {'mode', 'reduce_db'}; raises ValueError for unknown input."""
    mode = (mode or "off").strip().lower()
    if mode not in MODES:
        raise ValueError("Background music must be off, remove or reduce")
    try:
        reduce_db = float(reduce_db)
    except (TypeError, ValueError):
        raise ValueError("Music reduction must be a number of dB")
    if not 3 <= reduce_db <= 40:
        raise ValueError("Music reduction must be between 3 and 40 dB")
    return {"mode": mode, "reduce_db": round(reduce_db, 1)}


def mix(original, voice, mode, reduce_db=DEFAULT_REDUCE_DB):
    """Final audio from the original and its voice stem (both [channels, n]).

    The rest is ``original - voice`` rather than the sum of the other stems, so
    nothing the model leaves out of all four stems goes missing in ``reduce``.
    """
    if mode == "remove":
        out = voice
    elif mode == "reduce":
        out = voice + (original - voice) * (10 ** (-float(reduce_db) / 20))
    else:
        return original
    return np.clip(out, -1.0, 1.0)


def _has_audio(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "a", "-show_entries",
         "stream=index", "-of", "csv=p=0", path],
        capture_output=True, text=True, timeout=60)
    return bool(probe.stdout.strip())


def separate_voice(wav, samplerate):
    """Voice stem of ``wav`` ([2, n] float32 at the model rate)."""
    import torch
    from demucs.apply import apply_model
    import scene_detection  # restores torch's thread pool in this process
    model = load_model()
    tensor = torch.from_numpy(np.ascontiguousarray(wav))
    ref = tensor.mean(0)
    mean, std = ref.mean(), ref.std() + 1e-8
    with _LOCK, torch.no_grad():
        scene_detection.apply_torch_threads()
        sources = apply_model(model, ((tensor - mean) / std)[None], shifts=0,
                              split=True, overlap=0.25, progress=False)[0]
    voice = sources[model.sources.index("vocals")] * std + mean
    return voice.numpy()


def process(path, mode, reduce_db=DEFAULT_REDUCE_DB):
    """Rewrite ``path`` in place with its music removed or reduced."""
    if mode == "off" or not _has_audio(path):
        return
    model = load_model()
    rate, channels = model.samplerate, model.audio_channels
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le",
         "-ac", str(channels), "-ar", str(rate), "-"],
        capture_output=True, check=True, timeout=1800).stdout
    original = np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).T
    if original.shape[1] == 0:
        return
    audio = mix(original, separate_voice(original, rate), mode, reduce_db)
    output = f"{path}.{uuid.uuid4().hex}.mp4"
    try:
        subprocess.run(
            ["ffmpeg", "-v", "error", "-y", "-i", path, "-f", "f32le", "-ac", str(channels),
             "-ar", str(rate), "-i", "-", "-map", "0:v:0", "-map", "1:a:0",
             "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", output],
            input=np.ascontiguousarray(audio.T, dtype=np.float32).tobytes(),
            check=True, timeout=1800)
        os.replace(output, path)
    finally:
        if os.path.exists(output):
            os.remove(output)
