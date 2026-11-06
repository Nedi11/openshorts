"""CAPTION-006 / HOOK-001: fine shadow and custom caption/hook placement."""
import shutil
import subprocess
from pathlib import Path

import pytest

import hooks
from subtitles import (custom_margin_v, generate_ass, shadow_layer_tags,
                       subtitles_filter)

WORDS = {'segments': [{'start': 0, 'end': 1, 'text': 'HI YO', 'words': [
    {'word': ' HI', 'start': 0, 'end': .5}, {'word': ' YO', 'start': .5, 'end': 1}]}]}


def _events(path):
    return [l for l in Path(path).read_text().splitlines() if l.startswith('Dialogue:')]


def test_shadow_layer_follows_direction_blur_colour_and_opacity(tmp_path):
    out = tmp_path / 's.ass'
    assert generate_ass(WORDS, 0, 1, str(out), border_width=0, shadow=3, shadow_angle=180,
                        shadow_blur=4, shadow_color='#FF0000', shadow_opacity=1.0, reveal=True)
    events = _events(out)
    shadow = [e for e in events if e.startswith('Dialogue: 0,')]
    text = [e for e in events if e.startswith('Dialogue: 1,')]
    assert len(shadow) == len(text) == 2
    # 180 degrees: straight left, depth * sqrt 2 along the angle.
    assert '\\xshad-4.24\\yshad0' in shadow[0] and '\\blur4' in shadow[0]
    assert '\\4c&H0000FF&\\4a&H00&' in shadow[0] and '\\1a&HFE&' in shadow[0]
    # Blur stays on the shadow layer; reveal hides unspoken words on both layers.
    assert all('blur' not in e for e in text)
    assert shadow[0].count('\\alpha&HFF&') == text[0].count('\\alpha&HFF&') == 1
    # Blur with zero depth is a centred halo; nothing at all is no layer.
    assert '\\xshad0\\yshad0' in shadow_layer_tags(0, 45, 3)
    assert shadow_layer_tags(0, 45, 0) is None
    # A stroke keeps suppressing the separate shadow (CAPTION-004).
    generate_ass(WORDS, 0, 1, str(out), border_width=2, shadow=3, shadow_blur=4)
    assert all(e.startswith('Dialogue: 1,') for e in _events(out))


def test_custom_caption_position_sets_bottom_margin_for_ass_and_classic(tmp_path):
    assert custom_margin_v('custom', 50) == 144
    assert custom_margin_v('custom', 200) == round(288 * .9)
    assert custom_margin_v('bottom', 50) is None
    out = tmp_path / 'p.ass'
    generate_ass(WORDS, 0, 1, str(out), alignment='custom', position_y=25)
    style = next(l for l in out.read_text().splitlines() if l.startswith('Style: Default')).split(',')
    assert style[18] == '2' and style[21] == '72'
    assert 'Alignment=2' in (vf := subtitles_filter('c.srt', alignment='custom', position_y=25))
    assert 'MarginV=72' in vf
    assert 'MarginV=43' in subtitles_filter('c.srt', alignment='bottom', position_y=25)


@pytest.mark.parametrize('x,y,expected', [(0, 0, (0, 0)), (100, 100, (580, 1720)),
                                          (50, 50, (290, 860)), (-5, 900, (0, 1720))])
def test_custom_hook_position_shares_free_space_and_stays_in_frame(x, y, expected):
    assert hooks.custom_overlay_xy(x, y, 1080, 1920, 500, 200) == expected


def _render(ass, tmp_path):
    png = tmp_path / 'f.png'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x808080:s=270x480:d=1',
                    '-vf', f"format=rgb24,ass=filename={ass}", '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24',
                    str(png)], check=True)
    return png.read_bytes()


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='ffmpeg unavailable')
def test_libass_draws_a_blurred_shadow_under_crisp_text(tmp_path):
    def frame(**kw):
        out = tmp_path / 'r.ass'
        generate_ass(WORDS, 0, 1, str(out), border_width=0, font_name='Arial', fontsize=40,
                     font_color='#FFFFFF', highlight_enabled=False, alignment='custom', position_y=40, **kw)
        return _render(out, tmp_path)
    plain = frame()
    red = frame(shadow=4, shadow_angle=90, shadow_blur=0, shadow_color='#FF0000', shadow_opacity=1)
    soft = frame(shadow=4, shadow_angle=90, shadow_blur=6, shadow_color='#FF0000', shadow_opacity=1)
    px = lambda b: [tuple(b[i:i + 3]) for i in range(0, len(b), 3)]
    is_red = lambda p: p[0] > 150 and p[1] < 90
    hard_red = sum(map(is_red, px(red)))
    assert hard_red > 50 and not any(map(is_red, px(plain)))
    # The text itself stays crisp: every fully covered glyph pixel stays pure
    # white (anti-aliased edges legitimately blend with the shadow beneath).
    white = [i for i, p in enumerate(px(plain)) if p == (255, 255, 255)]
    assert len(white) > 50 and all(px(soft)[i] == (255, 255, 255) for i in white)
    # Blur spreads the shadow into partially tinted pixels a hard shadow lacks.
    tinted = lambda b: sum(1 for p in px(b) if 140 < p[0] and p[1] < 125 and not is_red(p))
    assert tinted(soft) > tinted(red) * 2
