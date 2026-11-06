"""CAPTION-008: caption outlines are equally thick on every side."""
import shutil
import subprocess

import pytest

from subtitles import generate_ass, play_res_x, subtitles_filter

WORDS = {'segments': [{'start': 0, 'end': 1, 'text': 'III', 'words': [
    {'word': ' III', 'start': 0, 'end': 1}]}]}


def test_grid_width_follows_the_frame_shape():
    assert play_res_x((1080, 1920)) == 162
    assert play_res_x((1080, 1080)) == 288
    assert play_res_x((1920, 1080)) == 512
    assert play_res_x(None) == play_res_x((0, 0)) == 162


def test_ass_and_classic_declare_the_grid_width(tmp_path):
    out = tmp_path / 'c.ass'
    generate_ass(WORDS, 0, 1, str(out), video_size=(1080, 1080), horizontal_padding=10)
    text = out.read_text()
    assert 'PlayResX: 288\n' in text
    style = next(l for l in text.splitlines() if l.startswith('Style: Default')).split(',')
    assert style[19:21] == ['29', '29']           # 10% of 288 per side
    assert 'PlayResX=288,' in subtitles_filter('c.srt', video_size=(1080, 1080))


def _strokes(raw, width, height):
    """(side, top) outline thickness in px around the first glyph."""
    np = pytest.importorskip('numpy')
    dark = np.frombuffer(raw, dtype=np.uint8).reshape(height, width) < 40
    ys, _ = np.nonzero(dark)
    row = np.nonzero(dark[(ys.min() + ys.max()) // 2])[0]
    runs = np.split(row, np.where(np.diff(row) > 1)[0] + 1)
    col = np.nonzero(dark[:, (runs[0][-1] + runs[1][0]) // 2])[0]
    vruns = np.split(col, np.where(np.diff(col) > 1)[0] + 1)
    return len(runs[0]), len(vruns[0])


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg unavailable')
@pytest.mark.parametrize('size', [(540, 960), (720, 720)])
def test_rendered_outline_is_even_on_every_side(tmp_path, size):
    w, h = size
    ass = tmp_path / 'o.ass'
    generate_ass(WORDS, 0, 1, str(ass), font_name='Arial', fontsize=40, border_width=3,
                 highlight_enabled=False, video_size=size)
    srt = tmp_path / 'o.srt'
    srt.write_text('1\n00:00:00,000 --> 00:00:01,000\nIII\n')
    for path, vf in ((ass, f'ass=filename={ass}'),
                     (srt, subtitles_filter(str(srt), border_width=3, fontsize=40, video_size=size))):
        raw = subprocess.run(
            ['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', f'color=c=gray:s={w}x{h}:d=1',
             '-vf', f'format=rgb24,{vf}', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-'],
            capture_output=True, check=True).stdout
        side, top = _strokes(raw, w, h)
        # Was 2.4x thicker on top than at the sides on 9:16 before PlayResX.
        assert abs(side - top) <= 2, (path.suffix, side, top)
