import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from parser import (
    clean_text,
    tokenize_with_offsets,
    parse_file,
    _reorder_columns,
    _interleave_columns,
)


class TestCleanText:
    def test_non_pdf_does_not_corrupt_camelcase(self):
        """McDonald debe permanecer intacto sin from_pdf."""
        text = "McDonald y iPhone son marcas conocidas."
        result = clean_text(text, from_pdf=False)
        assert "McDonald" in result
        assert "iPhone" in result
        assert "Mc Donald" not in result
        assert "i Phone" not in result

    def test_non_pdf_does_not_corrupt_number_letter(self):
        """3D no debe partirse en '3 D' sin from_pdf."""
        text = "La pelicula 3D se estreno en 2023."
        result = clean_text(text, from_pdf=False)
        assert "3D" in result
        assert "3 D" not in result

    def test_non_pdf_preserves_isolated_numbers(self):
        """Lineas con solo numeros deben conservarse en txt (p.ej. anos, listas)."""
        text = "Capitulo\n42\nContinua."
        result = clean_text(text, from_pdf=False)
        assert "42" in result.split("\n")

    def test_pdf_removes_page_numbers(self):
        """from_pdf=True debe eliminar lineas de solo digitos."""
        text = "Introduccion\n42\nEl metodo."
        result = clean_text(text, from_pdf=True)
        lines = result.split("\n")
        assert "42" not in [l.strip() for l in lines]

    def test_pdf_removes_toc_entries(self):
        """from_pdf=True debe eliminar entradas de indice."""
        text = "Capitulo 1 ......... 42\nTexto real."
        result = clean_text(text, from_pdf=True)
        assert "Capitulo 1" not in result
        assert "Texto real" in result

    def test_pdf_fixes_missing_space_camelcase(self):
        """from_pdf=True inserta espacio entre minuscula y mayuscula."""
        text = "El metodoTHE fue usado."
        result = clean_text(text, from_pdf=True)
        assert "metodo THE" in result

    def test_pdf_fixes_missing_space_digit_letter(self):
        """from_pdf=True inserta espacio entre digito y letra."""
        text = "Ley5G aprobada."
        result = clean_text(text, from_pdf=True)
        assert "5 G" in result

    def test_hyphen_join_both_modes(self):
        """Union de guiones al final de linea funciona en ambos modos."""
        text = "conti-\nnuacion normal."
        r1 = clean_text(text, from_pdf=False)
        r2 = clean_text(text, from_pdf=True)
        assert "continuacion" in r1
        assert "continuacion" in r2

    def test_double_hyphen_split_both_modes(self):
        """Division de doble guion funciona en ambos modos."""
        text = "bien--estar comun"
        r1 = clean_text(text, from_pdf=False)
        r2 = clean_text(text, from_pdf=True)
        assert "bien --estar" in r1
        assert "bien --estar" in r2

    def test_normalize_whitespace(self):
        """Normalizacion de espacios en blanco."""
        text = "Hola   mundo\n\n\n\n\nAdios"
        result = clean_text(text)
        assert "Hola mundo" in result
        assert result.count("\n") == 3  # 5 newlines → reduced to 3


class TestTokenizeWithOffsets:
    def test_basic(self):
        words, offsets = tokenize_with_offsets("hola mundo")
        assert words == ["hola", "mundo"]
        assert offsets == [[0, 4], [5, 10]]

    def test_single_word(self):
        words, offsets = tokenize_with_offsets("solo")
        assert words == ["solo"]
        assert offsets == [[0, 4]]

    def test_empty(self):
        words, offsets = tokenize_with_offsets("")
        assert words == []
        assert offsets == []

    def test_offsets_consistent(self):
        """Cada offset [start,end] debe coincidir con text[start:end]."""
        text = "hello world  test\nextra"
        words, offsets = tokenize_with_offsets(text)
        for i, (w, (s, e)) in enumerate(zip(words, offsets)):
            assert text[s:e] == w, f"word {i} '{w}' != text[{s}:{e}]='{text[s:e]}'"

    def test_punctuation_boundaries(self):
        text = "Hello, world! It's..."
        words, offsets = tokenize_with_offsets(text)
        assert words == ["Hello,", "world!", "It's..."]


class TestColumnReorder:
    def test_interleave(self):
        left = ["A1", "A2", "A3"]
        right = ["B1", "B2"]
        result = _interleave_columns(left, right)
        assert result == ["A1", "B1", "A2", "B2", "A3"]

    def test_reorder_non_column_kept_in_place(self):
        """Texto sin columnas pasa intacto."""
        lines = ["Titulo", "Parrafo uno.", "Parrafo dos."]
        result = _reorder_columns(lines)
        assert result == lines

    def test_reorder_column_block_flushed(self):
        """Bloque de columnas se reordena interleaved, luego se reanuda."""
        lines = [
            "This is an introductory text sentence.",
            "Left column content here          Right column content here",
            "Left col second line              Right col second line",
            "This is text after the columns.",
        ]
        result = _reorder_columns(lines)
        assert result[0] == "This is an introductory text sentence."
        assert result[1] == "Left column content here"
        assert result[2] == "Right column content here"
        assert result[3] == "Left col second line"
        assert result[4] == "Right col second line"
        assert result[5] == "This is text after the columns."


class TestParseFile:
    def test_txt_smoke(self):
        test_path = os.path.join(os.path.dirname(__file__), "..", "test_sample.txt")
        if os.path.isfile(test_path):
            words, full_text, _, page_starts = parse_file(test_path)
            assert len(words) > 10
            assert len(full_text) > 0
            assert page_starts is None
            for i, (w, (s, e)) in enumerate(
                zip(words, tokenize_with_offsets(full_text)[1])
            ):
                assert full_text[s:e] == w


class TestEnDashSplit:
    def test_en_dash_splits_in_both_modes(self):
        text = "water–rock formation"
        r1 = clean_text(text, from_pdf=False)
        r2 = clean_text(text, from_pdf=True)
        assert "water –rock" in r1
        assert "water –rock" in r2

    def test_minus_sign_not_split(self):
        text = "CO2\u2212ice"
        r1 = clean_text(text)
        assert "CO2\u2212ice" in r1

    def test_em_dash_still_splits(self):
        text = "space—time"
        result = clean_text(text)
        assert "space —time" in result


class TestCollapseSpacedLetters:
    def test_collapse_four_letters(self):
        text = "a b s t r a c t"
        result = clean_text(text)
        assert "abstract" in result

    def test_collapse_exact_four_info(self):
        text = "i n f o"
        result = clean_text(text)
        assert "info" in result

    def test_no_collapse_three_letters(self):
        text = "A y B"
        result = clean_text(text)
        assert "A y B" in result

    def test_no_collapse_digit_breaks_run(self):
        text = "H 2 O"
        result = clean_text(text)
        assert "H 2 O" in result

    def test_collapse_accented_letters(self):
        text = "á é í ó"
        result = clean_text(text)
        assert "áéíó" in result

    def test_collapse_from_pdf_integration(self):
        text = "Introduction\n\na b s t r a c t\n\nTest content."
        result = clean_text(text, from_pdf=True)
        assert "abstract" in result
        assert "Test content" in result

    def test_no_collapse_from_pdf_preserves_regular_abbreviations(self):
        text = "La opción A y B son correctas según C."
        result = clean_text(text, from_pdf=True)
        assert "A y B" in result
