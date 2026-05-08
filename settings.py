import json
import os
import time
import hashlib

CONFIG_DIR = os.path.expanduser("~/.config/deepsite")
CONFIG_FILE = os.path.join(CONFIG_DIR, "config.json")
AUDIO_DIR = os.path.join(CONFIG_DIR, "audio")
CACHE_DIR = os.path.join(CONFIG_DIR, "cache")
HISTORY_FILE = os.path.join(CONFIG_DIR, "history.json")
MAX_HISTORY = 50

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
        "play_pause": "Space",
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
    "punctuation_pause_multiplier": 2,
    "word_length_wpm_multiplier": 5,
    "pause_after_words": 0,
    "pause_duration": 500,
    "fade_enabled": True,
    "fade_duration": 150,
    "frame_word_count": 1,
}


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
                merged = DEFAULT_SETTINGS.copy()
                merged.update(settings)
                return merged
        except (FileNotFoundError, json.JSONDecodeError):
            return DEFAULT_SETTINGS.copy()

    @staticmethod
    def save(settings):
        Settings.ensure_dir()
        with open(CONFIG_FILE, "w") as f:
            json.dump(settings, f, indent=2)

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
    def save_parsed_cache(file_path, words, full_text, word_offsets):
        Settings.ensure_dir()
        cache = {
            "file_path": file_path,
            "file_mtime": os.path.getmtime(file_path),
            "words": words,
            "full_text": full_text,
            "word_offsets": word_offsets,
            "word_count": len(words),
            "cached_at": time.time(),
        }
        with open(Settings.get_cache_path(file_path), "w") as f:
            json.dump(cache, f, indent=2)

    @staticmethod
    def load_parsed_cache(file_path):
        try:
            cache_path = Settings.get_cache_path(file_path)
            with open(cache_path) as f:
                cache = json.load(f)
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
        with open(HISTORY_FILE, "w") as f:
            json.dump(entries, f, indent=2)

    @staticmethod
    def clear_history():
        Settings.save_history([])
        return []

    @staticmethod
    def update_history(name, path, total_words, words_read, avg_speed, percent_read):
        entries = Settings.load_history()
        now = time.strftime("%Y-%m-%d %H:%M")
        found = False
        for e in entries:
            if e.get("path") == path:
                e["words_read"] = words_read
                e["avg_speed"] = avg_speed
                e["percent_read"] = round(percent_read, 1)
                e["last_date"] = now
                e["total_words"] = total_words
                found = True
                break
        if not found:
            entries.insert(
                0,
                {
                    "name": name,
                    "path": path,
                    "total_words": total_words,
                    "words_read": words_read,
                    "avg_speed": avg_speed,
                    "percent_read": round(percent_read, 1),
                    "last_date": now,
                },
            )
        if len(entries) > MAX_HISTORY:
            entries = entries[:MAX_HISTORY]
        Settings.save_history(entries)
        return entries
