"""Email Petras when a run ends without sending a reading.

The mail goes out over Gmail SMTP, signed in with an app password from .env:
    FORT_READER_GMAIL               the Gmail address that sends the alert
    FORT_READER_GMAIL_APP_PASSWORD  its app password (never the account password)
    FORT_READER_ALERT_TO            Petras's address
    FORT_READER_ALERT_COUNCIL       Council addresses, comma-separated; mailed only when Sunday's
                                    final run fails (the reader can't read Council emails from the
                                    database, which keeps them private)
Without the first three, a failed run prints its failure and emails nobody.
"""
import smtplib
from email.message import EmailMessage
from pathlib import Path

MAIL_SETTINGS = ("FORT_READER_GMAIL", "FORT_READER_GMAIL_APP_PASSWORD", "FORT_READER_ALERT_TO")


def after_run(failure, screenshot, env, started_at, smtp=smtplib.SMTP_SSL):
    """Email the failure and the screen the run stopped on, and return the addresses mailed.
    failure is None for a run that sent its reading, which emails nobody."""
    if failure is None:
        return []
    if not all(env.get(k) for k in MAIL_SETTINGS):
        return []  # no mail settings: the run prints its failure only, as before
    to = [env["FORT_READER_ALERT_TO"]]
    note = ""
    if started_at.weekday() == 6:  # Sunday (UTC): the final run, which closes the week
        to += [a.strip() for a in env.get("FORT_READER_ALERT_COUNCIL", "").split(",") if a.strip()]
        note = ("\nThis was Sunday's final run, which closes the Fort Week. The week keeps its last "
                "reading; paste the full ranking on the admin page once the week has closed.\n")
    msg = EmailMessage()
    msg["From"] = env["FORT_READER_GMAIL"]
    msg["To"] = ", ".join(to)
    msg["Subject"] = f"Fort reader: {failure.splitlines()[0]}"
    shown = "The screen it stopped on is attached." if screenshot else "No screenshot was taken."
    msg.set_content(f"The run started {started_at:%A %Y-%m-%d %H:%M} UTC sent no reading.\n\n"
                    f"{failure}\n\n{shown}\n{note}")
    if screenshot:
        path = Path(screenshot)
        msg.add_attachment(path.read_bytes(), maintype="image", subtype="png", filename=path.name)
    # A stalled link raises TimeoutError instead of hanging the run, and the next day's run with it.
    with smtp("smtp.gmail.com", 465, timeout=30) as server:
        server.login(env["FORT_READER_GMAIL"], env["FORT_READER_GMAIL_APP_PASSWORD"])
        server.send_message(msg)
    return to
