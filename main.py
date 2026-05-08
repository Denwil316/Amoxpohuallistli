#!/usr/bin/env python3
import gi

gi.require_version("Gtk", "3.0")
gi.require_version("WebKit2", "4.1")
from gi.repository import Gtk, WebKit2, GLib
import json
import os
import threading
import base64

from parser import parse_file
from settings import Settings

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")


class AmoxpohualistliApp:
    def __init__(self):
        self.settings_handler = Settings()
        self.settings = self.settings_handler.load()
        self.current_words = []
        self.current_path = ""
        self.current_filename = ""

        self.window = Gtk.Window(title="Amoxpohualistli — Speed Reader")
        self.window.set_default_size(
            self.settings.get("window_width", 800),
            self.settings.get("window_height", 600),
        )
        self.window.set_position(Gtk.WindowPosition.CENTER)
        self.window.connect("delete-event", self.on_delete_event)
        self.window.connect("destroy", Gtk.main_quit)
        self.window.connect("configure-event", self.on_window_configure)

        scrolled = Gtk.ScrolledWindow()
        self.window.add(scrolled)

        self.webview = WebKit2.WebView()
        scrolled.add(self.webview)

        ws = self.webview.get_settings()
        ws.props.enable_javascript = True
        ws.props.enable_developer_extras = True

        self.ucm = self.webview.get_user_content_manager()
        self.ucm.register_script_message_handler("deepsite")
        self.ucm.connect("script-message-received::deepsite", self.on_message)

        index_path = "file://" + os.path.join(WEB_DIR, "index.html")
        self.webview.load_uri(index_path)

        self.window.show_all()

    def on_window_configure(self, widget, event):
        if not self.window.is_maximized():
            w, h = self.window.get_size()
            if w > 100 and h > 100:
                self.settings["window_width"] = w
                self.settings["window_height"] = h

    def on_delete_event(self, widget, event):
        self.settings_handler.save(self.settings)
        return False

    def on_message(self, ucm, js_result):
        val = js_result.get_js_value()
        if val.is_string():
            try:
                msg = json.loads(val.to_string())
                self.dispatch(msg)
            except Exception as e:
                print(f"Bridge error: {e}")

    def dispatch(self, msg):
        msg_type = msg.get("type", "")
        data = msg.get("data", {})
        handler_map = {
            "open_file": self.cmd_open_file,
            "parse_path": self.cmd_parse_path,
            "load_settings": self.cmd_load_settings,
            "save_settings": self.cmd_save_settings,
            "load_audio_file": self.cmd_load_audio_file,
            "pick_audio_file": self.cmd_pick_audio_file,
            "get_state": self.cmd_get_state,
            "get_history": self.cmd_get_history,
            "update_history": self.cmd_update_history,
            "clear_history": self.cmd_clear_history,
            "get_full_text": self.cmd_get_full_text,
        }
        handler = handler_map.get(msg_type)
        if handler:
            handler(data)

    def send_js(self, data):
        js = f"window.__bridge_cb({json.dumps(data)})"
        GLib.idle_add(
            self.webview.evaluate_javascript, js, -1, None, None, None, None, None
        )

    def cmd_open_file(self, data):
        dialog = Gtk.FileChooserDialog(
            title="Open Document",
            parent=self.window,
            action=Gtk.FileChooserAction.OPEN,
            buttons=("_Cancel", Gtk.ResponseType.CANCEL, "_Open", Gtk.ResponseType.OK),
        )

        filter_all = Gtk.FileFilter()
        filter_all.set_name("All Supported Documents")
        filter_all.add_mime_type("text/plain")
        filter_all.add_pattern("*.txt")
        filter_all.add_pattern("*.pdf")
        filter_all.add_pattern("*.docx")
        filter_all.add_pattern("*.epub")
        filter_all.add_pattern("*.html")
        filter_all.add_pattern("*.htm")
        filter_all.add_pattern("*.rtf")
        filter_all.add_pattern("*.odt")
        filter_all.add_pattern("*.md")
        dialog.add_filter(filter_all)

        filter_txt = Gtk.FileFilter()
        filter_txt.set_name("Text Files")
        filter_txt.add_mime_type("text/plain")
        filter_txt.add_pattern("*.txt")
        filter_txt.add_pattern("*.md")
        dialog.add_filter(filter_txt)

        filter_pdf = Gtk.FileFilter()
        filter_pdf.set_name("PDF Documents")
        filter_pdf.add_mime_type("application/pdf")
        filter_pdf.add_pattern("*.pdf")
        dialog.add_filter(filter_pdf)

        if dialog.run() == Gtk.ResponseType.OK:
            path = dialog.get_filename()
            dialog.destroy()
            thread = threading.Thread(target=self._parse_thread, args=(path,))
            thread.daemon = True
            thread.start()
        else:
            dialog.destroy()

    def cmd_parse_path(self, data):
        path = data.get("path", "")
        if path and os.path.isfile(path):
            thread = threading.Thread(target=self._parse_thread, args=(path,))
            thread.daemon = True
            thread.start()

    def _parse_thread(self, path):
        try:
            cached = self.settings_handler.load_parsed_cache(path)
            if cached:
                words = cached["words"]
                full_text = cached["full_text"]
                word_offsets = cached["word_offsets"]
            else:
                words, full_text, word_offsets = parse_file(path)
                self.settings_handler.save_parsed_cache(
                    path, words, full_text, word_offsets
                )

            self.current_words = words
            self.current_full_text = full_text
            self.current_word_offsets = word_offsets
            self.current_path = path
            self.current_filename = os.path.basename(path)

            CHUNK_SIZE = 5000
            if len(words) > CHUNK_SIZE:
                meta = {
                    "filename": self.current_filename,
                    "path": path,
                    "word_count": len(words),
                    "chunk_count": (len(words) + CHUNK_SIZE - 1) // CHUNK_SIZE,
                }
                self.send_js({"type": "file_start", "data": meta})
                for i in range(0, len(words), CHUNK_SIZE):
                    chunk = words[i : i + CHUNK_SIZE]
                    self.send_js(
                        {
                            "type": "file_chunk",
                            "data": {"chunk": chunk, "index": i, "total": len(words)},
                        }
                    )
                self.send_js(
                    {
                        "type": "file_loaded",
                        "data": {
                            "words": [],
                            "full_text": full_text,
                            "word_offsets": word_offsets,
                            "filename": self.current_filename,
                            "path": path,
                            "word_count": len(words),
                            "load_complete": True,
                        },
                    }
                )
            else:
                self.send_js(
                    {
                        "type": "file_loaded",
                        "data": {
                            "words": words,
                            "full_text": full_text,
                            "word_offsets": word_offsets,
                            "filename": self.current_filename,
                            "path": path,
                            "word_count": len(words),
                            "load_complete": False,
                        },
                    }
                )
        except Exception as e:
            GLib.idle_add(
                self.send_js,
                {"type": "error", "data": {"message": f"Failed to parse file: {e}"}},
            )

    def cmd_load_settings(self, data):
        self.settings = self.settings_handler.load()
        self.send_js({"type": "settings_loaded", "data": self.settings})

    def cmd_save_settings(self, data):
        self.settings.update(data)
        self.settings_handler.save(self.settings)
        self.send_js({"type": "settings_saved", "data": self.settings})

    def cmd_load_audio_file(self, data):
        path = data.get("path", "")
        if path and os.path.isfile(path):
            try:
                with open(path, "rb") as f:
                    b64 = base64.b64encode(f.read()).decode()
                ext = os.path.splitext(path)[1].lower()
                mime_map = {
                    ".mp3": "audio/mpeg",
                    ".wav": "audio/wav",
                    ".ogg": "audio/ogg",
                    ".flac": "audio/flac",
                    ".m4a": "audio/mp4",
                    ".aac": "audio/aac",
                }
                mime = mime_map.get(ext, "audio/mpeg")
                self.send_js(
                    {
                        "type": "audio_file_loaded",
                        "data": {
                            "content": b64,
                            "mime": mime,
                            "name": os.path.basename(path),
                        },
                    }
                )
            except Exception as e:
                self.send_js({"type": "error", "data": {"message": str(e)}})

    def cmd_pick_audio_file(self, data):
        dialog = Gtk.FileChooserDialog(
            title="Select Audio File",
            parent=self.window,
            action=Gtk.FileChooserAction.OPEN,
            buttons=("_Cancel", Gtk.ResponseType.CANCEL, "_Open", Gtk.ResponseType.OK),
        )
        filter_audio = Gtk.FileFilter()
        filter_audio.set_name("Audio Files")
        filter_audio.add_mime_type("audio/mpeg")
        filter_audio.add_mime_type("audio/wav")
        filter_audio.add_mime_type("audio/ogg")
        filter_audio.add_mime_type("audio/flac")
        filter_audio.add_pattern("*.mp3")
        filter_audio.add_pattern("*.wav")
        filter_audio.add_pattern("*.ogg")
        filter_audio.add_pattern("*.flac")
        filter_audio.add_pattern("*.m4a")
        dialog.add_filter(filter_audio)

        if dialog.run() == Gtk.ResponseType.OK:
            path = dialog.get_filename()
            dialog.destroy()
            self.cmd_load_audio_file({"path": path})
        else:
            dialog.destroy()

    def cmd_get_state(self, data):
        self.send_js(
            {
                "type": "state",
                "data": {
                    "words": self.current_words,
                    "full_text": getattr(self, "current_full_text", ""),
                    "word_offsets": getattr(self, "current_word_offsets", []),
                    "filename": self.current_filename,
                    "path": self.current_path,
                    "word_count": len(self.current_words),
                },
            }
        )

    def cmd_get_history(self, data):
        entries = self.settings_handler.load_history()
        self.send_js({"type": "history_list", "data": entries})

    def cmd_clear_history(self, data):
        entries = self.settings_handler.clear_history()
        self.send_js({"type": "history_list", "data": entries})

    def cmd_update_history(self, data):
        entries = self.settings_handler.update_history(
            name=data.get("name", ""),
            path=data.get("path", ""),
            total_words=data.get("total_words", 0),
            words_read=data.get("words_read", 0),
            avg_speed=data.get("avg_speed", 0),
            percent_read=data.get("percent_read", 0),
        )
        self.send_js({"type": "history_list", "data": entries})

    def cmd_get_full_text(self, data):
        path = data.get("path", "")
        if path and path == self.current_path:
            self.send_js(
                {
                    "type": "full_text_loaded",
                    "data": {
                        "full_text": getattr(self, "current_full_text", ""),
                        "word_offsets": getattr(self, "current_word_offsets", []),
                    },
                }
            )

    def run(self):
        Gtk.main()


if __name__ == "__main__":
    app = AmoxpohualistliApp()
    app.run()
