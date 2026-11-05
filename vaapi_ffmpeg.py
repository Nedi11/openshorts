"""Adapt software filter outputs to VAAPI surfaces; invoked only by bin/ffmpeg.

Keep decoding, reframing, libass and overlays on the CPU. Upload only the
finished picture, preserving existing filter graphs and audio mappings.
"""
import os
from pathlib import Path
import sys

UPLOAD = 'format=nv12,hwupload'


def prepare(args, device):
    args = list(args)
    if 'h264_vaapi' not in args:
        return args
    # Input rawvideo formats must remain intact. Output yuv420p would force
    # hardware surfaces back into software, so remove it after the last input.
    last_input = max((i + 1 for i, a in enumerate(args) if a == '-i'), default=-1)
    for i in range(len(args) - 2, last_input, -1):
        if args[i:i + 2] == ['-pix_fmt', 'yuv420p']:
            del args[i:i + 2]
    graph_option = next((i for i, a in enumerate(args) if a in ('-filter_complex', '-lavfi')), None)
    vf_option = next((i for i, a in enumerate(args) if a in ('-vf', '-filter:v')), None)
    if graph_option is not None:
        graph = args[graph_option + 1]
        mapped = []
        for i, a in enumerate(args[:-1]):
            if a == '-map' and args[i + 1].startswith('['):
                label = args[i + 1]
                if label not in mapped:
                    mapped.append(label)
                args[i + 1] = f'[vaapi_out_{mapped.index(label)}]'
        if mapped:
            graph += ''.join(f';{label}{UPLOAD}[vaapi_out_{i}]' for i, label in enumerate(mapped))
        else:
            # Hook overlays have an unlabeled terminal video output.
            graph += ',' + UPLOAD
        args[graph_option + 1] = graph
    elif vf_option is not None:
        args[vf_option + 1] += ',' + UPLOAD
    else:
        # An output option: after inputs, including rawvideo pipe input.
        args[-1:-1] = ['-vf', UPLOAD]
    return ['-vaapi_device', device, *args]


if __name__ == '__main__':
    command = prepare(sys.argv[1:], os.environ.get('VAAPI_DEVICE', '/dev/dri/renderD128'))
    wrapper = str(Path(__file__).resolve().parent / 'bin' / 'ffmpeg')
    os.execve(wrapper, [wrapper, *command], {**os.environ, 'VAAPI_PREPARED': '1'})
