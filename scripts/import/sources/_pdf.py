"""
Text out of a PDF, using nothing but the standard library.

WHY THIS EXISTS
---------------
The extract half of this toolkit is deliberately dependency-free: stdlib plus
openpyxl, no network, no system binaries. A client turned up whose only record
of their dogs' breeds, birthdays and vaccination dates was a set of PDF
reports, so the choice was to add a PDF library, shell out to `pdftotext`, or
read the format. Reading it won: a source module that needs `brew install
poppler` before it runs is a source module that breaks on someone else's
laptop, and an onboarding is exactly the moment you cannot afford that.

WHAT IT UNDERSTANDS
-------------------
Enough, and no more. This is not a PDF renderer — it recovers the text of a
machine-generated report, which is a much smaller problem:

  * content streams, raw or FlateDecode (zlib is stdlib)
  * literal `(strings)` and hex `<537472696e6773>` strings
  * `Tj` and `TJ` (the array form, whose numeric kerning entries are dropped)
  * `Td` / `TD` / `Tm` / `T*` for positioning

LINES COME FROM THE Y COORDINATE, NOT FROM LINE BREAKS
------------------------------------------------------
There are no line breaks in a PDF. A generated report emits each run of text
as its own `BT … Td … Tj … ET` block, so a single visual line — `Breed:` in
bold followed by `English Staffy` in regular — arrives as two separate blocks
that share a y coordinate.

Splitting on blocks therefore tears every label away from its value, which is
precisely the data you are trying to read. So runs are grouped by y: same y
(within half a point) means same line. That one rule is the whole module, and
getting it wrong is the difference between `Breed: English Staffy` and two
useless fragments.

VERIFIED AGAINST poppler
------------------------
Output was compared line-for-line with `pdftotext -layout` on the four reports
this was written for. The two information reports — 806 and 748 lines — match
exactly. The two weekly outlooks match on every line except a `→` that this
module renders as `!`: the arrow is drawn from a subsetted symbol font whose
encoding would need the embedded font programme to resolve, which is well past
the point of diminishing returns. Callers that care split on `[→!]` instead,
which is what `doggie_dashboard_reports` does.
"""

from __future__ import annotations

import re
import zlib
from pathlib import Path

# A content stream. Non-greedy so nested-looking data cannot swallow the file.
_STREAM = re.compile(rb"stream\r?\n(.*?)\r?\nendstream", re.S)

# One pass over the operators that can move or emit text. Everything else in
# the stream (graphics, colour, font selection) is irrelevant here.
_TOKEN = re.compile(
    rb"(?P<hex>\<[0-9A-Fa-f\s]*\>)"
    rb"|(?P<lit>\((?:\\.|[^\\()])*\))"
    rb"|(?P<num>-?[\d.]+)"
    rb"|(?P<op>TJ|Tj|Td|TD|Tm|T\*|BT|ET)",
    re.S,
)

_ESCAPES = {b"n": b"\n", b"r": b"\r", b"t": b"\t", b"b": b"\b", b"f": b"\f"}

# Reports draw their indentation with a non-breaking space (0xCA in the font's
# encoding). Left alone it turns every indented value into mojibake.
_INDENT_CHAR = "\xca"

# Two runs whose y coordinates differ by less than this are the same line.
# Half a point: far below any real line height, far above float noise.
_SAME_LINE = 0.6


def _decode_hex(token: bytes) -> str:
    digits = re.sub(rb"[^0-9A-Fa-f]", b"", token)
    if len(digits) % 2:            # an odd trailing nibble is padded with 0
        digits += b"0"
    return bytes.fromhex(digits.decode("ascii")).decode("latin-1")


def _decode_literal(token: bytes) -> str:
    body = token[1:-1]
    body = re.sub(rb"\\([nrtbf()\\])",
                  lambda m: _ESCAPES.get(m.group(1), m.group(1)), body)
    return body.decode("latin-1")


def text_lines(path: str | Path) -> list[str]:
    """
    Every line of text in the PDF, in document order, whitespace collapsed.

    Empty lines are dropped: a report's vertical rhythm is not information,
    and callers key off the label at the start of a line.
    """
    data = Path(path).read_bytes()
    lines: list[str] = []
    run: list[str] = []
    current_y: float | None = None

    def flush() -> None:
        nonlocal run
        text = re.sub(r"\s+", " ", "".join(run).replace(_INDENT_CHAR, " ")).strip()
        if text:
            lines.append(text)
        run = []

    for stream in _STREAM.finditer(data):
        body = stream.group(1)
        try:
            body = zlib.decompress(body)
        except zlib.error:
            pass                    # these reports store their streams raw
        if b"Tj" not in body and b"TJ" not in body:
            continue

        numbers: list[float] = []
        pending: list[str] = []
        for tok in _TOKEN.finditer(body):
            kind, value = tok.lastgroup, tok.group(0)
            if kind == "num":
                numbers.append(float(value))
            elif kind == "hex":
                pending.append(_decode_hex(value))
            elif kind == "lit":
                pending.append(_decode_literal(value))
            elif value in (b"Td", b"TD", b"Tm"):
                # `x y Td` and `a b c d x y Tm` both put y last.
                needed = 6 if value == b"Tm" else 2
                y = numbers[-1] if len(numbers) >= needed else None
                if y is not None:
                    if current_y is None or abs(y - current_y) > _SAME_LINE:
                        flush()
                    current_y = y
                numbers = []
            elif value in (b"Tj", b"TJ"):
                run.append("".join(pending))
                pending, numbers = [], []
            elif value == b"T*":
                flush()
                pending, numbers = [], []
            elif value in (b"BT", b"ET"):
                pending, numbers = [], []

        flush()
        current_y = None            # a new page starts a new line, always

    return lines


def strip_chrome(lines: list[str], *, footer: str = "",
                 masthead: "re.Pattern | None" = None) -> list[str]:
    """
    Drop the page furniture: bare page numbers, a repeating footer, a masthead.

    The footer and masthead are passed in rather than guessed. A report whose
    content genuinely contains its own brand name is not hypothetical, and
    silently deleting a line that turned out to be data is the sort of loss
    this toolkit exists to prevent.

    The masthead matters more than it looks. "Created on July 27, 2026" is a
    print date, but it is also a line containing a comma and no colon — which
    is exactly the shape of a "Surname, Firstname" record header in the owners
    report. Left in, it becomes a client called "2026 Created on July 27".
    """
    out = []
    for line in lines:
        text = line
        if footer:
            text = re.sub(rf"\s*{re.escape(footer)}\s*$", "", text).strip()
        if not text or text.isdigit():
            continue
        if masthead is not None and masthead.match(text):
            continue
        out.append(text)
    return out
