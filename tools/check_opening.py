#!/usr/bin/env python3
"""Checks the opening questions (Resources/Content/opening.json): every school can be chosen, and random
answers pick each school roughly evenly (the most-picked within 2x of the least). Ties go to a random leader,
as in the game.

    python3 tools/check_opening.py
"""
import itertools
import json
import os
import random
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCHOOLS = ["spore", "glow", "bloom", "verdure", "shimmer", "spirit"]


def pick(qs, answers, rng):
    tot = {s: 0 for s in SCHOOLS}
    for q, a in zip(qs, answers):
        for k, v in q["answers"][a]["weights"].items():
            tot[k] += v
    best = max(tot.values())
    return rng.choice([s for s in SCHOOLS if tot[s] == best])


def main():
    qs = json.load(open(os.path.join(ROOT, "Resources", "Content", "opening.json")))["questions"]
    for q in qs:
        for a in q["answers"]:
            bad = [k for k in a["weights"] if k not in SCHOOLS]
            if bad:
                sys.exit(f"unknown school {bad} in {a['text']!r}")
    rng = random.Random(1)
    # Every possible set of answers (exact distribution, ties shared out evenly).
    exact = {s: 0.0 for s in SCHOOLS}
    for combo in itertools.product(*[range(len(q["answers"])) for q in qs]):
        tot = {s: 0 for s in SCHOOLS}
        for q, a in zip(qs, combo):
            for k, v in q["answers"][a]["weights"].items():
                tot[k] += v
        best = max(tot.values())
        lead = [s for s in SCHOOLS if tot[s] == best]
        for s in lead:
            exact[s] += 1 / len(lead)
    n = sum(exact.values())
    print("share of all answer sets:", ", ".join(f"{s} {exact[s] / n:.1%}" for s in SCHOOLS))
    sim = {s: 0 for s in SCHOOLS}
    for _ in range(20000):
        sim[pick(qs, [rng.randrange(len(q["answers"])) for q in qs], rng)] += 1
    print("20000 random players:  ", ", ".join(f"{s} {sim[s]}" for s in SCHOOLS))
    lo, hi = min(exact.values()), max(exact.values())
    ok = lo > 0 and hi / lo <= 2
    print("every school reachable:", lo > 0, f"· most/least {hi / lo:.2f}x", "OK" if ok else "UNEVEN")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
