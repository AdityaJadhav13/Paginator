"""Tests for docx.import (pgn_worker/docx_import.py) through the job runner: a Word file's stories in a result file, the
Desk's refusals as finished jobs with its words, every Desk note and refusal given its code, the key guard and the
checksum. Fictional files only, built by the Desk's own test helpers (tools/desk/test/test_docx.py).
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import shutil
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))
sys.path.insert(0, str(WORKER.parents[1] / "tools" / "desk" / "test"))

from pgn_worker import docx_import, jobs  # noqa: E402
from pgn_worker.desk import docx  # noqa: E402
from pgn_worker.keys import KeyGuard  # noqa: E402
from pgn_worker.storage import FolderStorage  # noqa: E402

import test_docx as desk  # noqa: E402  (the Desk's fictional .docx builders)

from test_media import ICC, ORG, OTHER_ORG, PUB  # noqa: E402

IMPORT = "01890a5d-ac96-774b-bcce-b302099a8061"


class DocxImportTest(unittest.TestCase):
    def setUp(self):
        self.tmp = Path(tempfile.mkdtemp(prefix="worker-docx-"))
        self.addCleanup(shutil.rmtree, self.tmp)
        self.store = FolderStorage(self.tmp / "bucket")
        self.guard = KeyGuard(ORG, PUB)

    def job(self, data: bytes, org: str = ORG, **over) -> dict:
        version = self.store.put(KeyGuard(org, PUB).key("imports", IMPORT, "original"), data, "application/octet-stream")
        args = {"org_id": org, "pub_id": PUB, "import_id": IMPORT, "version_id": version,
                "sha256": hashlib.sha256(data).hexdigest(), **over}
        return {"format": jobs.JOB_FORMAT, "id": "41", "kind": "docx.import", "args": args}

    def run_job(self, job: dict) -> dict:
        return jobs.run(job, lambda guard: self.store, ICC)

    def test_a_good_file_gives_its_stories_in_a_result_file(self):
        data = desk.docx([("Title", "काल्पनिक बातमी"), ("", "Byline: A. Writer"), ("", "पहिला परिच्छेद."),
                          ("Heading1", "Second fictional story"), ("", "Its text."), desk.table("cell")])
        out = self.run_job(self.job(data))
        self.assertEqual(out["outcome"], "done", out)
        event = out["event"]
        key = self.guard.key("imports", IMPORT, f"result-{hashlib.sha256(data).hexdigest()}.json")
        self.assertEqual({k: event[k] for k in ("kind", "org_id", "pub_id", "import_id", "result_key", "articles")},
                         {"kind": "import.parsed", "org_id": ORG, "pub_id": PUB, "import_id": IMPORT,
                          "result_key": key, "articles": 2})
        body = self.store.get(key, event["result_version_id"])
        self.assertEqual(hashlib.sha256(body).hexdigest(), event["result_sha256"])
        result = json.loads(body)
        self.assertEqual(result["format"], "pageinator.docx-result/1")
        self.assertEqual(result["articles"], docx.articles_from_docx(data)["articles"])
        self.assertEqual(result["articles"][0], {"headline": "काल्पनिक बातमी", "byline": "A. Writer",
                                                 "body": "पहिला परिच्छेद."})
        self.assertEqual(result["notes"], [{"code": "docx.tables", "count": 1, "text": docx.articles_from_docx(data)[
            "notes"][0]}])
        self.assertNotIn("पहिला", json.dumps(event, ensure_ascii=False))       # no story text in the event

    def test_run_again_writes_the_same_key(self):
        data = desk.docx([("", "Fictional headline"), ("", "Text.")])
        first, second = self.run_job(self.job(data)), self.run_job(self.job(data))
        self.assertEqual(first["event"]["result_key"], second["event"]["result_key"])
        self.assertEqual(first["event"]["result_sha256"], second["event"]["result_sha256"])

    def test_bad_files_are_refused_with_the_desks_words(self):
        bomb = io.BytesIO()
        with zipfile.ZipFile(bomb, "w", zipfile.ZIP_DEFLATED) as z:
            z.writestr("word/document.xml", b"<" * (docx.MAX_XML + 10))
        cases = {
            "not a zip": (b"plain text, not a Word file", "docx.not_word", desk.NOT_WORD),
            "a zip, not Word": (_zip("content.xml"), "docx.not_word", desk.NOT_WORD),
            "cut off": (desk.docx([("", "Headline"), ("", "Text")])[:60], "docx.damaged", desk.DAMAGED),
            "a zip bomb": (bomb.getvalue(), "docx.too_large", docx.TOO_LARGE),
            "protected or .doc": (docx.OLE + b"\0" * 64, "docx.protected", desk.PROTECTED),
            "no story": (desk.docx([("", "Only a headline")]), "docx.no_story", None),
        }
        for name, (data, code, message) in cases.items():
            with self.subTest(name):
                out = self.run_job(self.job(data))
                self.assertEqual(out["outcome"], "done", out)
                self.assertEqual(out["event"]["kind"], "import.rejected")
                self.assertEqual((out["event"]["code"], out["event"]["status"]), (code, 400))
                if message:
                    self.assertEqual(out["event"]["message"], message)

    def test_too_big_is_refused(self):
        with mock.patch.object(docx, "MAX_BYTES", 100):
            out = self.run_job(self.job(desk.docx([("", "Headline"), ("", "Text " * 50)])))
        self.assertEqual((out["event"]["kind"], out["event"]["code"]), ("import.rejected", "docx.over_size"))

    def test_every_desk_note_has_its_code(self):
        said = {
            "This file holds more than 200 stories; only the first 200 were imported.": ("docx.too_many_stories", 200),
            "1 heading had no text under it and was not imported.": ("docx.empty_headings", 1),
            "2 headings had no text under them and were not imported.": ("docx.empty_headings", 2),
            "1 table was not imported: copy its text into the article if it is needed.": ("docx.tables", 1),
            "3 tables were not imported: copy their text into the article if it is needed.": ("docx.tables", 3),
            "1 text box was not imported.": ("docx.text_boxes", 1),
            "3 text boxes were not imported.": ("docx.text_boxes", 3),
            "1 picture was not imported: add photos in the Desk.": ("docx.pictures", 1),
            "2 pictures were not imported: add photos in the Desk.": ("docx.pictures", 2),
            desk.FORMATTING: ("docx.formatting", None),
            "A sentence the Desk may say one day.": ("docx.note", None),
        }
        for text, (code, count) in said.items():
            with self.subTest(text):
                self.assertEqual(docx_import.note(text), {"code": code, "count": count, "text": text})
        # and what the Desk really says for a file with them
        data = desk.docx([("", "Headline"), desk.para(desk.bold("Bold text.")), desk.table("a"), desk.table("b"),
                          ("Heading1", "Empty"), desk.para(desk.text_box("box"))])
        got = [docx_import.note(n)["code"] for n in docx.articles_from_docx(data)["notes"]]
        self.assertNotIn("docx.note", got)

    def test_another_organisations_key_is_refused(self):
        # the job names organisation A; its file is under organisation B: the key guard never reads it
        data = desk.docx([("", "Headline"), ("", "Text")])
        job = self.job(data, org=OTHER_ORG)
        job["args"]["org_id"] = ORG
        out = self.run_job(job)
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.missing"))

        class Guarded(FolderStorage):                       # what S3Storage does: every key through its job's guard
            def __init__(self, root, guard):
                super().__init__(root)
                self.guard = guard

            def get(self, key, version_id):
                return super().get(self.guard.check(key), version_id)

        theirs = KeyGuard(OTHER_ORG, PUB)
        out = jobs.run(self.job(data), lambda guard: Guarded(self.tmp / "bucket", theirs), ICC)
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.key"))

    def test_other_bytes_are_refused(self):
        job = self.job(desk.docx([("", "Headline"), ("", "Text")]))
        job["args"]["sha256"] = "0" * 64
        self.assertEqual(self.run_job(job)["error"]["code"], "worker.checksum")

    def test_arguments_are_checked(self):
        job = self.job(desk.docx([("", "Headline"), ("", "Text")]))
        job["args"]["asset_id"] = IMPORT
        self.assertEqual(self.run_job(job)["error"]["code"], "worker.job")
        job = self.job(desk.docx([("", "Headline"), ("", "Text")]), sha256="ABC")
        self.assertEqual(self.run_job(job)["error"]["code"], "worker.job")


FIXTURE = WORKER.parents[1] / "packages" / "contracts" / "test" / "fixtures" / "docx-results.json"
VOLATILE = ("sha256", "result_sha256", "result_version_id", "version_id", "result_key")


class ContractTests(unittest.TestCase):
    """The results docx.import writes (parsed, rejected) are packages/contracts' fixture: vitest reads them with the
    TypeScript `WorkerResult`. Rewrite it with PGN_WRITE_FIXTURE=1 after a change to what the runner writes."""

    setUp, job, run_job = DocxImportTest.setUp, DocxImportTest.job, DocxImportTest.run_job

    def test_the_contract_fixture_is_what_the_runner_writes(self):
        got = [self.run_job(self.job(desk.docx([("", "Fictional headline"), ("", "Text."), desk.table("a")]))),
               self.run_job(self.job(b"not a Word file, only fictional bytes"))]
        got = json.loads(json.dumps(got))
        if os.environ.get("PGN_WRITE_FIXTURE") == "1":
            FIXTURE.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        steady = lambda rs: [{**r, "event": {k: None if k in VOLATILE else v for k, v in r["event"].items()}}  # noqa: E731
                             for r in rs]
        self.assertEqual(steady(json.loads(FIXTURE.read_text(encoding="utf-8"))), steady(got))


def _zip(name: str) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr(name, "<x/>")
    return buf.getvalue()


if __name__ == "__main__":
    unittest.main()
