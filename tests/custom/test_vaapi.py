import subprocess
import pytest
import ffmpeg_utils as enc
from vaapi_ffmpeg import prepare


@pytest.fixture(autouse=True)
def encoder_state(monkeypatch):
    enc.reset_encoder_cache()
    monkeypatch.setenv('FFMPEG_ENCODER', 'vaapi')
    yield
    enc.reset_encoder_cache()


def test_probe_failure_preserves_cpu_fallback(monkeypatch):
    monkeypatch.setattr(enc, 'vaapi_available', lambda: False)
    assert enc.video_encode_args() == ['-c:v', 'libx264', '-preset', 'medium', '-crf', '18']


def test_all_quality_tiers_select_vaapi(monkeypatch):
    monkeypatch.setattr(enc, 'vaapi_available', lambda: True)
    for tier in (enc.QUALITY, enc.QUALITY_FAST, enc.DELIVERY, enc.INTERMEDIATE):
        assert enc.video_encode_args(tier)[:2] == ['-c:v', 'h264_vaapi']


def test_probe_is_cached_and_uses_configured_device(monkeypatch):
    calls = []
    monkeypatch.setenv('VAAPI_DEVICE', '/dev/dri/renderD129')
    def run(cmd, **kwargs):
        calls.append(cmd)
        return subprocess.CompletedProcess(cmd, 0)
    monkeypatch.setattr(enc.subprocess, 'run', run)
    assert enc.vaapi_available() and enc.vaapi_available()
    assert len(calls) == 1
    assert '/dev/dri/renderD129' in calls[0]


def test_simple_subtitles_upload_after_text_and_preserve_audio():
    args = prepare(['-i', 'in.mp4', '-vf', 'ass=subs.ass', '-c:a', 'copy',
                    '-c:v', 'h264_vaapi', '-qp', '18', 'out.mp4'], '/dev/dri/renderD128')
    assert args[args.index('-vf') + 1] == 'ass=subs.ass,format=nv12,hwupload'
    assert args[args.index('-c:a') + 1] == 'copy'


def test_complex_reframe_preserves_maps_and_uploads_each_output():
    args = prepare(['-i', 'in.mp4', '-filter_complex', '[0:v]split[s][m]',
                    '-map', '[s]', '-map', '0:a?', '-c:v', 'h264_vaapi', 'a.mp4',
                    '-map', '[m]', '-map', '0:a?', '-c:v', 'h264_vaapi', 'b.mp4'], 'device')
    assert args[args.index('-filter_complex') + 1].endswith(
        ';[s]format=nv12,hwupload[vaapi_out_0];[m]format=nv12,hwupload[vaapi_out_1]')
    assert args.count('0:a?') == 2
    assert '[vaapi_out_0]' in args and '[vaapi_out_1]' in args


def test_unlabeled_hook_overlay():
    args = prepare(['-i', 'in.mp4', '-i', 'hook.png', '-filter_complex',
                    '[0:v][1:v]overlay=0:0', '-c:v', 'h264_vaapi', 'out.mp4'], 'device')
    assert args[args.index('-filter_complex') + 1] == '[0:v][1:v]overlay=0:0,format=nv12,hwupload'


def test_rawvideo_input_and_centered_output_formats():
    args = prepare(['-f', 'rawvideo', '-pix_fmt', 'bgr24', '-i', 'pipe:0',
                    '-c:v', 'h264_vaapi', '-pix_fmt', 'yuv420p', 'out.mp4'], 'device')
    assert args[args.index('-pix_fmt') + 1] == 'bgr24'
    assert 'yuv420p' not in args
    assert args[-3:] == ['-vf', 'format=nv12,hwupload', 'out.mp4']


def test_cpu_and_copy_commands_unchanged():
    args = ['-i', 'in.mp4', '-c', 'copy', 'out.mp4']
    assert prepare(args, 'device') == args


@pytest.mark.skipif(__import__('os').environ.get('RUN_VAAPI_TESTS') != '1',
                    reason='Requires a real VAAPI render device and bin/ffmpeg on PATH')
def test_real_vaapi_caption_and_hook_outputs_decode(tmp_path):
    import json
    from centered_fit import render_centered
    def run(args):
        return subprocess.run(args, check=True, capture_output=True)
    source = str(tmp_path / 'source.mp4')
    run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=640x360:r=30:d=1',
         '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
         '-c:v', 'libx264', '-c:a', 'aac', source])
    assert enc.vaapi_available(), 'VAAPI did not pass its real encode probe'
    render_centered(source, str(tmp_path / 'center.mp4'))
    caption = tmp_path / 'subs.srt'
    caption.write_text('1\n00:00:00,000 --> 00:00:01,000\nGPU caption test\n')
    run(['ffmpeg', '-v', 'error', '-i', source, '-vf', f'subtitles={caption}',
         '-c:a', 'copy', *enc.video_encode_args(), str(tmp_path / 'captioned.mp4')])
    run(['ffmpeg', '-v', 'error', '-i', source, '-filter_complex',
         '[0:v]drawbox=x=0:y=0:w=100:h=40:color=white:t=fill',
         *enc.video_encode_args(), str(tmp_path / 'hook.mp4')])
    run(['ffmpeg', '-v', 'error', '-i', source, '-filter_complex', '[0:v]split[a][b]',
         '-map', '[a]', '-map', '0:a?', *enc.video_encode_args(), str(tmp_path / 'a.mp4'),
         '-map', '[b]', '-map', '0:a?', *enc.video_encode_args(), str(tmp_path / 'b.mp4')])
    for output in tmp_path.glob('*.mp4'):
        run(['ffmpeg', '-v', 'error', '-i', str(output), '-f', 'null', '-'])
        streams = json.loads(run(['ffprobe', '-v', 'error', '-show_streams',
                                  '-of', 'json', str(output)]).stdout)['streams']
        assert {s['codec_type'] for s in streams} == {'video', 'audio'}
        assert next(s for s in streams if s['codec_type'] == 'video')['codec_name'] == 'h264'
