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
