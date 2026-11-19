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


def mail(subject, body, env, smtp=smtplib.SMTP_SSL):
    """Emails FORT_READER_ALERT_TO a plain note, such as the roster job's. Returns the addresses
    mailed, or [] when .env has no mail settings."""
    if not all(env.get(k) for k in MAIL_SETTINGS):
        return []
    msg = EmailMessage()
    msg["From"] = env["FORT_READER_GMAIL"]
    msg["To"] = env["FORT_READER_ALERT_TO"]
    msg["Subject"] = subject
    msg.set_content(body)
    with smtp("smtp.gmail.com", 465, timeout=30) as server:
        server.login(env["FORT_READER_GMAIL"], env["FORT_READER_GMAIL_APP_PASSWORD"])
        server.send_message(msg)
    return [env["FORT_READER_ALERT_TO"]]


ROSTER_EVENING_HOUR = 18  # the Roster job's second timer (host/install.sh): no run is due after it


def roster_last_run(started_at):
    """Whether a Roster job run started at started_at is the day's last chance: from 18:00 UTC on no
    timer is left that day. A run made up late after a reboot, before 18:00, still has the evening's."""
    return started_at.hour >= ROSTER_EVENING_HOUR


def after_roster_run(failure, env, started_at, saved_today, smtp=smtplib.SMTP_SSL):
    """Email a failed Roster job run, and return the addresses mailed. It emails only when both of the
    day's runs failed: this run failed, no run that day saved (saved_today), and none is left to try."""
    if failure is None or saved_today or not roster_last_run(started_at):
        return []
    return mail(f"Roster job: {failure.splitlines()[0]}",
                f"The run at {started_at:%Y-%m-%d %H:%M} UTC saved no Roster Snapshot.\n\n{failure}\n", env, smtp)


def after_run(failure, screenshot, env, started_at, smtp=smtplib.SMTP_SSL):
    """Email the failure and the screen the run stopped on, and return the addresses mailed:
    FORT_READER_ALERT_TO first, then any Council addresses, so more than one means the Council
    was mailed. failure is None for a run that sent its reading, which emails nobody."""
    if failure is None:
        return []
    if not all(env.get(k) for k in MAIL_SETTINGS):
        return []  # no mail settings: the run prints its failure only, as before
    to = [env["FORT_READER_ALERT_TO"]]
    note = ""
    # Sunday from 22:00 UTC: the final run, which closes the week. The same cutoff as record_live_week
    # (supabase/migrations/20261116130000_live_week_completeness_from_reading_day.sql).
    if started_at.weekday() == 6 and started_at.hour >= 22:
        to += [a.strip() for a in env.get("FORT_READER_ALERT_COUNCIL", "").split(",") if a.strip()]
        note = ("\nThis was Sunday's final run, which closes the Fort Week. The week keeps its last "
                "reading and is saved as Partial. Any correction is made directly in SQL once the "
                "week has closed.\n")
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
