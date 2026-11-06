"""AUDIO-002: background music removal."""
import shutil
import subprocess

import pytest

np = pytest.importorskip("numpy")
import music_removal


def test_mix_keeps_voice_and_scales_the_rest():
    original = np.array([[1.0, 0.5], [0.2, -0.4]], dtype=np.float32)
    voice = np.array([[0.4, 0.5], [0.2, 0.0]], dtype=np.float32)
    assert np.allclose(music_removal.mix(original, voice, "remove"), voice)
    reduced = music_removal.mix(original, voice, "reduce", 20)   # rest x 0.1
    assert np.allclose(reduced, voice + (original - voice) * 0.1)
    assert music_removal.mix(original, voice, "off") is original
    loud = music_removal.mix(original * 3, voice * 3, "remove")
    assert loud.max() <= 1.0


def test_settings_are_validated():
    assert music_removal.normalize_settings("Reduce", "12") == {"mode": "reduce", "reduce_db": 12.0, "quality": "fast"}
    assert music_removal.normalize_settings("remove", 18, "HQ")["quality"] == "hq"
    for bad in (("louder", 18), ("reduce", 1), ("reduce", "x"), ("remove", 18, "best")):
        with pytest.raises(ValueError):
            music_removal.normalize_settings(*bad)


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg unavailable")
def test_process_rewrites_audio_in_place_and_copies_the_video(tmp_path, monkeypatch):
    path = str(tmp_path / "clip.mp4")
    # Left channel 440 Hz ("voice"), right channel 1500 Hz ("music").
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=160x240:d=2",
                    "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "lavfi",
                    "-i", "sine=frequency=1500:duration=2", "-filter_complex",
                    "[1:a][2:a]join=inputs=2:channel_layout=stereo[a]", "-map", "0:v",
                    "-map", "[a]", "-c:v", "libx264", "-c:a", "aac", "-shortest", path], check=True)
    before = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v",
                                      "-show_entries", "packet=size", "-of", "csv=p=0", path])
    monkeypatch.setattr(music_removal, "load_model",
                        lambda: type("M", (), {"samplerate": 44100, "audio_channels": 2})())
    # Stand-in separator: the left channel is the voice.
    monkeypatch.setattr(music_removal, "separate_voice",
                        lambda wav, rate: np.stack([wav[0], np.zeros_like(wav[1])]))
    music_removal.process(path, "remove")
    after = subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v",
                                     "-show_entries", "packet=size", "-of", "csv=p=0", path])
    assert after == before   # video stream copied, not re-encoded
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le",
                                   "-ac", "2", "-ar", "44100", "-"])
    audio = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)
    assert abs(len(audio) / 44100 - 2) < 0.1
    mid = audio[22050:66150]
    assert np.sqrt((mid[:, 0] ** 2).mean()) > 0.05   # lavfi sine: amplitude 1/8
    assert np.sqrt((mid[:, 1] ** 2).mean()) < 0.01


def test_off_and_silent_clips_are_left_alone(tmp_path, monkeypatch):
    monkeypatch.setattr(music_removal, "load_model", lambda: pytest.fail("model loaded"))
    music_removal.process(str(tmp_path / "missing.mp4"), "off")
    if shutil.which("ffmpeg"):
        path = str(tmp_path / "silent.mp4")
        subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=64x64:d=1",
                        "-c:v", "libx264", path], check=True)
        music_removal.process(path, "remove")


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg unavailable")
def test_quality_picks_the_separator(tmp_path, monkeypatch):
    path = str(tmp_path / "clip.mp4")
    subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=s=64x64:d=1", "-f", "lavfi",
                    "-i", "sine=frequency=440:duration=1", "-c:v", "libx264", "-c:a", "aac", "-shortest", path],
                   check=True)
    used = []
    monkeypatch.setattr(music_removal, "separate_voice", lambda wav, rate: used.append("fast") or wav)
    monkeypatch.setattr(music_removal, "separate_voice_hq", lambda wav: used.append("hq") or wav)
    music_removal.process(path, "remove")
    music_removal.process(path, "reduce", 12, "hq")
    assert used == ["fast", "hq"]


def test_hq_separator_keeps_the_voice_level(monkeypatch):
    """The RoFormer stem is read back at the original length and level (no
    normalisation), so reduce's original - voice mix stays exact."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg unavailable")
    pytest.importorskip("scene_detection")
    wav = (np.random.default_rng(0).standard_normal((2, 44100)) * 0.2).astype(np.float32)

    class FakeSeparator:
        def separate(self, src, custom_output_names):
            out = src.replace("in_", "out_")
            subprocess.run(["ffmpeg", "-v", "error", "-y", "-i", src, "-t", "0.9", out], check=True)
            return [out]
    monkeypatch.setattr(music_removal, "load_hq", lambda: FakeSeparator())
    monkeypatch.setattr(music_removal, "HQ_WORK_DIR", "/tmp")
    voice = music_removal.separate_voice_hq(wav)
    assert voice.shape == wav.shape                    # padded back to full length
    assert np.allclose(voice[:, :39690], wav[:, :39690], atol=1e-4)
    assert not voice[:, 39700:].any()
