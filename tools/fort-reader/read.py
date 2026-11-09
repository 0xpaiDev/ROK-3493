"""Read one Fort Destroyer Rankings screenshot with Claude Haiku."""
import base64
import io

import anthropic
from pydantic import BaseModel

MODEL = "claude-haiku-5-5"

PROMPT = """This is a screenshot of the Rise of Kingdoms game. Read the "FORT DESTROYER RANKINGS" panel if it is open.

- is_fort_ranking: true only if that panel is open.
- pinned: the reader's own row in the gold banner above the column headers (rank, name, "Forts Destroyed" number). null if not visible.
- rows: every row of the list below the "Name / Forts Destroyed" headers, top to bottom.
  - rank: the number at the left. Ranks 1, 2 and 3 are shown as gold, silver and bronze medals.
  - name: the Governor name in bold. Copy it exactly, character by character: names use superscripts (ᵛ, ᴸ, ᵒ, ᴷ), accented and Cyrillic letters, CJK, Arabic and symbols such as ㋾ or 乄. Never translate, simplify or "correct" a name, and keep spacing as shown. Ignore the small grey title under the name (e.g. "Leader", "Watchful General", "–").
  - forts: the number in the "Forts Destroyed" column.
  - Skip a row cut off at the top or bottom edge of the list so that its name or number is not fully readable.
"""


class Row(BaseModel):
    rank: int
    name: str
    forts: int


class Screen(BaseModel):
    is_fort_ranking: bool
    pinned: Row | None
    rows: list[Row]


def read_screen(client, image):
    """image: a PIL image of the game window. Returns a Screen."""
    buf = io.BytesIO()
    image.save(buf, format="PNG")
    response = client.messages.parse(
        model=MODEL,
        max_tokens=8000,
        output_config={"effort": "low"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                             "data": base64.standard_b64encode(buf.getvalue()).decode()}},
                {"type": "text", "text": PROMPT},
            ],
        }],
        output_format=Screen,
    )
    if response.stop_reason != "end_turn" or response.parsed_output is None:
        raise RuntimeError(f"Haiku could not read the screenshot (stop reason: {response.stop_reason}).")
    return response.parsed_output


def make_client():
    try:
        return anthropic.Anthropic()
    except anthropic.AnthropicError as e:
        raise SystemExit(f"No Anthropic API key: add ANTHROPIC_API_KEY to .env ({e}).")
