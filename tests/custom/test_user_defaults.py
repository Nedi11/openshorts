"""STYLE-001: saved default captions and hook for new videos."""
import asyncio
import json
from pathlib import Path

import httpx
import pytest

import user_defaults


@pytest.fixture
def store(tmp_path, monkeypatch):
    path = tmp_path / ".user-defaults.json"
    monkeypatch.setattr(user_defaults, "PATH", str(path))
    return path


def test_damaged_or_missing_file_means_builtin(store):
    assert user_defaults.load() == {"caption_style": None, "hook": None}
    store.write_text("{not json")
    assert user_defaults.load() == {"caption_style": None, "hook": None}
    store.write_text(json.dumps({"caption_style": "x", "hook": {"style": "dark", "junk": 1}}))
    loaded = user_defaults.load()
    assert loaded["caption_style"] is None and loaded["hook"]["style"] == "dark" and "junk" not in loaded["hook"]


def _request(app_module, method, route, data=None):
    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app_module.app),
                                     base_url="http://testserver") as client:
            return await client.request(method, route, json=data)
    return asyncio.run(run())


def test_api_saves_validates_and_resets(store, monkeypatch):
    app_module = pytest.importorskip("app")
    monkeypatch.setattr(app_module, "BILLING_ENABLED", False)
    got = _request(app_module, "GET", "/api/defaults").json()
    assert got["caption_style"] is None and got["builtin"]["caption_style"]["font_name"] == "Anton"
    body = {"caption_style": {"style": "karaoke", "font_name": "TikTok Sans", "font_size": 30,
                              "position": "custom", "position_y": 30, "shadow_blur": 3, "bogus": 1},
            "hook": {"style": "dark", "font": "tiktok", "position": "custom", "position_x": 10,
                     "position_y": 80, "size": "L", "duration_seconds": 7}}
    saved = _request(app_module, "PUT", "/api/defaults", body)
    assert saved.status_code == 200, saved.text
    on_disk = json.loads(store.read_text())
    assert on_disk["caption_style"]["font_name"] == "TikTok Sans" and "bogus" not in on_disk["caption_style"]
    assert on_disk["caption_style"]["border_width"] == 2          # unspecified fields get the request defaults
    assert on_disk["hook"] == {"style": "dark", "font": "tiktok", "position": "custom", "position_x": 10.0,
                               "position_y": 80.0, "size": "L", "duration_seconds": 7.0}
    for bad in ({"hook": {"style": "neon"}}, {"hook": {"style": "dark", "font": "comic"}},
                {"hook": {"style": "dark", "duration_seconds": 0}},
                {"caption_style": {"style": "karaoke", "shadow_blur": 99}}):
        assert _request(app_module, "PUT", "/api/defaults", bad).status_code == 422, bad
    assert json.loads(store.read_text())["hook"]["style"] == "dark"   # a refused save changes nothing
    reset = _request(app_module, "PUT", "/api/defaults", {"caption_style": None, "hook": on_disk["hook"]}).json()
    assert reset["caption_style"] is None and reset["hook"]["style"] == "dark"
    monkeypatch.setattr(app_module, "BILLING_ENABLED", True)
    assert _request(app_module, "GET", "/api/defaults").status_code == 404   # never shared across cloud users


def test_pipeline_burns_and_records_the_saved_caption_style(store, tmp_path, monkeypatch):
    main = pytest.importorskip("main")
    import subtitles
    style = {"style": "classic", "position": "custom", "position_y": 30, "font_size": 20, "font_name": "TikTok Sans",
             "font_color": "#FFFFFF", "border_color": "#000000", "border_width": 2, "bg_color": "#000000",
             "bg_opacity": 0.0, "horizontal_padding": 10, "bold": True, "max_chars": 20, "max_duration": 2.0}
    user_defaults.save(style, None)
    clip_path = tmp_path / "x_clip_1.mp4"
    clip_path.write_bytes(b"v")
    burns = []
    monkeypatch.setattr(subtitles, "_video_size", lambda p: (1080, 1920))
    monkeypatch.setattr(subtitles, "burn_subtitles", lambda video, sub, out, **kw: burns.append((sub, kw)))
    transcript = {"segments": [{"start": 0, "end": 1, "text": "hi", "words": [{"word": " hi", "start": 0, "end": 1}]}]}
    clip = {}
    out = main.auto_caption_clip(str(clip_path), transcript, 0, 1, split_ranges=[], clip=clip)
    assert out and burns[0][0].endswith(".srt")                    # classic -> SRT
    assert burns[0][1]["font_name"] == "TikTok Sans" and burns[0][1]["position_y"] == 30
    assert clip["caption_style"]["font_name"] == "TikTok Sans"      # recorded for later edits
    user_defaults.save(None, None)
    clip = {}
    main.auto_caption_clip(str(clip_path), transcript, 0, 1, split_ranges=[], clip=clip)
    assert burns[-1][0].endswith(".ass") and "caption_style" not in clip   # built-in look unchanged


def test_pipeline_hook_uses_saved_font_position_size_and_duration(store, tmp_path, monkeypatch):
    main = pytest.importorskip("main")
    import hooks
    user_defaults.save(None, {"style": "dark", "font": "tiktok", "position": "custom", "position_x": 10,
                              "position_y": 80, "size": "L", "duration_seconds": 7})
    monkeypatch.delenv("AUTO_HOOK_STYLE", raising=False)
    calls = []
    monkeypatch.setattr(hooks, "add_hook_to_video", lambda *a, **kw: calls.append(kw) or True)
    clip_path = tmp_path / "x_clip_1.mp4"
    clip_path.write_bytes(b"v")
    _, config = main.auto_hook_clip(str(clip_path), {"viral_hook_text": "Hi"})
    kw = calls[0]
    assert (kw["style"], kw["font"], kw["position"], kw["font_scale"], kw["duration"]) == ("dark", "tiktok", "custom", 1.3, 7.0)
    assert (kw["position_x"], kw["position_y"]) == (10, 80)
    assert config["font"] == "tiktok" and config["position"] == "custom"   # kept for rerenders
    monkeypatch.setenv("AUTO_HOOK_STYLE", "yellow")                     # the upload form's choice wins
    main.auto_hook_clip(str(clip_path), {"viral_hook_text": "Hi"})
    assert calls[-1]["style"] == "yellow" and calls[-1]["font"] == "tiktok"
