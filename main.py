#!/usr/bin/env python3
import webview
import json
import os
import threading
import base64
import sys

from parser import parse_file, extract_pdf_word_boxes
from settings import Settings

WEB_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "web")

FILE_FILTERS = (
    "All Supported Documents (*.txt;*.pdf;*.docx;*.epub;*.html;*.htm;*.rtf;*.odt;*.md)",
    "Text Files (*.txt;*.md)",
    "PDF Documents (*.pdf)",
    "Word Documents (*.docx)",
    "EPUB Books (*.epub)",
    "HTML Files (*.html;*.htm)",
    "RTF Documents (*.rtf)",
    "ODT Documents (*.odt)",
)

AUDIO_FILTERS = ("Audio Files (*.mp3;*.wav;*.ogg;*.flac;*.m4a;*.aac)",)

MIME_MAP = {
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".flac": "audio/flac",
    ".m4a": "audio/mp4",
    ".aac": "audio/aac",
}


class Api:
    def __init__(self, app):
        self._app = app

    def handle_message(self, msg_json):
        try:
            msg = json.loads(msg_json)
            self._app.dispatch(msg)
        except Exception as e:
            print(f"Bridge error: {e}")


class AmoxpohualistliApp:
    def __init__(self):
        self.settings_handler = Settings()
        self.settings = self.settings_handler.load()
        self.current_words = []
        self.current_path = ""
        self.current_filename = ""
        self.current_page_starts = None
        self.current_page_dims = None
        self.current_page_boxes = None
        self._window = None

    def run(self):
        api = Api(self)
        index_path = "file://" + os.path.join(WEB_DIR, "index.html")
        self._window = webview.create_window(
            "Amoxpohualistli — Speed Reader",
            url=index_path,
            js_api=api,
            width=self.settings.get("window_width", 800),
            height=self.settings.get("window_height", 600),
            min_size=(400, 300),
            confirm_close=True,
        )
        self._window.events.closing += self._on_closing
        debug = os.environ.get("AMOX_DEBUG", "").lower() in ("1", "true", "yes")
        webview.start(private_mode=False, debug=debug)

    def _on_closing(self):
        try:
            fs = bool(self._window.fullscreen)
        except Exception:
            fs = False
        if not fs:
            try:
                w, h = self._window.size
                if w > 100 and h > 100:
                    self.settings["window_width"] = w
                    self.settings["window_height"] = h
            except Exception:
                pass
        self.settings_handler.save(self.settings)

    def send_js(self, data):
        js = f"window.__bridge_cb({json.dumps(data)})"
        if self._window:
            try:
                self._window.evaluate_js(js)
            except Exception as e:
                print(f"send_js error: {e}")

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

    def _pick_file(self, title, filters):
        result = self._window.create_file_dialog(
            webview.FileDialog.OPEN,
            allow_multiple=False,
            file_types=filters,
        )
        if result and len(result) > 0:
            return result[0]
        return None

    def cmd_open_file(self, data):
        path = self._pick_file("Open Document", FILE_FILTERS)
        if path and os.path.isfile(path):
            thread = threading.Thread(target=self._parse_thread, args=(path,))
            thread.daemon = True
            thread.start()

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
                page_starts = cached.get("page_starts")
                if page_starts is None and path.lower().endswith(".pdf"):
                    page_starts = self._recompute_page_starts(path)
                    cached["page_starts"] = page_starts
                    self.settings_handler.save_parsed_cache(
                        path, words, full_text, word_offsets, page_starts
                    )
            else:
                words, full_text, word_offsets, page_starts = parse_file(path)
                self.settings_handler.save_parsed_cache(
                    path, words, full_text, word_offsets, page_starts
                )

            self.current_words = words
            self.current_full_text = full_text
            self.current_word_offsets = word_offsets
            self.current_page_starts = page_starts
            self.current_page_dims = None
            self.current_page_boxes = None
            self.current_path = path
            self.current_filename = os.path.basename(path)

            # For PDFs, kick off thumbnail+box rendering in background
            if page_starts and path.lower().endswith(".pdf"):
                thread = threading.Thread(
                    target=self._render_thumbnails_and_boxes, args=(path,)
                )
                thread.daemon = True
                thread.start()

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
                            "page_starts": self.current_page_starts,
                            "page_count": len(self.current_page_starts) if self.current_page_starts else 0,
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
                            "page_starts": self.current_page_starts,
                            "page_count": len(self.current_page_starts) if self.current_page_starts else 0,
                            "filename": self.current_filename,
                            "path": path,
                            "word_count": len(words),
                            "load_complete": False,
                        },
                    }
                )
        except Exception as e:
            self.send_js(
                {"type": "error", "data": {"message": f"Failed to parse file: {e}"}}
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
                mime = MIME_MAP.get(ext, "audio/mpeg")
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
        path = self._pick_file("Select Audio File", AUDIO_FILTERS)
        if path:
            self.cmd_load_audio_file({"path": path})

    def cmd_get_state(self, data):
        self.send_js(
            {
                "type": "state",
                "data": {
                    "words": self.current_words,
                    "full_text": getattr(self, "current_full_text", ""),
                    "word_offsets": getattr(self, "current_word_offsets", []),
                    "page_starts": self.current_page_starts,
                    "page_count": len(self.current_page_starts) if self.current_page_starts else 0,
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

    def _recompute_page_starts(self, path):
        try:
            from parser import _parse_pdf_pages
            _, _, _, page_starts = _parse_pdf_pages(path)
            return page_starts
        except Exception:
            return None

    def cmd_get_full_text(self, data):
        path = data.get("path", "")
        if path and path == self.current_path:
            self.send_js(
                {
                    "type": "full_text_loaded",
                    "data": {
                        "full_text": getattr(self, "current_full_text", ""),
                        "word_offsets": getattr(self, "current_word_offsets", []),
                        "page_starts": self.current_page_starts,
                        "page_count": len(self.current_page_starts) if self.current_page_starts else 0,
                    },
                }
            )

    def _render_thumbnails_and_boxes(self, path):
        try:
            import fitz
            doc = fitz.open(path)

            ps = self.current_page_starts
            if not ps:
                doc.close()
                return

            boxes, dims = extract_pdf_word_boxes(path, ps, self.current_words)
            self.current_page_boxes = boxes
            self.current_page_dims = dims

            THUMB_WIDTH = 120
            BATCH = 15
            thumb_batch = []
            batch_dims = []
            batch_start = 0
            sent = 0

            for page_num in range(len(ps)):
                if page_num >= len(doc):
                    break
                page = doc[page_num]
                pw = page.rect.width
                mat = fitz.Matrix(THUMB_WIDTH / pw, THUMB_WIDTH / pw)
                pix = page.get_pixmap(matrix=mat)
                b64 = base64.b64encode(pix.tobytes("png")).decode()

                thumb_batch.append(b64)
                batch_dims.append([pw, page.rect.height])
                sent += 1

                if len(thumb_batch) >= BATCH or page_num == len(ps) - 1:
                    self.send_js({
                        "type": "thumbnails_batch",
                        "data": {
                            "start_page": batch_start,
                            "images": thumb_batch,
                            "dims": batch_dims,
                            "total": len(ps),
                        }
                    })
                    thumb_batch = []
                    batch_dims = []
                    batch_start = page_num + 1

            doc.close()

            self.send_js({
                "type": "thumbnails_done",
                "data": {"total": sent}
            })

            # Send word boxes for pixel-to-word mapping
            if boxes:
                self.send_js({
                    "type": "page_boxes",
                    "data": {"boxes": boxes}
                })
        except Exception as e:
            self.send_js({
                "type": "error",
                "data": {"message": f"Thumbnail error: {e}"}
            })


if __name__ == "__main__":
    app = AmoxpohualistliApp()
    app.run()
