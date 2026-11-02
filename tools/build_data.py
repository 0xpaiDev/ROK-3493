"""Convert the kingdom Excel workbook into site/data/data.js.

Usage:  py tools/build_data.py "path/to/3493 Data.xlsx"

Character ID is the key everywhere; names change, IDs don't.
Fort weekly blocks sit side by side in the "Fort Weekly Log" sheet, one block
per week of six columns read by position (week start, week end, rank, Governor name,
Fort Count, Character ID), so new weeks can keep being added to the right. The sheet's
rank column is ignored: the site computes ranks, and ties keep the sheet's order.
"""
import json
import re
import sys
from datetime import date
from pathlib import Path

import openpyxl

MONTHS = {m: i + 1 for i, m in enumerate(
    ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"])}
# Saved Weekly Rankings known to be incomplete (weeks 43 and 44). Every other week is Complete.
PARTIAL_WEEKS = {"2026-10-19", "2026-10-26"}
OUT = Path(__file__).resolve().parent.parent / "site" / "data" / "data.js"


def parse_date(s):
    m = re.match(r"\s*(\d{1,2})\s+([A-Za-z]{3})[a-z]*\.?\s+(\d{4})", str(s))
    if not m:
        return None
    return date(int(m[3]), MONTHS[m[2].lower()], int(m[1])).isoformat()


def cid(v):
    if v is None or v == "":
        return None
    if isinstance(v, float):
        v = int(v)
    return str(v).strip()


def num(v):
    """Numbers come both as raw floats and as '80.4M' strings."""
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        return float(v)
    m = re.match(r"([\d.]+)\s*([KMB]?)", str(v).strip(), re.I)
    if not m:
        return None
    return float(m[1]) * {"": 1, "K": 1e3, "M": 1e6, "B": 1e9}[m[2].upper()]


def read_fort(ws, warnings):
    header_row = next(r for r in range(1, 10) if ws.cell(r, 1).value == "Week Start" or
                      any(ws.cell(r, c).value == "Week Start" for c in range(1, ws.max_column + 1)))
    starts = [c for c in range(1, ws.max_column + 1) if ws.cell(header_row, c).value == "Week Start"]
    weeks = []
    for c in starts:
        rows, seen = [], {}
        start = end = None
        for r in range(header_row + 1, ws.max_row + 1):
            vals = [ws.cell(r, c + i).value for i in range(6)]
            if vals[3] is None or vals[4] is None:
                continue
            start = start or parse_date(vals[0])
            end = end or parse_date(vals[1])
            pid = cid(vals[5])
            entry = {"id": pid, "name": str(vals[3]).strip(), "fortCount": int(vals[4])}
            if pid and pid in seen:
                prev = seen[pid]
                warnings.append(f"Week {start}: {entry['name']} ({pid}) listed more than once "
                                f"({prev['fortCount']} and {entry['fortCount']}); kept the higher Fort Count")
                prev["fortCount"] = max(prev["fortCount"], entry["fortCount"])
                continue
            if pid:
                seen[pid] = entry
            rows.append(entry)
        if not rows:
            continue
        rows.sort(key=lambda e: -e["fortCount"])  # stable: ties keep the sheet's order
        weeks.append({"start": start, "end": end,
                      "completeness": "partial" if start in PARTIAL_WEEKS else "complete",
                      "entries": rows})
    weeks.sort(key=lambda w: w["start"])
    return weeks


def table(ws):
    # Header is the first row with 3+ filled cells (title and blank rows sit above it).
    header_row = next(r for r in range(1, 10)
                      if sum(ws.cell(r, c).value is not None for c in range(1, ws.max_column + 1)) >= 3)
    headers = [ws.cell(header_row, c).value for c in range(1, ws.max_column + 1)]
    for r in ws.iter_rows(min_row=header_row + 1, values_only=True):
        if any(v is not None for v in r):
            yield dict(zip(headers, r))


def main(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    warnings = []
    fort = read_fort(wb["Fort Weekly Log"], warnings)

    gh = {}
    for row in table(wb["20GH Event Log"]):
        if row.get("Player") is None:
            continue
        name = str(row["Player"]).strip()
        tag = re.match(r"\[([^\]]+)\]\s*", name)
        gh.setdefault(row["Event Date"], []).append({
            "rank": int(row["Rank"]), "id": cid(row["Character ID"]),
            "name": name[tag.end():] if tag else name, "alliance": tag[1] if tag else None,
            "gh": int(row["GH Awarded"] or 0)})
        if not cid(row["Character ID"]):
            warnings.append(f"GH event {row['Event Date']}: {name} has no Character ID")
    gh_events = [{"label": k, "entries": v} for k, v in gh.items()]

    kvk = [{"status": r["Status"], "rank": int(r["Rank"]), "id": cid(r["Character ID"]),
            "name": str(r["Username"]).strip(), "power": num(r["Power"]),
            "highestPower": num(r["Highest Power"]), "killPoints": num(r["Total Kill Points"]),
            "resources": num(r["Resources Gathered"])}
           for r in table(wb["KvK History"]) if r.get("Username")]

    roster = [{"id": cid(r["Character ID"]), "name": str(r["Username"]).strip(),
               "status": r["Status"], "power": num(r["Power"]),
               "highestPower": num(r["Highest Power"]), "killPoints": num(r["Total Kill Points"]),
               "resources": num(r["Resources Gathered"])}
              for r in table(wb["Current Roster"]) if r.get("Username")]

    data = {"generated": date.today().isoformat(), "fortWeeks": fort, "ghEvents": gh_events,
            "kvk": kvk, "roster": roster, "warnings": warnings}
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text("// Generated by tools/build_data.py, do not edit by hand.\nwindow.KD_DATA = "
                   + json.dumps(data, ensure_ascii=False, indent=1) + ";\n", encoding="utf-8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"Wrote {OUT}: {len(fort)} fort weeks, {len(gh_events)} GH events, "
          f"{len(kvk)} KvK rows, {len(roster)} roster rows")
    for w in warnings:
        print("  warning:", w)


if __name__ == "__main__":
    main(sys.argv[1])
