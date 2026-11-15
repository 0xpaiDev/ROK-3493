"""Read one Fort Destroyer Rankings screenshot with Claude Haiku."""
import base64
import io
from typing import Literal

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


SCREENS_PROMPT = """This is a screenshot of the Rise of Kingdoms game on a phone or emulator. Name the screen, choosing exactly one:

- login_failed: a box titled "NETWORK DISCONNECTED" saying "Login failed, please click CONFIRM to restart the game", over any background.
- update: any prompt asking to update or download a new version of the app.
- login: a sign-in or account screen asking for an email, password, Lilith account, Google or Facebook login, or to pick an account.
- loading: an all-black or blank screen (the game is starting), or the game's loading screen: the title artwork with a progress bar or "Loading ..." / "Downloading ..." text, "Tap to Start", or a spinner over a dimmed city with no box.
- fort_ranking: a panel titled "FORT DESTROYER RANKINGS".
- alliance_rankings: a panel titled "RANKINGS" with tiles such as Individual Power, Killing Machine and Fort Destroyer.
- alliance_settings: a panel titled "SETTINGS" with icons Alliance Log, Settings, Alliance List, Rankings, Approval, Recruit Plaza, Quit Alliance.
- alliance: any other tab of the "ALLIANCE" window (the alliance banner, War, Holy Sites, Territory, Help, Gifts, Storehouse, Technology, members, and so on).
- city: the city view with no panel or popup open, and the bottom bar shows the buttons Items, Alliance, Commander, Mail.
- city_bar_closed: the city view with no panel or popup open, but the bottom bar's Items, Alliance, Commander, Mail buttons are hidden: at the bottom right there is only a round menu button (three lines), sometimes beside a small round offer icon with a countdown timer under it. That icon and timer are part of the city view, not a popup.
- unknown: anything else, including any other popup, offer, event window, dialog or panel over the city, the world map, or a screen that isn't the game.

When in doubt, answer unknown.
"""

ScreenName = Literal["login_failed", "update", "login", "loading", "fort_ranking", "alliance_rankings",
                  "alliance_settings", "alliance", "city", "city_bar_closed", "unknown"]


class Named(BaseModel):
    screen: ScreenName


def name_screen(client, image):
    """The name of the game screen on show, one of ScreenName (navigate.py's vocabulary)."""
    buf = io.BytesIO()
    image.resize((800, 450)).save(buf, format="PNG")  # half size: enough to name a screen, a quarter of the cost
    response = client.messages.parse(
        model=MODEL,
        max_tokens=2000,
        output_config={"effort": "low"},
        messages=[{
            "role": "user",
            "content": [
                {"type": "image", "source": {"type": "base64", "media_type": "image/png",
                                             "data": base64.standard_b64encode(buf.getvalue()).decode()}},
                {"type": "text", "text": SCREENS_PROMPT},
            ],
        }],
        output_format=Named,
    )
    named = response.parsed_output
    if response.stop_reason != "end_turn" or named is None:
        return "unknown"  # an unreadable answer stops the run, like any screen it doesn't know
    return named.screen


def make_client():
    try:
        return anthropic.Anthropic()
    except anthropic.AnthropicError as e:
        raise SystemExit(f"No Anthropic API key: add ANTHROPIC_API_KEY to .env ({e}).")
