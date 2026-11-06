"""FONT-001: TikTok Sans for captions and hooks, bundled and actually used."""
import os
import shutil
import subprocess

import pytest

from subtitles import generate_ass

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FONTS = os.path.join(ROOT, "fonts")
WORDS = {'segments': [{'start': 0, 'end': 1, 'text': 'Hamburgefonts', 'words': [
    {'word': ' Hamburgefonts', 'start': 0, 'end': 1}]}]}


def test_static_files_and_licence_are_bundled_for_server_and_preview():
    for folder in (FONTS, os.path.join(ROOT, "dashboard", "public", "fonts")):
        for name in ("TikTokSans-Regular.ttf", "TikTokSans-Bold.ttf", "TikTokSans-OFL.txt"):
            assert os.path.getsize(os.path.join(folder, name)) > 1000, (folder, name)


def _ink_width(font_name, bold, tmp_path):
    np = pytest.importorskip("numpy")
    ass = tmp_path / f"{font_name}{bold}.ass".replace(" ", "")
    generate_ass(WORDS, 0, 1, str(ass), font_name=font_name, fontsize=16, border_width=0,
                 highlight_enabled=False, bold=bold, video_size=(540, 960))
    raw = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "lavfi", "-i", "color=c=black:s=540x960:d=1", "-vf",
         f"ass=filename={ass}:fontsdir={FONTS}", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
        capture_output=True, check=True).stdout
    ink = np.frombuffer(raw, dtype=np.uint8).reshape(960, 540) > 128
    cols = np.nonzero(ink.any(axis=0))[0]
    return int(cols[-1] - cols[0]), int(ink.sum())


@pytest.mark.skipif(not shutil.which("ffmpeg"), reason="ffmpeg unavailable")
def test_libass_renders_tiktok_sans_not_a_fallback(tmp_path):
    tiktok = _ink_width("TikTok Sans", True, tmp_path)
    fallback = _ink_width("No Such Font Name", True, tmp_path)
    assert abs(tiktok[0] - fallback[0]) > 8          # different glyph widths: a real font match
    regular = _ink_width("TikTok Sans", False, tmp_path)
    assert tiktok[1] > regular[1] * 1.15             # the Bold toggle picks the Bold file


def test_hook_renders_with_tiktok_sans(tmp_path, monkeypatch):
    pytest.importorskip("PIL")
    import hooks
    monkeypatch.chdir(ROOT)
    assert hooks.HOOK_FONTS["tiktok"][0].endswith("TikTokSans-Bold.ttf")
    out = str(tmp_path / "hook.png")
    path, w, h = hooks.create_hook_image("POV: TikTok Sans hook", 972, out, style="classic", font="tiktok")
    assert os.path.exists(path) and w > 100 and h > 30
