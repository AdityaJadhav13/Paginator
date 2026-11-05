"""Tests for engine.onboard (pgn_worker/onboard.py, L4) through the job runner, with a fake onboarding tool
(test/fake_onboard.py: the real one takes minutes on real PDFs). Fictional data only; the store is a folder.
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import sys
import threading
import time
import unittest
import zipfile
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from pgn_worker import jobs, keys, onboard, run  # noqa: E402

from test_engine_jobs import Case, steady  # noqa: E402
from test_media import ICC, ORG, OTHER_ORG, PUB  # noqa: E402

ONBOARDING = "01890a5d-ac96-774b-bcce-b302099a8070"
FAKE = WORKER / "test" / "fake_onboard.py"
FIXTURE = WORKER.parents[1] / "packages" / "contracts" / "test" / "fixtures" / "onboard-results.json"


def pdf(n: int) -> bytes:
    return b"%PDF-1.7\n% a fictional edition " + str(n).encode() + b"\n%%EOF\n"


class OnboardCase(Case):
    def setUp(self):
        super().setUp()
        self.env.update({"PGN_ONBOARD_PYTHON": sys.executable, "PAGEINATOR_ONBOARD_SCRIPT": str(FAKE)})

    def args(self, mode: str = "ready", files: int = 3, inputs: dict | None = None) -> dict:
        listed = []
        for n in range(1, files + 1):
            data = pdf(n)
            pinned = self.put(self.guard.onboarding_pdf(ONBOARDING, n), data)
            listed.append({"n": n, "name": f"{mode} Edition 2026-01-{n:02d}.pdf", **pinned, "bytes": len(data)})
        doc = inputs or {"format": onboard.INPUTS_FORMAT, "files": listed}
        pinned = self.put(self.guard.onboarding_inputs(ONBOARDING), json.dumps(doc).encode("utf-8"))
        return {"org_id": ORG, "pub_id": PUB, "onboarding_id": ONBOARDING, **pinned}

    @property
    def work(self) -> Path:
        return self.home / "onboarding" / ONBOARDING

    def assert_gone(self, pgid: int) -> None:
        with self.assertRaises(ProcessLookupError):
            os.killpg(pgid, 0)

    def onboard(self, args: dict, **kw) -> dict:
        out = self.run_job("engine.onboard", args, **kw)
        self.assertFalse(self.work.exists(), "the work folder is removed, whatever the end")
        return out


class OnboardTests(OnboardCase):
    def test_a_bundle_is_made_packed_and_stored(self):
        args = self.args("ready")
        out = self.onboard(args)
        ev = out["event"]
        self.assertEqual((out["outcome"], ev["kind"]), ("done", "onboard.ready"))
        self.assertEqual({k: ev[k] for k in ("org_id", "pub_id", "onboarding_id", "sha256")},
                         {"org_id": ORG, "pub_id": PUB, "onboarding_id": ONBOARDING, "sha256": args["sha256"]})
        self.assertEqual([f["n"] for f in ev["files"]], [1, 2, 3])
        self.assertEqual(ev["report"]["grid"]["columns"], 6)
        ds = ev["dataset"]
        self.assertEqual(ds["key"], f"orgs/{ORG}/pubs/{PUB}/onboarding/{ONBOARDING}/dataset.zip")
        data = self.store.get(ds["key"], ds["version_id"])
        self.assertEqual((hashlib.sha256(data).hexdigest(), len(data)), (ds["sha256"], ds["bytes"]))
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            self.assertIn("report/page1/pages/fictional-p1.json", z.namelist())
            given = json.loads(z.read("env.json"))
        self.assertFalse([k for k in given if k.startswith(("PGN_", "AWS_"))], "never the worker's settings")
        steps = [(e["step"], e["done"]) for e in self.lines]
        self.assertEqual(steps[0], ("checking", 0))
        self.assertIn(("learning", 3), steps)
        self.assertEqual(steps[-1], ("packing", 1))
        self.assertTrue(all(e["kind"] == "onboard.progress" and e["onboarding_id"] == ONBOARDING for e in self.lines))
        said = [(e["step"], e["done"], e["total"]) for e in self.lines]
        self.assertEqual(len(said), len(set(said)), "said once per change")

    def test_a_set_the_tool_refuses_is_a_finished_job(self):
        ev = self.onboard(self.args("rejected"))["event"]
        self.assertEqual((ev["kind"], ev["code"], ev["params"]), ("onboard.rejected", "onboard.no_grid", None))
        self.assertEqual(ev["message"], "No column grid was found on these pages.")
        self.assertEqual(len(ev["files"]), 3)
        self.assertFalse((self.tmp / "bucket" / self.guard.onboarding_dataset(ONBOARDING)).exists())

    def test_a_tool_that_crashes_or_answers_nothing_fails(self):
        for mode in ("crash", "silent"):
            out = self.onboard(self.args(mode))
            self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.onboard"), mode)

    def test_a_stalled_tool_is_stopped(self):
        started = time.monotonic()
        out = self.onboard(self.args("stall"), env={"PGN_ENGINE_STALL_S": "1"})
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.stalled"))
        self.assertLess(time.monotonic() - started, 20)

    def test_the_heartbeat_repeats_the_last_line(self):
        with mock.patch.object(onboard.launcher, "HEARTBEAT_S", 0.05):
            out = self.onboard(self.args("ready"))
        self.assertEqual(out["event"]["kind"], "onboard.ready")
        steps = [(e["step"], e["done"]) for e in self.lines]
        self.assertGreater(len(steps), len(set(steps)))

    def test_a_cancel_stops_the_tools_group(self):
        for mode in ("slow", "stubborn"):
            self.lines.clear()
            cancel, seen = threading.Event(), {}

            def watch():
                while not any(e["step"] == "reading" for e in self.lines):
                    time.sleep(0.02)
                seen["pgid"] = int((self.work / "onboard.pid").read_text())
                cancel.set()
            t = threading.Thread(target=watch, daemon=True)
            t.start()
            out = self.onboard(self.args(mode), cancel=cancel)
            t.join(5)
            self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.cancelled"), mode)
            self.assert_gone(seen["pgid"])

    def test_other_bytes_than_the_job_names_are_refused(self):
        args = self.args()
        out = self.onboard({**args, "sha256": "1" * 64})
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))
        doc = json.loads(self.store.get(self.guard.onboarding_inputs(ONBOARDING), args["version_id"]))
        doc["files"][1]["sha256"] = "2" * 64                                  # a PDF that is not the one named
        out = self.onboard(self.args(inputs=doc))
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.checksum"))

    def test_inputs_the_worker_does_not_take(self):
        good = json.loads(self.store.get(self.guard.onboarding_inputs(ONBOARDING), self.args()["version_id"]))
        f = good["files"][0]
        for bad in ({**good, "format": "x"}, {**good, "files": good["files"][:2]},
                    {**good, "files": [f, f, good["files"][2]]}, {**good, "extra": 1},
                    {**good, "files": [{**f, "n": 41}, *good["files"][1:]]},
                    {**good, "files": [{**f, "bytes": onboard.MAX_PDF_BYTES + 1}, *good["files"][1:]]}):
            out = self.onboard(self.args(inputs=bad))
            self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.job"), bad)
        for args in ({**self.args(), "onboarding_id": "x"}, {**self.args(), "extra": "1"}):
            out = self.run_job("engine.onboard", args)
            self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.job"))

    def test_a_job_for_one_organisation_reaches_no_key_of_another(self):
        other = keys.KeyGuard(OTHER_ORG, PUB)
        for key in (other.onboarding_inputs(ONBOARDING), other.onboarding_pdf(ONBOARDING, 1),
                    other.onboarding_dataset(ONBOARDING)):
            self.assertTrue(key.startswith(f"orgs/{OTHER_ORG}/pubs/{PUB}/onboarding/{ONBOARDING}/"))
            with self.assertRaises(keys.KeyRefused):
                self.guard.check(key)
        for n in (0, 41, "1", True):
            with self.assertRaises(keys.KeyRefused):
                self.guard.onboarding_pdf(ONBOARDING, n)
        # the other organisation's job names its own ids: the files this one stored are not reached
        args = self.args()
        out = self.onboard({**args, "org_id": OTHER_ORG})
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.missing"))

    def test_the_tools_settings(self):
        for env in ({"PGN_ONBOARD_PYTHON": ""}, {"PGN_ONBOARD_PYTHON": "python3"},
                    {"PAGEINATOR_ONBOARD_SCRIPT": str(self.tmp / "none.py")}, {"PGN_ENGINE_PYTHON": ""}):
            out = self.run_job("engine.onboard", self.args(), env=env)
            self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.config"), env)

    def test_the_command_writes_progress_lines_then_the_result(self):
        job = json.dumps({"format": jobs.JOB_FORMAT, "id": "job-8", "kind": "engine.onboard",
                          "args": self.args()}).encode()
        out = io.BytesIO()
        code = run.main([], stdin=io.BytesIO(job), stdout=out, environ=self.env,
                        setup=lambda environ: ((lambda guard: self.store), ICC))
        self.assertEqual(code, 0)
        lines = [json.loads(x) for x in out.getvalue().decode("utf-8").splitlines()]
        self.assertTrue(all(x["format"] == run.PROGRESS_FORMAT for x in lines[:-1]))
        self.assertEqual(lines[-1]["event"]["kind"], "onboard.ready")
        job = json.dumps({"format": jobs.JOB_FORMAT, "id": "job-9", "kind": "engine.onboard",
                          "args": self.args("crash")}).encode()
        code = run.main([], stdin=io.BytesIO(job), stdout=io.BytesIO(), environ=self.env,
                        setup=lambda environ: ((lambda guard: self.store), ICC))
        self.assertEqual(code, 70)


class ContractTests(OnboardCase):
    """What engine.onboard writes (ready, rejected, a failure, and a progress line) is packages/contracts' fixture
    (onboard-results.json), read by vitest with WorkerResult and WorkerProgress. Rewrite it with PGN_WRITE_FIXTURE=1."""

    def test_the_contract_fixture_is_what_the_runner_writes(self):
        results = [self.onboard(self.args(mode)) for mode in ("ready", "rejected", "crash")]
        progress = [{"format": run.PROGRESS_FORMAT, "job": "job-7", "seq": 1, "event": self.lines[0]}]
        got = json.loads(json.dumps({"results": results, "progress": progress}))
        if os.environ.get("PGN_WRITE_FIXTURE") == "1":
            FIXTURE.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertEqual(steady(json.loads(FIXTURE.read_text(encoding="utf-8"))), steady(got))


if __name__ == "__main__":
    unittest.main()
