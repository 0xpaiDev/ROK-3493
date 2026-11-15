"""Walk Rise of Kingdoms from wherever it starts to the Fort Destroyer Rankings.

The game is given as four calls: look() names the screen on show (Haiku does that, see
read.name_screen), tap(x, y), wait(seconds) and now(). Each named screen has one fixed tap;
the coordinates are for a 1600x900 screen. A screen without one stops the run: the reader
never guesses a tap.
"""

# The tap path, screen by screen. Recorded on BlueStacks on 2026-11-15.
PATH = {
    "city_bar_closed": (1540, 820),    # the round button at the bottom right opens the bar
    "city": (1160, 840),               # Alliance, in the bottom bar
    "alliance": (90, 490),             # the gear tab on the window's left edge
    "alliance_settings": (1170, 380),  # Rankings, top right ("Quit Alliance" is lower down: never near it)
    "alliance_rankings": (400, 690),   # the Fort Destroyer tile, bottom left
    # Known popups, closed on the way.
    "login_failed": (800, 588),        # "Network disconnected / Login failed ... REGISTER_AND_LOGING":
                                       # CONFIRM restarts the game, which then carries on
}


# Screens that need Petras: the run stops on them with this reason.
STOPS = {
    "login": "The game is asking to log in. Log the Reader Account in by hand; the next run carries on.",
    "update": "The game wants an app update. Install the new version by hand (see the README); "
              "the next run carries on.",
}


class Stopped(Exception):
    """The run ends here: screen is the name of the screen it stopped on."""

    def __init__(self, screen, reason):
        super().__init__(reason)
        self.screen = screen
        self.reason = reason


def open_ranking(game, loading_limit=600):
    """Tap from the screen on show to the Fort Destroyer Rankings, or raise Stopped.
    loading_limit: seconds the game may spend loading and downloading in all."""
    loading, since = 0.0, None  # time spent on loading screens, and when the last one was seen
    last, taps = None, 0        # the last screen tapped, and how many times in a row
    while True:
        screen = game.look()
        if screen == "loading":
            # Clock time between looks, not just the waits: on a slow device each look takes seconds.
            now = game.now()
            loading += now - since if since is not None else 0
            since = now
            if loading >= loading_limit:
                raise Stopped(screen, f"The game was still loading after {loading_limit / 60:g} minutes: "
                                      "a large download, or no network.")
            game.wait(5)
            continue
        since = None
        if screen == "fort_ranking":
            return
        if screen in STOPS:
            raise Stopped(screen, STOPS[screen])
        if screen not in PATH:
            raise Stopped(screen, "The reader doesn't recognise this screen, so it stopped rather "
                                  "than guess a tap. See the saved screenshot.")
        # A slow device can miss a tap: tap again, but three times on one screen is a loop.
        taps = taps + 1 if screen == last else 1
        if taps > 3:
            raise Stopped(screen, f"The game is stuck on {screen}: three taps didn't move it on.")
        last = screen
        game.tap(*PATH[screen])
        game.wait(3)
