"""Which articles go on which page.

gen1 fills a page's news hole EXACTLY: the stories' module heights must add up to the hole, within what copyfit,
headline steps, photo sizes and up to two leadings of white at a column's foot allow. The planner therefore checks
every page before the slow layout search runs, with gen1's own first pass (the heights every subset of stories can
fill at every width, from the measured module options), and changes the page's set of stories until it fills.

How many stories a page gets: about as many as the paper prints on such a page (the medians measured on its own
pages), fewer when the edition has fewer articles than the pages hold, so every page gets its share. Articles keep
their order of importance: the front page takes the most important ones, then page 2, 3 …; pinned articles stay on
their page. Deterministic: the same articles and options always give the same plan.
"""
from __future__ import annotations

import math

from deskgen import BRIEF_WIDTHS, G, rank_class
from deskmsg import msg

MAX_MODULES = 10                 # modules per page the planner gives the search (gen1's limit is 11; fewer is faster)
MIN_MODULES = 3                  # a page with fewer stories looks like a poster, not a newspaper page
BRIEFS_FRONT = 6                 # short items stacked in the front page's "in brief" column
SWAP_TRIES = 10                  # later stories tried in place of the page's least important one


def reach(opts: list, W: int, Hn: int) -> dict:
    """gen1.Generator.run, pass A: R[(mask, w)] = the heights (units) the stories in mask fill exactly at w columns."""
    n = len(opts)
    R = {}
    full = (1 << n) - 1
    for mask in sorted(range(1, full + 1), key=lambda m: (bin(m).count("1"), m)):
        bits = [i for i in range(n) if mask >> i & 1]
        for w in range(1, W + 1):
            if len(bits) == 1:
                R[(mask, w)] = G.merge([(o["lo"], o["hi"]) for o in opts[bits[0]].get(w, [])])
                continue
            acc = []
            low = mask & -mask
            sub = (mask - 1) & mask
            while sub:
                if sub & low:
                    a, b = sub, mask ^ sub
                    acc += G.mink(R[(a, w)], R[(b, w)], Hn)
                    for w1 in range(1, w):
                        acc += G.inter(R[(a, w1)], R[(b, w - w1)])
                sub = (sub - 1) & mask
            R[(mask, w)] = G.merge(acc)
    return R


def region_heights(regions) -> list:
    return [math.floor((b - t) / G.UNIT) for _, _, t, b in regions]


def fits(R, n: int, regions) -> bool:
    """Can the n stories fill the regions exactly (gen1.run's region assignment, feasibility only)?"""
    Hs = region_heights(regions)
    full = (1 << n) - 1
    if len(regions) == 1:
        return G.contains(R[(full, regions[0][1])], Hs[0])
    memo = {}

    def assign(k, mask):
        if k == len(regions):
            return mask == 0
        if (k, mask) in memo:
            return memo[(k, mask)]
        w = regions[k][1]
        sub, ok = mask, False
        while sub and not ok:
            ok = G.contains(R[(sub, w)], Hs[k]) and assign(k + 1, mask ^ sub)
            sub = (sub - 1) & mask
        memo[(k, mask)] = ok
        return ok
    return assign(0, full)


def brief_widths_only(by_w: dict) -> dict:
    return {w: (o if w in BRIEF_WIDTHS else []) for w, o in by_w.items()}


class Planner:
    """items: [{"key", "order", "pin", "brief"}] in order of importance; options: {key: {class: {w: [option]}}};
    pages: [{"page", "regions", "target"}] (target: stories the paper usually prints on such a page)."""

    def __init__(self, items, options, pages):
        self.items = items
        self.by_key = {it["key"]: it for it in items}
        self.options = options
        self.pages = pages
        self.log = []
        self._status = {}

    def opts(self, key, rank):
        o = self.options[key][rank_class(rank)]
        return brief_widths_only(o) if self.by_key[key]["brief"] else o

    def has_options(self, key, rank) -> bool:
        o = self.opts(key, rank)
        return any(o.get(w) for w in range(1, G.NCOL + 1))

    def page_order(self, keys):
        """The page's stories in order of importance (briefs last). A story that cannot be set as a page's lead (its
        headline does not fit at the lead's size) gives the lead to the next story."""
        order = sorted(keys, key=lambda k: (self.by_key[k]["brief"], self.by_key[k]["order"]))
        if len(order) > 1 and not self.has_options(order[0], 0):
            for i in range(1, len(order)):
                if not self.by_key[order[i]]["brief"] and self.has_options(order[i], 0):
                    order.insert(0, order.pop(i))
                    break
        return order

    def opts_for(self, keys):
        """Options of a page's stories at their rank on that page (gen1 ranks by importance; briefs last)."""
        order = self.page_order(keys)
        return order, [self.opts(k, r) for r, k in enumerate(order)]

    def placeable(self, key) -> bool:
        """Can the story be set at all (as one of the page's other stories, if not as its lead)?"""
        return self.has_options(key, 1) or self.has_options(key, 0)

    def status(self, keys, regions):
        """'fits' | 'short' | 'over' | 'gap' | 'none' (a story with no options at all), and the reachable heights."""
        ck = (tuple(sorted(keys)), tuple(map(tuple, regions)))
        if ck in self._status:
            return self._status[ck]
        out = self._status_uncached(keys, regions)
        self._status[ck] = out
        return out

    def _status_uncached(self, keys, regions):
        if not keys:
            return "short", []
        order, opts = self.opts_for(keys)
        if any(not any(o.get(w) for w in range(1, G.NCOL + 1)) for o in opts):
            return "none", []
        Hs = region_heights(regions)
        R = reach(opts, G.NCOL, max(Hs))
        full = (1 << len(order)) - 1
        if fits(R, len(order), regions):
            return "fits", R[(full, regions[0][1])]
        if len(regions) > 1:
            total = sum(r[1] * h for r, h in zip(regions, Hs, strict=True))
            iv = R[(full, G.NCOL)]
            lo = min((a for a, _ in iv), default=0) * G.NCOL
            return ("short" if lo < total else "over"), iv
        iv = R[(full, regions[0][1])]
        H = Hs[0]
        if not iv or max(b for _, b in iv) < H:
            return "short", iv
        if min(a for a, _ in iv) > H:
            return "over", iv
        return "gap", iv

    def plan(self):
        """→ (pages, unpinned stories left over, {pinned story: reason it is not placed})."""
        free = [it["key"] for it in self.items if it["pin"] is None]
        out, dropped = [], {}
        for idx, pg in enumerate(self.pages):
            p, regions = pg["page"], pg["regions"]
            fixed = []
            for it in self.items:
                if it["pin"] != p:
                    continue
                if self.placeable(it["key"]):
                    fixed.append(it["key"])
                else:
                    dropped[it["key"]] = msg("m.plan.headlineTooLong")
            if len(fixed) > MAX_MODULES:                   # the layout search takes at most MAX_MODULES per page
                keep = self.page_order(fixed)[:MAX_MODULES]
                for k in fixed:
                    if k not in keep:
                        dropped[k] = msg("m.plan.pinnedFull", max=MAX_MODULES, page=p)
                fixed = [k for k in fixed if k in keep]
            # this page's share of what is left: as many as usual, fewer when the edition is short of stories
            later = self.pages[idx:]
            want = sum(q["target"] for q in later)
            have = len(free) + sum(1 for it in self.items if it["pin"] is not None and it["pin"] >= p)
            target = pg["target"] if have >= want else max(MIN_MODULES, round(pg["target"] * have / max(1, want)))
            target = min(MAX_MODULES, max(target, len(fixed)))
            chosen, shrink, why = self.fill(fixed, free, regions, target)
            for k in chosen:
                if k in free:
                    free.remove(k)
            out.append({"page": p, "keys": self.page_order(chosen), "shrink_units": shrink, "why": why})
            self.log.append((p, why, len(chosen), target))
        return out, free, dropped

    def fill(self, fixed, free, regions, target):
        """The page's stories: the fixed ones (pinned, the page's short items), then free ones in order of importance up
        to the target; then the nearest set that fills the page exactly. → (keys, shrink units or 0, reason)."""
        fixed = [k for k in fixed if self.placeable(k)]
        pool = [k for k in free if self.placeable(k)]
        n_free = max(0, target - len(fixed))
        S = fixed + pool[:n_free]
        rest = pool[n_free:]
        s, _ = self.status(S, regions)
        if s == "fits":
            return S, 0, "fits"
        if s == "short":                                   # more stories, in order, until it fills (or would be too full)
            T = list(S)
            for k in rest:
                if len(T) >= MAX_MODULES:
                    break
                T.append(k)
                s2, _ = self.status(T, regions)
                if s2 == "fits":
                    return T, 0, "fits (more stories)"
                if s2 != "short":
                    T.pop()                                # this one makes it too full: try a later (shorter) one
        removable = [k for k in S if k not in fixed]
        # too full, or in a gap: the least important free story replaced by a later one, then by two, then fewer stories
        for drop in (1, 2):
            if len(removable) < drop:
                break
            base = [k for k in S if k not in removable[-drop:]]
            for c in rest[:SWAP_TRIES]:
                if self.status(base + [c], regions)[0] == "fits":
                    return base + [c], 0, "fits (swapped)"
            s2, _ = self.status(base, regions)
            if s2 == "fits" and len(base) >= min(MIN_MODULES, len(S)):
                return base, 0, "fits (fewer stories)"
            if drop == 1 and len(base) + 2 <= MAX_MODULES:
                for i, c in enumerate(rest[:SWAP_TRIES]):
                    for c2 in rest[i + 1:SWAP_TRIES]:
                        if self.status(base + [c, c2], regions)[0] == "fits":
                            return base + [c, c2], 0, "fits (swapped for two)"
        # nothing fills exactly: the set that comes closest from below, with white at the foot (one region only)
        if len(regions) == 1:
            H = region_heights(regions)[0]
            best = None
            cands = [S] + [[k for k in S if k not in removable[-d:]] for d in (1, 2) if len(removable) >= d]
            for keys in cands:
                order, opts = self.opts_for(keys)
                if not order:
                    continue
                R = reach(opts, G.NCOL, H)
                iv = R[((1 << len(order)) - 1, regions[0][1])]
                below = [min(b, H) for a, b in iv if a <= H]
                if below and (best is None or max(below) > best[1]):
                    best = (keys, max(below))
            if best:
                return best[0], H - best[1], "short (white at the foot)"
        return S, None, "does not fill"
