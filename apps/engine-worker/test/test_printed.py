"""What a page prints, as the API reads it (ED-15): the API's TypeScript port of the Desk's engine/deskprinted.py
article_sig (apps/api/src/modules/editor/printed.ts) is checked against packages/contracts/test/fixtures/printed-sigs.json
(apps/api/test/unit/printed.test.ts), and this checks that fixture against the Desk's own code, so the two can never
drift apart unseen. PGN_WRITE_FIXTURE=1 writes it again. Fictional text only.
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from pgn_worker import launcher  # noqa: E402
from pgn_worker.desk import editing  # noqa: E402

DP = editing.deskprinted
FIXTURE = WORKER.parents[1] / "packages" / "contracts" / "test" / "fixtures" / "printed-sigs.json"
PHOTO = {"id": "p-0123456789", "caption": "  काल्पनिक   छायाचित्र ", "credit": "Fictional Desk", "width_px": 10}
# what a story's fields can hold: Marathi, decomposed letters (NFC), every kind of white space Python splits on, line
# breaks of every kind, empty lines, subheadings, a missing or null field, a photo with or without its words
ARTICLES = [
    {"headline": "काल्पनिक बातमी", "body": "पहिला परिच्छेद.\n\nदुसरा परिच्छेद."},
    {"headline": "  Fictional\tfair opens ", "kicker": "City", "deck": "A deck", "byline": "A. Reporter",
     "body": "Line one  with   spaces\r\nline two\r\rline three\n\n\n\nafter empty lines\n## A subheading\nlast",
     "photo": PHOTO},
    {"headline": "Café decomposed", "body": "é and é　wide nbsp narrow\x1cfile sep\x85nel",
     "kicker": None, "deck": None, "byline": None, "photo": None},
    {"headline": "", "body": "   \n\n  ## heading only  \n   "},
    {"headline": "Quotes \"and\" back\\slash", "body": "tab\tinside line sep para sep\vvt\fff\x7fdel",
     "photo": {"id": "", "caption": None, "credit": ""}},
    {"headline": "Short item", "body": "##\n## Sub\ntext\n\n\n"},
    # code points Unicode 14 (Python 3.11) does not know and later versions normalise: the port must leave them alone
    {"headline": "a\u0897\u0301b \U00011F41\u0301", "body": "e\u0301\u0897x\n\U0001E4EC\u0301y", "byline": "\u1ACF\u0301"},
]


def cases() -> list[dict]:
    return [{"article": a, "brief": brief, "sig": DP.article_sig(a, brief)} for a in ARTICLES for brief in (False, True)]


class PrintedTests(unittest.TestCase):
    def test_the_fixture_is_the_desks_own_signatures(self):
        got = {"version": DP.VERSION, "cases": cases()}
        if os.environ.get("PGN_WRITE_FIXTURE") == "1":
            FIXTURE.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertEqual(json.loads(FIXTURE.read_text(encoding="utf-8")), got)

    def test_a_finished_run_reports_each_pages_record_and_none_without_one(self):
        with tempfile.TemporaryDirectory() as tmp:
            run_dir = Path(tmp)
            self.assertEqual(launcher.run_printed(None), {})
            self.assertEqual(launcher.run_printed(run_dir), {})                  # no printed.json
            record = {"v": DP.VERSION, "articles": {"a-0000000001": "0" * 20}, "folio": None, "ads": {}}
            (run_dir / "printed.json").write_text(json.dumps({"pages": {"1": record, "2": "not a record"}}),
                                                  encoding="utf-8")
            self.assertEqual(launcher.run_printed(run_dir), {"1": record})
            (run_dir / "printed.json").write_text("{not json", encoding="utf-8")
            self.assertEqual(launcher.run_printed(run_dir), {})                  # damaged: no record (needs saving)


if __name__ == "__main__":
    unittest.main()
