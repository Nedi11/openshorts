"""User-chosen defaults for the captions and hook new videos get (STYLE-001).

Self-host keeps one set per install in ``output/.user-defaults.json`` (on the
output volume, so it survives image rebuilds):

  caption_style  a full /api/subtitle style (app.CAPTION_STYLE_FIELDS names),
                 burned by the pipeline instead of subtitles.AUTO_CAPTION_STYLE.
  hook           {style, font, position, position_x, position_y, size,
                 duration_seconds} for the pipeline's automatic hook.

Either may be absent (None): the built-in look applies. The API validates
values before saving (the same models as a manual caption/hook edit); this
module only stores and reads them, and never raises on a damaged file, so a
bad file can't stop a job.
"""
import json
import os

from jsonfile import write_json_atomic

PATH = os.path.join(os.environ.get("OUTPUT_DIR", "output"), ".user-defaults.json")
HOOK_FIELDS = ("style", "font", "position", "position_x", "position_y", "size", "duration_seconds")
HOOK_SIZE_SCALE = {"S": 0.8, "M": 1.0, "L": 1.3}   # app.add_hook's size_map


def load(path=None):
    """{'caption_style': dict|None, 'hook': dict|None}; empty on any problem."""
    try:
        with open(path or PATH, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, ValueError):
        data = {}
    if not isinstance(data, dict):
        data = {}
    caption = data.get("caption_style")
    hook = data.get("hook")
    return {"caption_style": caption if isinstance(caption, dict) else None,
            "hook": ({k: hook.get(k) for k in HOOK_FIELDS} if isinstance(hook, dict) else None)}


def save(caption_style, hook, path=None):
    """Replace both entries (None clears one back to the built-in look)."""
    write_json_atomic(path or PATH, {"caption_style": caption_style, "hook": hook}, indent=2)


def caption_style(path=None):
    return load(path)["caption_style"]


def hook(path=None):
    return load(path)["hook"]
