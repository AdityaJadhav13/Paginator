"""Tests for the job runner (pgn_worker/jobs.py, pgn_worker/run.py): every outcome and exit code, in-process and as the
real command. Fictional pictures; the store is a folder, or (with PGN_WORKER_S3_RUN=1, then failing, never skipping)
the S3 store of the `PGN_S3_*` settings, in a bucket of the test's own, removed after.
    <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import secrets
import struct
import subprocess
import sys
import unittest
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
WORKER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(WORKER))

from PIL import Image, ImageFile, ImageOps  # noqa: E402

from pgn_worker import jobs, keys, run  # noqa: E402
from pgn_worker.desk import images, util  # noqa: E402
from pgn_worker.keys import KeyGuard  # noqa: E402
from pgn_worker.storage_s3 import StorageError  # noqa: E402

from test_media import ASSET, ICC, ORG, OTHER_ORG, PUB, Case, picture  # noqa: E402

RUN_S3 = os.environ.get("PGN_WORKER_S3_RUN") == "1"


def png(size, mode: str = "1") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size).save(buf, "PNG")
    return buf.getvalue()


def jpeg(size, mode: str = "RGB") -> bytes:
    buf = io.BytesIO()
    Image.new(mode, size, 128).save(buf, "JPEG")
    return buf.getvalue()


def with_segment(marker: int, body: bytes) -> bytes:
    """A small JPEG with one more segment after its start (a damaged EXIF or MPO index)."""
    j = jpeg((40, 30))
    return j[:2] + bytes([0xFF, marker]) + struct.pack(">H", len(body) + 2) + body + j[2:]


# pictures that make Pillow warn (to stderr, unless the runner silences it): over its decompression-bomb limit
# (89.5 MP) and refused by the Desk (100 MP) or accepted; EXIF that names bytes past its end; a malformed MPO index
NOISY = {"a bomb the Desk refuses": lambda: png((12000, 9000)),
         "a bomb the Desk accepts": lambda: jpeg((9500, 9500), "L"),
         "a truncated EXIF": lambda: with_segment(0xE1, b"Exif\x00\x00MM\x00*\x00\x00\x00\x08\x00\x01"
                                                  + struct.pack(">HHII", 0x010F, 2, 4000, 0x100) + b"\x00" * 4),
         "a malformed MPO": lambda: with_segment(0xE2, b"MPF\x00MM\x00*\x00\x00\x00\x08" + b"\xff" * 12)}


class Failing:
    """A store that fails every read with the error given."""

    def __init__(self, error: BaseException):
        self.error = error

    def get(self, key, version_id):
        raise self.error

    def put(self, key, data, content_type):
        raise AssertionError("nothing is written")


class RunTests(Case):
    def job(self, data: bytes | None = None, **args) -> dict:
        return {"format": jobs.JOB_FORMAT, "id": "job-0001", "kind": "media.ingest",
                "args": {**self.upload(picture() if data is None else data), **args}}

    def run_it(self, job, store=None, icc: str = ICC) -> dict:
        return jobs.run(job, lambda guard: self.store if store is None else store, icc)

    def test_done_is_the_event_for_the_inbox(self):
        out = self.run_it(self.job())
        self.assertEqual((out["format"], out["job"], out["kind"], out["outcome"]),
                         (jobs.RESULT_FORMAT, "job-0001", "media.ingest", "done"))
        self.assertEqual(out["event"]["kind"], "media.ready")
        self.assertNotIn("error", out)
        out = self.run_it(self.job(b"not a picture, only fictional bytes"))     # a refused photo is a finished job
        self.assertEqual((out["outcome"], out["event"]["kind"], out["event"]["code"]),
                         ("done", "media.rejected", "m.img.notAPicture"))

    def test_a_job_that_is_not_one_this_runner_takes_fails_for_good(self):
        good = self.job()
        bad_jobs = [None, [], "x", {**good, "extra": 1}, {k: v for k, v in good.items() if k != "id"},
                    {**good, "format": "pageinator.worker-job/2"}, {**good, "id": ""}, {**good, "id": "a b"},
                    {**good, "id": "x" * 129}, {**good, "kind": "engine.layout"},
                    {**good, "args": {**good["args"], "extra": "1"}},
                    {**good, "args": {k: v for k, v in good["args"].items() if k != "sha256"}},
                    {**good, "args": {**good["args"], "version_id": 7}}, {**good, "args": []},
                    {**good, "args": {**good["args"], "sha256": "Z" * 64}},
                    {**good, "kind": ["media.ingest"]}, {**good, "kind": {"media.ingest": 1}},      # unhashable kinds
                    {**good, "args": {**good["args"], "original_key": "orgs/x"}},                     # ids only
                    {**good, "args": {**good["args"], "version_id": "v\ud800"}}]                      # a lone surrogate
        for job in bad_jobs:
            with self.subTest(job=str(job)[:60]):
                out = self.run_it(job)
                self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.job"), out)
                self.assertNotIn("event", out)
                self.assertNotIn("\ud800", out["error"]["message"])
                json.dumps(out).encode("utf-8")

    def test_final_failures_say_which(self):
        for name, job, code in (("another organisation's asset", self.job(org_id=OTHER_ORG), "worker.missing"),
                                ("an asset that is not an id", self.job(asset_id="../" + ASSET), "worker.key"),
                                ("an id that is not one", self.job(org_id=ORG.upper()), "worker.key"),
                                ("not the stored bytes", self.job(sha256="0" * 64), "worker.checksum"),
                                ("a version not in the store", self.job(version_id="f" * 64), "worker.missing")):
            with self.subTest(name):
                out = self.run_it(job)
                self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", code), out)

    def test_retryable_failures_say_which_and_decide_nothing(self):
        for name, store, icc, code in (
                ("the store failed", Failing(StorageError("the store refused to read x: SlowDown")), ICC,
                 "worker.store"),
                ("out of memory", Failing(MemoryError()), ICC, "worker.memory")):
            with self.subTest(name):
                out = self.run_it(self.job(), store, icc)
                self.assertEqual((out["outcome"], out["error"]["code"]), ("retry", code), out)
                self.assertNotIn("event", out)
        convert = images.convert_photo
        images.convert_photo = lambda data: (_ for _ in ()).throw(util.DeskError(500, "a fictional conversion fault"))
        try:
            out = self.run_it(self.job())
        finally:
            images.convert_photo = convert
        self.assertEqual((out["outcome"], out["error"]["code"], out["error"]["message"]),
                         ("retry", "worker.profile", "the colour conversion could not run"))      # never the profile's path

    def test_a_profile_that_is_not_the_given_one_is_the_workers_settings(self):
        out = self.run_it(self.job(), icc="b" * 64)
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.config"))
        self.assertNotIn(str(self.profile), json.dumps(out))

    def test_running_out_of_memory_while_decoding_is_a_retry_not_a_damaged_picture(self):
        for name, target in (("decoding", (ImageFile.ImageFile, "load")), ("turning", (ImageOps, "exif_transpose"))):
            with self.subTest(name), mock.patch.object(*target, side_effect=MemoryError):
                out = self.run_it(self.job(picture(orientation=6)))
                self.assertEqual((out["outcome"], out["error"]["code"]), ("retry", "worker.memory"), out)

    def test_a_picture_wider_than_the_contract_is_refused(self):
        out = self.run_it(self.job(png((200_000, 1))))
        self.assertEqual((out["outcome"], out["event"]["kind"], out["event"]["code"], out["event"]["status"]),
                         ("done", "media.rejected", "m.img.tooManyPixels", 413))

    def test_messages_are_short_and_never_repeat_the_job(self):
        name = "a reporter's fictional photo.jpg"
        for part in ("\x00" * 1000, "\U0010ffff" * 2000, name):
            with self.subTest(part=part[:3]):
                with self.assertRaises(keys.KeyRefused) as e:
                    KeyGuard(ORG, PUB).key("assets", part)
                self.assertEqual(str(e.exception), "a key part is not plain")
        out = jobs.result({}, jobs.FAILED, code="worker.store", message="x" * 5000)
        self.assertEqual(len(out["error"]["message"]), 2000)
        out = self.run_it(self.job(), Failing(ValueError("a fictional value: " + name)))   # not a JobRefused
        self.assertEqual((out["outcome"], out["error"]["code"], out["error"]["message"]),
                         ("failed", "worker.internal", "the worker failed (ValueError)"))

    def test_a_fault_is_final_and_names_only_its_type(self):
        out = self.run_it(self.job(), Failing(RuntimeError("http://127.0.0.1:58333 secret-value")))
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.internal"))
        self.assertEqual(out["error"]["message"], "the worker failed (RuntimeError)")


class CommandTests(Case):
    def main(self, raw: bytes, argv=(), setup=None, environ=None) -> tuple[int, dict, str]:
        out = io.BytesIO()
        setup = setup or (lambda env: ((lambda guard: self.store), ICC))
        code = run.main(list(argv), io.BytesIO(raw), out, environ or {}, setup)
        text = out.getvalue().decode("utf-8")
        self.assertEqual(text.count("\n"), 1, "one line, and only one")
        return code, json.loads(text), text

    def job_bytes(self, data: bytes | None = None, **args) -> bytes:
        job = {"format": jobs.JOB_FORMAT, "id": "job-0002", "kind": "media.ingest",
               "args": {**self.upload(picture() if data is None else data), **args}}
        return json.dumps(job).encode()

    def test_exit_codes(self):
        self.assertEqual(self.main(self.job_bytes())[0], 0)
        self.assertEqual(self.main(self.job_bytes(b"not a picture"))[0], 0)                    # rejected: done
        for raw, code, err in ((b"{not json", 65, "worker.job"), (b"\xff\xfe", 65, "worker.job"),
                               (b" " * (run.MAX_JOB + 1), 65, "worker.job"),
                               (self.job_bytes(sha256="0" * 64), 65, "worker.checksum"),
                               (self.job_bytes(asset_id="x"), 65, "worker.key"),
                               (b'{"format": "pageinator.worker-job/1", "id": "j", "kind": [], "args": {}}', 65,
                                "worker.job")):
            with self.subTest(err=err, size=len(raw)):
                got, out, _ = self.main(raw)
                self.assertEqual((got, out["outcome"], out["error"]["code"]), (code, "failed", err))
        got, out, _ = self.main(self.job_bytes(), setup=lambda env: ((lambda g: self.store), "b" * 64))
        self.assertEqual((got, out["outcome"], out["error"]["code"]), (78, "failed", "worker.config"))
        got, out, _ = self.main(self.job_bytes(), setup=lambda env: ((lambda g: Failing(RuntimeError("x"))), ICC))
        self.assertEqual((got, out["error"]["code"]), (70, "worker.internal"))
        with mock.patch.object(ImageFile.ImageFile, "load", side_effect=MemoryError):
            got, out, _ = self.main(self.job_bytes())
        self.assertEqual((got, out["outcome"], out["error"]["code"]), (75, "retry", "worker.memory"))
        with mock.patch.object(ImageOps, "exif_transpose", side_effect=MemoryError):
            got, out, _ = self.main(self.job_bytes(picture(orientation=6)))
        self.assertEqual((got, out["outcome"], out["error"]["code"]), (75, "retry", "worker.memory"))

    def test_a_fault_outside_every_handler_still_answers_one_fixed_line(self):
        with mock.patch.object(jobs, "result", side_effect=TypeError("a fictional fault")):
            got, out, text = self.main(b'{"kind": []}')
        self.assertEqual((got, text.encode()), (70, run.LAST_RESORT))
        self.assertEqual((out["outcome"], out["error"]["code"]), ("failed", "worker.internal"))

    def test_the_line_is_utf8_whatever_the_locale(self):
        said = "फोटो"
        with mock.patch.object(jobs, "run", return_value=jobs.result({}, jobs.FAILED, code="worker.job", message=said)), \
                mock.patch.object(sys, "stdout", io.TextIOWrapper(io.BytesIO(), encoding="ascii")):
            self.assertEqual(run.main([], io.BytesIO(self.job_bytes()), None, {}, lambda env: (None, ICC)), 65)
            sys.stdout.flush()
            self.assertEqual(json.loads(sys.stdout.buffer.getvalue())["error"]["message"], said)

    def test_the_job_from_a_file(self):
        path = self.tmp / "job.json"
        path.write_bytes(self.job_bytes())
        got, out, _ = self.main(b"", argv=["--job", str(path)])
        self.assertEqual((got, out["outcome"], out["job"]), (0, "done", "job-0002"))
        got, out, _ = self.main(b"", argv=["--job", str(self.tmp / "missing.json")])
        self.assertEqual((got, out["error"]["code"]), (65, "worker.job"))

    def test_the_workers_own_settings(self):
        env = {"PGN_S3_ACCESS_KEY_ID": "fictional-key-id", "PGN_S3_SECRET_ACCESS_KEY": "fictional-secret-value"}
        for name, environ in (("no profile hash", env), ("a profile hash that is not one", {**env, "PGN_ICC_SHA256": "x"}),
                              ("no key pair", {"PGN_ICC_SHA256": ICC}),
                              ("an endpoint that is not allowed", {**env, "PGN_ICC_SHA256": ICC,
                                                                   "PGN_S3_ENDPOINT": "http://s3.example.org"})):
            with self.subTest(name):
                got, out, text = self.main(self.job_bytes(), setup=run._settings, environ=environ)
                self.assertEqual((got, out["outcome"], out["error"]["code"], out["job"]),
                                 (78, "failed", "worker.config", "job-0002"))
                self.assertNotIn("fictional-secret-value", text)
        # a store that cannot be reached: a retry, and no endpoint in the message
        environ = {**env, "PGN_ICC_SHA256": ICC, "PGN_S3_ENDPOINT": "http://127.0.0.1:9"}
        got, out, text = self.main(self.job_bytes(), setup=run._settings, environ=environ)
        self.assertEqual((got, out["outcome"], out["error"]["code"]), (75, "retry", "worker.store"))
        for secret in ("fictional-secret-value", "fictional-key-id", "127.0.0.1:9"):
            self.assertNotIn(secret, text)

    def test_the_real_command_writes_one_line_and_nothing_else(self):
        env = {**{k: v for k, v in os.environ.items() if not k.startswith("PGN_")}, "PYTHONPATH": str(WORKER)}
        p = subprocess.run([sys.executable, "-B", "-m", "pgn_worker.run"], input=b"{not json", capture_output=True,
                           env=env, cwd=WORKER, timeout=60)
        self.assertEqual((p.returncode, p.stderr), (65, b""))
        lines = p.stdout.decode().splitlines()
        self.assertEqual(len(lines), 1)
        self.assertEqual(json.loads(lines[0])["error"]["code"], "worker.job")

    def command(self, data: bytes, stdout=subprocess.PIPE) -> subprocess.CompletedProcess:
        """The real command on a job for `data`, the store a folder (the conversion stood in for, as in Case)."""
        job = json.dumps({"format": jobs.JOB_FORMAT, "id": "job-0004", "kind": "media.ingest",
                          "args": self.upload(data)}).encode()
        stand_in = ("import sys; from pathlib import Path; from pgn_worker.desk import images; "
                    "images.rgb_to_cmyk = lambda img: img.convert('CMYK'); "
                    "from pgn_worker import run; from pgn_worker.storage import FolderStorage; "
                    "store = FolderStorage(Path(sys.argv[1])); "
                    "raise SystemExit(run.main([], setup=lambda env: ((lambda g: store), sys.argv[2])))")
        env = {**{k: v for k, v in os.environ.items() if not k.startswith(("PGN_", "PYTHONWARN"))},
               "PYTHONPATH": str(WORKER), "PAGEINATOR_ICC": str(self.profile)}
        return subprocess.run([sys.executable, "-B", "-c", stand_in, str(self.tmp / "bucket"), ICC], input=job,
                              stdout=stdout, stderr=subprocess.PIPE, env=env, cwd=WORKER, timeout=120)

    def test_pictures_that_make_pillow_warn_leave_stderr_empty(self):
        for name, make in NOISY.items():
            with self.subTest(name):
                p = self.command(make())
                self.assertEqual((p.returncode, p.stderr), (0, b""), name)
                self.assertEqual(json.loads(p.stdout)["outcome"], "done")

    def test_quiet_drops_log_records_and_warnings(self):
        noisy = ("import logging, warnings; from pgn_worker import run; run.quiet(); "
                 "logging.getLogger('PIL.TiffImagePlugin').error('a fictional record'); "
                 "logging.getLogger().critical('another'); warnings.warn('a fictional warning')")
        p = subprocess.run([sys.executable, "-B", "-c", noisy], capture_output=True, cwd=WORKER, timeout=60,
                           env={**os.environ, "PYTHONPATH": str(WORKER)})
        self.assertEqual((p.returncode, p.stdout, p.stderr), (0, b"", b""))

    def test_a_closed_stdout_exits_74_and_leaves_stderr_empty(self):
        read, write = os.pipe()
        os.close(read)                                       # the queue went away before the line
        try:
            p = self.command(picture(), stdout=write)
        finally:
            os.close(write)
        self.assertEqual((p.returncode, p.stderr), (74, b""))


FIXTURE = WORKER.parents[1] / "packages" / "contracts" / "test" / "fixtures" / "worker-results.json"
VOLATILE = ("params_hash", "key", "version_id", "sha256", "bytes")    # the machine's (libjpeg, Pillow) and the store's


def steady(value):
    """A result without what changes with the machine or the store: hashes, sizes in bytes, keys and versions."""
    if isinstance(value, list):
        return [steady(v) for v in value]
    if isinstance(value, dict):
        return {k: None if k in VOLATILE else steady(v) for k, v in value.items()}
    return value


class ContractTests(Case):
    """The results the runner writes, one of each kind, are packages/contracts' fixture: vitest reads every one with
    the TypeScript `WorkerResult` schema, so a result the queue would refuse fails there. Rewrite it with
    PGN_WRITE_FIXTURE=1 after a change to what the runner writes."""

    job, run_it = RunTests.job, RunTests.run_it

    def results(self) -> list[dict]:
        job = self.job
        out = [self.run_it(job()), self.run_it(job(b"not a picture, only fictional bytes")),
               self.run_it({**job(), "args": {**job()["args"], "original_key": "orgs/x"}}),
               self.run_it(job(), icc="b" * 64), self.run_it(job(png((200_000, 1)))),
               self.run_it(job(asset_id="../" + ASSET)), self.run_it({**job(), "kind": ["media.ingest"]}),
               self.run_it(job(), Failing(StorageError("the store refused to read " + "k" * 5000 + ": SlowDown"))),
               self.run_it(job(), Failing(MemoryError())), self.run_it(job(), Failing(ValueError("x"))),
               json.loads(run.LAST_RESORT), self.run_it(job(version_id="f" * 64)),
               self.run_it(job(sha256="0" * 64))]
        self.profile.unlink()                                        # a profile that cannot be read: a retry
        out.append(self.run_it(job()))
        return json.loads(json.dumps(out))

    def test_the_contract_fixture_is_what_the_runner_writes(self):
        got = self.results()
        self.assertEqual([r["outcome"] for r in got], ["done"] * 2 + ["failed"] * 2 + ["done"] + ["failed"] * 2 +
                         ["retry"] * 2 + ["failed"] * 4 + ["retry"])
        for r in got:
            self.assertLessEqual(len(r.get("error", {}).get("message", "")), 2000)
        if os.environ.get("PGN_WRITE_FIXTURE") == "1":
            FIXTURE.write_text(json.dumps(got, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        self.assertEqual(steady(json.loads(FIXTURE.read_text(encoding="utf-8"))), steady(got))


@unittest.skipUnless(RUN_S3, "the store tests run with PGN_WORKER_S3_RUN=1 (and then fail, never skip)")
class CommandStoreTests(Case):
    def test_a_job_through_the_command_and_the_store(self):
        from pgn_worker.storage_s3 import S3Settings
        settings = S3Settings.from_env()
        client = settings.client()
        bucket = f"pgn-worker-test-{secrets.token_hex(6)}"
        client.create_bucket(Bucket=bucket)
        self.addCleanup(self.remove, client, bucket)
        client.put_bucket_versioning(Bucket=bucket, VersioningConfiguration={"Status": "Enabled"})
        data = picture(size=(900, 600), orientation=6)
        key = KeyGuard(ORG, PUB).asset_original(ASSET)
        version = client.put_object(Bucket=bucket, Key=key, Body=data)["VersionId"]
        job = {"format": jobs.JOB_FORMAT, "id": "job-0003", "kind": "media.ingest",
               "args": {"org_id": ORG, "pub_id": PUB, "asset_id": ASSET, "version_id": version,
                        "sha256": hashlib.sha256(data).hexdigest()}}
        env = {**os.environ, "PYTHONPATH": str(WORKER), "PGN_S3_WORK_BUCKET": bucket, "PGN_ICC_SHA256": ICC,
               "PAGEINATOR_ICC": str(self.profile)}
        # the real command, with the conversion stood in for (a CMYK profile is private, and a fictional one is
        # not a profile): its settings, store, output and exit code are the command's own
        stand_in = ("from pgn_worker.desk import images; images.rgb_to_cmyk = lambda img: img.convert('CMYK'); "
                    "from pgn_worker import run; raise SystemExit(run.main())")
        p = subprocess.run([sys.executable, "-B", "-c", stand_in], input=json.dumps(job).encode(),
                           capture_output=True, env=env, cwd=WORKER, timeout=120)
        self.assertEqual((p.returncode, p.stderr), (0, b""), p.stdout[:500])
        out = json.loads(p.stdout)
        self.assertEqual((out["outcome"], out["event"]["kind"], out["event"]["width_px"]), ("done", "media.ready", 600))
        for secret in (settings.access_key_id, settings.secret_access_key):
            self.assertNotIn(secret.encode(), p.stdout)

    @staticmethod
    def remove(client, bucket: str) -> None:
        assert bucket.startswith("pgn-worker-test-")
        listed = client.list_object_versions(Bucket=bucket)
        for v in [*listed.get("Versions", []), *listed.get("DeleteMarkers", [])]:
            client.delete_object(Bucket=bucket, Key=v["Key"], VersionId=v["VersionId"])
        client.delete_bucket(Bucket=bucket)


if __name__ == "__main__":
    unittest.main()
