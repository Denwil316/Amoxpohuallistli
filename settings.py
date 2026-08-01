import copy
import json
import os
import sys
import time
import hashlib


def _get_config_dir():
    if sys.platform == "win32":
        base = os.environ.get("APPDATA", os.path.expanduser("~"))
    elif sys.platform == "darwin":
        base = os.path.join(os.path.expanduser("~"), "Library", "Application Support")
    else:
        base = os.path.expanduser("~/.config")
    return os.path.join(base, "deepsite")


CONFIG_DIR = _get_config_dir()
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
AUDIO_DIR = os.path.join(CONFIG_DIR, "audio")
CACHE_DIR = os.path.join(CONFIG_DIR, "cache")
HISTORY_FILE = os.path.join(CONFIG_DIR, "history.json")
MAX_HISTORY = 50
CACHE_SCHEMA_VERSION = 3
MAX_CACHE_FILES = 50
NESTED_SETTINGS_KEYS = {"keyboard_shortcuts", "color_palettes"}

DEFAULT_PALETTE = {
    "Default": {
        "background": "#ECF4E8",
        "secondary": "#CBF3BB",
        "primary": "#ABE7B2",
        "accent": "#93BFC7",
        "statBg": "#FFFFFF",
        "statText": "#2563EB",
        "statLabel": "#6B7280",
    }
}

DEFAULT_SETTINGS = {
    "highlight_start": 0,
    "highlight_length": 1,
    "bold_option": "orp",
    "speed": 300,
    "font_family": "Inter, system-ui, -apple-system, sans-serif",
    "font_size": 72,
    "text_color": "#2C3E50",
    "background_color": "#ECF4E8",
    "secondary_color": "#CBF3BB",
    "primary_color": "#ABE7B2",
    "accent_color": "#93BFC7",
    "sound_enabled": True,
    "sound_tick": "",
    "sound_start": "",
    "sound_end": "",
    "sound_volume": 0.5,
    "orp_indicator": True,
    "window_width": 800,
    "window_height": 600,
    "keyboard_shortcuts": {
        "play_pause": "p",
        "speed_up": "ArrowUp",
        "speed_down": "ArrowDown",
        "seek_forward": "ArrowRight",
        "seek_backward": "ArrowLeft",
        "seek_forward_fast": "Shift+ArrowRight",
        "seek_backward_fast": "Shift+ArrowLeft",
        "open_file": "o",
        "toggle_settings": "s",
        "toggle_docviewer": "d",
        "reset_position": "r",
    },
    "color_palettes": DEFAULT_PALETTE,
    "current_palette": "Default",
    "orp_enabled": True,
    "pause_on_punctuation": True,
    "punctuation_pause_multiplier": 3,
    "comma_pause_multiplier": 2,
    "word_length_wpm_multiplier": 8,
    "pause_after_words": 0,
    "pause_duration": 500,
    "fade_enabled": True,
    "fade_duration": 150,
    "frame_word_count": 1,
}


def _atomic_write(path, data):
    tmp = path + ".tmp"
    try:
        with open(tmp, "w") as f:
            json.dump(data, f, indent=2)
        os.replace(tmp, path)
    except Exception:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _deep_merge(base, override):
    for key, value in override.items():
        if key in NESTED_SETTINGS_KEYS and isinstance(value, dict) and isinstance(base.get(key), dict):
            base[key].update(value)
        else:
            base[key] = value


def _evict_cache():
    try:
        files = [os.path.join(CACHE_DIR, f) for f in os.listdir(CACHE_DIR) if f.endswith(".json")]
        if len(files) > MAX_CACHE_FILES:
            files.sort(key=lambda f: os.path.getmtime(f))
            for f in files[: len(files) - MAX_CACHE_FILES]:
                try:
                    os.unlink(f)
                except OSError:
                    pass
    except OSError:
        pass


class Settings:
    @staticmethod
    def ensure_dir():
        os.makedirs(CONFIG_DIR, exist_ok=True)
        os.makedirs(AUDIO_DIR, exist_ok=True)
        os.makedirs(CACHE_DIR, exist_ok=True)

    @staticmethod
    def load():
        Settings.ensure_dir()
        try:
            with open(CONFIG_FILE) as f:
                settings = json.load(f)
                merged = copy.deepcopy(DEFAULT_SETTINGS)
                _deep_merge(merged, settings)
                return merged
        except (FileNotFoundError, json.JSONDecodeError):
            return copy.deepcopy(DEFAULT_SETTINGS)

    @staticmethod
    def save(settings):
        Settings.ensure_dir()
        _atomic_write(CONFIG_FILE, settings)

    @staticmethod
    def get_audio_dir():
        Settings.ensure_dir()
        return AUDIO_DIR

    @staticmethod
    def _path_hash(file_path):
        return hashlib.sha256(file_path.encode()).hexdigest()[:16]

    @staticmethod
    def get_cache_path(file_path):
        return os.path.join(CACHE_DIR, Settings._path_hash(file_path) + ".json")

    @staticmethod
    def save_parsed_cache(file_path, words, full_text, word_offsets, page_starts=None):
        Settings.ensure_dir()
        cache = {
            "schema_version": CACHE_SCHEMA_VERSION,
            "file_path": file_path,
            "file_mtime": os.path.getmtime(file_path),
            "words": words,
            "full_text": full_text,
            "word_offsets": word_offsets,
            "page_starts": page_starts,
            "word_count": len(words),
            "cached_at": time.time(),
        }
        cache_path = Settings.get_cache_path(file_path)
        _atomic_write(cache_path, cache)
        _evict_cache()

    @staticmethod
    def load_parsed_cache(file_path):
        try:
            cache_path = Settings.get_cache_path(file_path)
            with open(cache_path) as f:
                cache = json.load(f)
            if cache.get("schema_version") != CACHE_SCHEMA_VERSION:
                return None
            if cache.get("file_mtime") == os.path.getmtime(file_path):
                return cache
        except (FileNotFoundError, json.JSONDecodeError, OSError):
            pass
        return None

    @staticmethod
    def load_history():
        Settings.ensure_dir()
        try:
            with open(HISTORY_FILE) as f:
                return json.load(f)
        except (FileNotFoundError, json.JSONDecodeError):
            return []

    @staticmethod
    def save_history(entries):
        Settings.ensure_dir()
        _atomic_write(HISTORY_FILE, entries)

    @staticmethod
    def clear_history():
        Settings.save_history([])
        return []

    @staticmethod
    def update_history(name, path, total_words, words_read, avg_speed, percent_read, position=0):
        entries = Settings.load_history()
        now = time.strftime("%Y-%m-%d %H:%M")
        found = False
        for e in entries:
            if e.get("path") == path:
                e["words_read"] = max(e.get("words_read", 0), words_read)
                e["avg_speed"] = avg_speed
                e["percent_read"] = round(percent_read, 1)
                e["last_date"] = now
                e["total_words"] = total_words
                e["position"] = position
                found = True
                break
        if not found:
            entries.insert(
                0,
                {
                    "name": name,
                    "path": path,
                    "total_words": total_words,
                    "words_read": max(0, words_read),
                    "avg_speed": avg_speed,
                    "percent_read": round(percent_read, 1),
                    "last_date": now,
                    "position": position,
                },
            )
        if len(entries) > MAX_HISTORY:
            entries = entries[:MAX_HISTORY]
        Settings.save_history(entries)
        return entries
