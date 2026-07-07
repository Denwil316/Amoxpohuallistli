import os
import re


def parse_file(path):
    """Returns (words, full_text, word_offsets, page_starts).
    page_starts is a list of word indices (one per page with content)
    for PDFs, or None for other formats.
    """
    ext = os.path.splitext(path)[1].lower()

    if ext == ".pdf":
        return _parse_pdf_pages(path)

    parsers = {
        ".txt": parse_txt,
        ".pdf": parse_pdf,
        ".docx": parse_docx,
        ".epub": parse_epub,
        ".html": parse_html,
        ".htm": parse_html,
        ".rtf": parse_rtf,
        ".odt": parse_odt,
        ".md": parse_txt,
        ".csv": parse_txt,
        ".xml": parse_txt,
        ".json": parse_txt,
    }
    parser = parsers.get(ext, parse_txt_raw)
    raw = parser(path)
    text = clean_text(raw)
    words, offsets = tokenize_with_offsets(text)
    return words, text, offsets, None


def _parse_pdf_pages(path):
    """Parse PDF page by page, returning consistent words + page_starts."""
    import fitz
    doc = fitz.open(path)

    per_page_cleaned = []
    for page in doc:
        raw = page.get_text()
        if raw.strip():
            cleaned = clean_text(raw)
            if cleaned:
                per_page_cleaned.append(cleaned)

    full_text = "\n".join(per_page_cleaned)
    words, offsets = tokenize_with_offsets(full_text)

    page_starts = []
    word_idx = 0
    for cleaned in per_page_cleaned:
        count = len(re.findall(r"\S+", cleaned))
        if count > 0:
            page_starts.append(word_idx)
            word_idx += count

    return words, full_text, offsets, page_starts


def clean_text(text):
    # 1. Join hyphenated words broken across lines
    text = re.sub(r"(\w)-\n(\w)", r"\1\2", text)

    lines = text.split("\n")

    # 2. Remove isolated page numbers (lines that are just digits)
    lines = [l for l in lines if not re.match(r"^\s*\d+\s*$", l)]

    # 3. Remove common TOC entries: "text ...... 123" or "text   123"
    cleaned = []
    for l in lines:
        stripped = l.strip()
        if not stripped:
            cleaned.append("")
            continue
        if re.search(r"\s[\.\s]{8,}\s\d+$", stripped):
            continue
        cleaned.append(l)
    lines = cleaned

    # 4. Detect and reorder multi-column layout
    col_left = []
    col_right = []
    single = []
    col_count = 0
    gap_re = re.compile(r"  {4,}")
    for l in lines:
        m = gap_re.search(l)
        if m and len(l) > 40:
            mid = m.start() + (m.end() - m.start()) // 2
            left = l[:mid].strip()
            right = l[mid:].strip()
            if left and right and len(left) > 10 and len(right) > 10:
                col_left.append(left)
                col_right.append(right)
                col_count += 1
                continue
        single.append(l)

    if col_count > 3:
        text = (
            "\n".join(single) + "\n" + "\n".join(col_left) + "\n" + "\n".join(col_right)
        )
    else:
        text = "\n".join(lines)

    # 5. Fix missing spaces from PDF extraction
    # Insert space at lowercase->uppercase boundaries (e.g., "yTHE" -> "y THE")
    text = re.sub(r"(?<=[a-záéíóúüñ])(?=[A-ZÁÉÍÓÚÜÑ])", " ", text)
    text = re.sub(r"(?<=\d)(?=[A-Za-záéíóúüñÁÉÍÓÚÜÑ])", " ", text)

    # 6. Split words at double-hyphen/em-dash for RSVP readability
    # Attach dash to the right-side word so it appears on the left when reading
    text = re.sub(r"--(\S)", r" --\1", text)
    text = re.sub(r"—(\S)", r" —\1", text)

    # 7. Normalize whitespace (preserve paragraph breaks)
    text = re.sub(r"\r\n?", "\n", text)
    text = re.sub(r"\n{4,}", "\n\n\n", text)
    text = re.sub(r"[ \t]+", " ", text)

    return text.strip()


def tokenize_with_offsets(text):
    words = []
    offsets = []
    for m in re.finditer(r"\S+", text):
        words.append(m.group())
        offsets.append([m.start(), m.end()])
    return words, offsets


def extract_pdf_word_boxes(path, page_starts, words):
    """Return (page_dims, page_boxes) with bounding boxes aligned to cleaned words.

    page_dims: [[width, height], ...] per page with content
    page_boxes: [[x0, y0, x1, y1, word_idx], ...] per page
    Only processes pages that have text content (matching _parse_pdf_pages).
    """
    import fitz
    doc = fitz.open(path)
    page_dims = []
    page_boxes = []
    content_page = 0  # index into page_starts

    for page_num, page in enumerate(doc):
        raw_text = page.get_text()
        if not raw_text.strip():
            continue

        if content_page >= len(page_starts):
            break

        pw, ph = page.rect.width, page.rect.height
        page_dims.append([pw, ph])

        raw_entries = page.get_text("words")
        start_wi = page_starts[content_page]
        end_wi = page_starts[content_page + 1] if content_page + 1 < len(page_starts) else len(words)
        page_words = words[start_wi:end_wi]

        boxes = _align_raw_to_cleaned(raw_entries, page_words, start_wi)
        page_boxes.append(boxes)
        content_page += 1

    doc.close()
    return page_dims, page_boxes


def _align_raw_to_cleaned(raw_entries, cleaned_page_words, start_wi):
    """Align raw PDF word entries to cleaned word list.
    Handles clean_text transformations: --split, hyphen join, case splits."""
    boxes = []
    if not raw_entries or not cleaned_page_words:
        return boxes

    ri = 0
    for ci, cw in enumerate(cleaned_page_words):
        cw_clean = cw.strip(".,;:!?\"'()[]{}<>")
        if not cw_clean:
            continue

        matched = False
        while ri < len(raw_entries):
            raw_text = raw_entries[ri][4]
            raw_clean = raw_text.strip(".,;:!?\"'()[]{}<>")

            if not raw_clean:
                ri += 1
                continue

            # Exact match (after stripping punctuation)
            if raw_clean == cw_clean:
                e = raw_entries[ri]
                boxes.append([e[0], e[1], e[2], e[3], start_wi + ci])
                ri += 1
                matched = True
                break

            # Handle --/— split: raw word contains -- which clean_text splits
            # e.g., raw "self--aware" → cleaned ["self", "--aware"]
            if "--" in raw_text or "—" in raw_text:
                parts = []
                for sep in ["--", "—"]:
                    if sep in raw_text:
                        before, after = raw_text.split(sep, 1)
                        parts = [before.strip(".,;:!?\"'()"), sep + after.strip(".,;:!?\"'()")]
                        break
                for pi, part in enumerate(parts):
                    part_clean = part.strip(".,;:!?\"'()[]{}<>")
                    if part_clean == cw_clean:
                        e = raw_entries[ri]
                        boxes.append([e[0], e[1], e[2], e[3], start_wi + ci])
                        if pi < len(parts) - 1:
                            ri += 1  # consume extra parts
                        matched = True
                        break
                if matched:
                    ri += 1
                    break

            # Handle hyphenation join: raw has word-ending hyphen, clean has joined word
            # raw: ["conti-", "nue"], clean: ["conti-nue"] or ["continué"]
            if raw_clean.endswith("-") and ri + 1 < len(raw_entries):
                next_raw = raw_entries[ri + 1][4].strip(".,;:!?\"'()")
                joined = raw_clean[:-1] + next_raw
                if joined == cw_clean:
                    # Use union of both bounding boxes
                    e1, e2 = raw_entries[ri], raw_entries[ri + 1]
                    boxes.append([min(e1[0], e2[0]), min(e1[1], e2[1]),
                                  max(e1[2], e2[2]), max(e1[3], e2[3]), start_wi + ci])
                    ri += 2
                    matched = True
                    break

            # Handle lowercase→uppercase split: clean_text inserts space
            # raw: "yTHE" → cleaned: "y" + "THE"
            # Check if raw word starts with the cleaned word prefix
            if cw_clean and raw_clean.startswith(cw_clean):
                e = raw_entries[ri]
                boxes.append([e[0], e[1], e[2], e[3], start_wi + ci])
                # Don't advance ri — remaining raw text may match next cleaned word
                matched = True
                break

            # Handle the reverse: cleaned word is inside raw word
            if cw_clean in raw_clean and len(cw_clean) > 2:
                e = raw_entries[ri]
                boxes.append([e[0], e[1], e[2], e[3], start_wi + ci])
                matched = True
                break

            # Raw word is just a digit (page number) or short noise — skip it
            if raw_clean.isdigit() and len(raw_clean) <= 4:
                ri += 1
                continue

            # No match — try next raw entry
            ri += 1

        if not matched:
            # Approximate from last known position
            if boxes:
                last = boxes[-1]
                approx = [last[0], last[3], last[2] + 15, last[3] + 11, start_wi + ci]
                boxes.append(approx)
            else:
                boxes.append([0, 0, 20, 10, start_wi + ci])

    return boxes


def extract_page_starts(path):
    """Return list of word indices where each page starts, or None if not a PDF."""
    import os
    ext = os.path.splitext(path)[1].lower()
    if ext != ".pdf":
        return None
    import fitz
    doc = fitz.open(path)
    page_starts = []
    word_idx = 0
    for page in doc:
        raw = page.get_text()
        if not raw.strip():
            continue
        cleaned = clean_text(raw)
        count = len(re.findall(r"\S+", cleaned))
        if count > 0:
            page_starts.append(word_idx)
            word_idx += count
    return page_starts


def parse_txt(path):
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return f.read()


def parse_txt_raw(path):
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as f:
            raw = f.read()
        if len(raw) > 100:
            return raw
        with open(path, "rb") as f:
            raw = f.read().decode("utf-8", errors="replace")
        return raw
    except Exception:
        return ""


def parse_pdf(path):
    import fitz

    doc = fitz.open(path)
    return "\n".join(page.get_text() for page in doc)


def parse_docx(path):
    from docx import Document

    doc = Document(path)
    return "\n".join(p.text for p in doc.paragraphs)


def parse_epub(path):
    import ebooklib
    from ebooklib import epub
    from bs4 import BeautifulSoup

    book = epub.read_epub(path)
    texts = []
    for item in book.get_items():
        if item.get_type() == ebooklib.ITEM_DOCUMENT:
            soup = BeautifulSoup(item.get_content(), "html.parser")
            texts.append(soup.get_text())
    return "\n".join(texts)


def parse_html(path):
    from bs4 import BeautifulSoup

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        soup = BeautifulSoup(f.read(), "html.parser")
        for tag in soup(["script", "style", "nav", "footer", "header", "aside"]):
            tag.decompose()
        return soup.get_text(separator=" ")


def parse_rtf(path):
    from striprtf.striprtf import rtf_to_text

    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return rtf_to_text(f.read())


def parse_odt(path):
    import zipfile
    from xml.etree import ElementTree

    with zipfile.ZipFile(path) as z:
        content = z.read("content.xml")
        root = ElementTree.fromstring(content)
        ns = {"text": "urn:oasis:names:tc:opendocument:xmlns:text:1.0"}
        texts = []
        for p in root.iter("{urn:oasis:names:tc:opendocument:xmlns:text:1.0}p"):
            texts.append("".join(p.itertext()))
        return "\n".join(texts)
