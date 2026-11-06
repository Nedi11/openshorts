"""Background music removal for editor renders (AUDIO-002).

Demucs htdemucs (MIT) separates the clip's audio into a voice stem and the
rest. ``remove`` keeps only the voice; ``reduce`` keeps the rest underneath,
``reduce_db`` quieter. The video stream is copied, never re-encoded.

Runs on the RENDERED clip (seconds of audio, not the whole source): about 27 s
per 60 s clip on a Ryzen 7 5700G CPU at 8 threads. Word-censor bleeps are
applied after this, so the tone is never separated away.

Separation keeps everything the model hears as voice: sung vocals stay, and
crowd noise or room tone go with the music in ``remove`` mode.

Two qualities (AUDIO-003):
  fast  Demucs htdemucs, ~0.3x the clip length on a Ryzen 7 5700G CPU.
  hq    Mel-Band RoFormer (vocals_mel_band_roformer), ~2.6x the clip length.
        On a crowded-shop clip it took the music in speech pauses down
        11-40 dB where htdemucs managed 2-4 dB: htdemucs files room music
        recorded on a phone under "vocals". Weights ~900 MB, in HQ_MODEL_DIR.
"""
import os
import subprocess
import threading
import uuid

import numpy as np

MODES = ("off", "remove", "reduce")
QUALITIES = ("fast", "hq")
DEFAULT_REDUCE_DB = 18.0
MODEL_NAME = os.environ.get("DEMUCS_MODEL", "htdemucs")
# Baked into the image (Dockerfile), outside the /app/.cache volume.
MODEL_DIR = os.environ.get("DEMUCS_MODEL_DIR", "/opt/demucs")

HQ_MODEL = os.environ.get("MUSIC_HQ_MODEL", "vocals_mel_band_roformer.ckpt")
HQ_MODEL_DIR = os.environ.get("MUSIC_HQ_MODEL_DIR", "/opt/separator")
HQ_WORK_DIR = os.environ.get("MUSIC_HQ_WORK_DIR", "/tmp/music_hq")
RATE, CHANNELS = 44100, 2

_LOCK = threading.Lock()
_model = None
_hq = None


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


def load_hq():
    """The shared Mel-Band RoFormer separator (audio-separator), loaded once."""
    global _hq
    if _hq is None:
        import logging
        from audio_separator.separator import Separator
        os.makedirs(HQ_WORK_DIR, exist_ok=True)
        # normalization_threshold 1.0: only scale a clipping stem. The default
        # 0.9 would change the voice level against the original, which the
        # reduce mix (original - voice) depends on.
        separator = Separator(log_level=logging.WARNING, model_file_dir=HQ_MODEL_DIR,
                              output_dir=HQ_WORK_DIR, output_single_stem="Vocals",
                              normalization_threshold=1.0, sample_rate=RATE)
        separator.load_model(model_filename=HQ_MODEL)
        _hq = separator
    return _hq


def normalize_settings(mode, reduce_db=DEFAULT_REDUCE_DB, quality="fast"):
    """Validated {'mode', 'reduce_db', 'quality'}; raises ValueError for unknown input."""
    mode = (mode or "off").strip().lower()
    if mode not in MODES:
        raise ValueError("Background music must be off, remove or reduce")
    quality = (quality or "fast").strip().lower()
    if quality not in QUALITIES:
        raise ValueError("Music removal quality must be fast or hq")
    try:
        reduce_db = float(reduce_db)
    except (TypeError, ValueError):
        raise ValueError("Music reduction must be a number of dB")
    if not 3 <= reduce_db <= 40:
        raise ValueError("Music reduction must be between 3 and 40 dB")
    return {"mode": mode, "reduce_db": round(reduce_db, 1), "quality": quality}


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


def separate_voice_hq(wav):
    """Voice stem of ``wav`` ([2, n] float32 at 44.1 kHz) with Mel-Band RoFormer."""
    import scene_detection
    separator = load_hq()
    name = uuid.uuid4().hex
    src = os.path.join(HQ_WORK_DIR, f"in_{name}.wav")
    outputs = []
    try:
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ac", str(CHANNELS), "-ar", str(RATE),
                        "-i", "-", "-c:a", "pcm_f32le", src],
                       input=np.ascontiguousarray(wav.T, dtype=np.float32).tobytes(), check=True, timeout=1800)
        with _LOCK:
            scene_detection.apply_torch_threads()
            outputs = [p if os.path.isabs(p) else os.path.join(HQ_WORK_DIR, p)
                       for p in separator.separate(src, custom_output_names={"Vocals": f"voice_{name}"})]
        raw = subprocess.run(["ffmpeg", "-v", "error", "-i", outputs[0], "-f", "f32le", "-ac", str(CHANNELS),
                              "-ar", str(RATE), "-"], capture_output=True, check=True, timeout=1800).stdout
        voice = np.frombuffer(raw, dtype=np.float32).reshape(-1, CHANNELS).T
        out = np.zeros_like(wav)
        n = min(out.shape[1], voice.shape[1])
        out[:, :n] = voice[:, :n]
        return out
    finally:
        for path in [src, *outputs]:
            if os.path.exists(path):
                os.remove(path)


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


def process(path, mode, reduce_db=DEFAULT_REDUCE_DB, quality="fast"):
    """Rewrite ``path`` in place with its music removed or reduced."""
    if mode == "off" or not _has_audio(path):
        return
    rate, channels = RATE, CHANNELS   # both models: 44.1 kHz stereo
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-map", "0:a:0", "-f", "f32le",
         "-ac", str(channels), "-ar", str(rate), "-"],
        capture_output=True, check=True, timeout=1800).stdout
    original = np.frombuffer(raw, dtype=np.float32).reshape(-1, channels).T
    if original.shape[1] == 0:
        return
    voice = separate_voice_hq(original) if quality == "hq" else separate_voice(original, rate)
    audio = mix(original, voice, mode, reduce_db)
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
