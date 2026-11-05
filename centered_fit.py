"""Fixed centered framing that preserves the full source height."""
import os
import subprocess

from ffmpeg_utils import QUALITY, audio_encode_args, video_encode_args


def height_fit_filter(output_format='auto'):
    width, height = (1080, 1080) if output_format == 'square' else (1080, 1920)
    # A narrower portrait source is padded horizontally, never cropped vertically.
    return (
        f'scale=w=trunc({height}*dar/2)*2:h={height},'
        f'crop=w=min(iw\\,{width}):h=ih:x=(iw-ow)/2:y=0,'
        f'pad={width}:{height}:(ow-iw)/2:0:black,setsar=1'
    )


def render_centered(input_path, output_path, output_format='auto'):
    command = [
        'ffmpeg', '-y', '-i', input_path,
        '-map', '0:v:0', '-map', '0:a?',
        '-vf', height_fit_filter(output_format),
        *video_encode_args(QUALITY), '-threads', os.getenv('FFMPEG_THREADS', '2'),
        '-pix_fmt', 'yuv420p', *audio_encode_args(),
        '-movflags', '+faststart', output_path,
    ]
    subprocess.run(command, check=True, capture_output=True)
    return True
