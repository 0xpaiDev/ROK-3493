"""Join the rows read from each screenshot into one Weekly Ranking, and check it.

Every screenshot shows a slice of the ranking and slices overlap, so rows are joined by rank.
Nothing here guesses: a Fort Count read two ways, a gap, or a Fort Count that rises is reported,
and the Council decides. A name read two ways with one Fort Count is kept with every spelling
(names in odd scripts read differently per screen): the database matches the row only when those
spellings lead to one Governor.
"""


def merge_frames(frames):
    """frames: one list of rows per screenshot, each row {rank, name, forts}.
    Returns (rows ordered by rank, problems). A row read two ways carries names: every spelling, the
    most often read first, and name is that one."""
    by_rank, spellings, problems = {}, {}, []
    for i, rows in enumerate(frames, start=1):
        for r in rows:
            seen = by_rank.get(r["rank"])
            if seen is None:
                by_rank[r["rank"]] = dict(r, frame=i)
                spellings[r["rank"]] = {r["name"]: 1}
            elif seen["forts"] == r["forts"]:
                counts = spellings[r["rank"]]
                counts[r["name"]] = counts.get(r["name"], 0) + 1
            else:
                problems.append(
                    f'Rank {r["rank"]} read as "{seen["name"]} {seen["forts"]}" in screenshot '
                    f'{seen["frame"]} but "{r["name"]} {r["forts"]}" in screenshot {i}.'
                )
    for rank, counts in spellings.items():
        if len(counts) > 1:
            names = sorted(counts, key=lambda n: -counts[n])  # stable: ties keep the order first read
            by_rank[rank].update(name=names[0], names=names)
    rows = [by_rank[k] for k in sorted(by_rank)]
    return rows, problems + check_ranking(rows)


def check_ranking(rows):
    """Ranks must run 1..N with no gaps, and Fort Counts must never rise down the list."""
    problems = []
    ranks = [r["rank"] for r in rows]
    if ranks and ranks[0] != 1:
        problems.append(f"The ranking starts at rank {ranks[0]}, not 1.")
    missing = sorted(set(range(1, (ranks[-1] if ranks else 0) + 1)) - set(ranks))
    if missing:
        problems.append("Missing ranks: " + ", ".join(map(str, missing)) + ".")
    for a, b in zip(rows, rows[1:]):
        if b["forts"] > a["forts"]:
            problems.append(
                f'Rank {b["rank"]} ({b["name"]}, {b["forts"]}) has more forts than '
                f'rank {a["rank"]} ({a["name"]}, {a["forts"]}).'
            )
    return problems


def check_pinned(pinned, rows):
    """The reader's own row is pinned above the list; it must agree with the list."""
    if not pinned:
        return []
    hit = next((r for r in rows if r["rank"] == pinned["rank"]), None)
    if hit is None:
        return [f'Your own row (rank {pinned["rank"]}) never appeared in the list.']
    if (hit["name"], hit["forts"]) != (pinned["name"], pinned["forts"]):
        return [
            f'Your own row reads "{pinned["name"]} {pinned["forts"]}" at the top but '
            f'"{hit["name"]} {hit["forts"]}" in the list.'
        ]
    return []


def paste_text(rows):
    """The Fort Week paste format: one Governor per line, name, a tab, then the Fort Count."""
    return "\n".join(f'{r["name"]}\t{r["forts"]}' for r in rows) + "\n"
