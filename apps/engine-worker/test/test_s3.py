"""Tests for the worker's S3 adapter (pgn_worker/storage_s3.py). The settings, the key guard and every branch of a read
and a write are tested here always, on a fake client; the store itself only with PGN_WORKER_S3_RUN=1 and the
`PGN_S3_*` settings of a SeaweedFS (or S3), and then they fail, never skip, when the store cannot be used. They make
buckets of their own (`pgn-worker-test-<random>`, versioned) and remove them, every version included, whatever
happens; no other bucket is touched. Fictional pictures only.
    PGN_WORKER_S3_RUN=1 PGN_S3_ACCESS_KEY_ID=… PGN_S3_SECRET_ACCESS_KEY=… \\
      <worker venv>/bin/python -B -m unittest discover -s apps/engine-worker/test
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import secrets
import stat
import sys
import tempfile
import unittest
from pathlib import Path

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from botocore.exceptions import ClientError, ReadTimeoutError  # noqa: E402
from botocore.response import StreamingBody  # noqa: E402

from pgn_worker import keys, media  # noqa: E402
from pgn_worker.storage import MissingObject  # noqa: E402
from pgn_worker.storage_s3 import LOGGERS, MAX_OBJECT, S3Settings, S3Storage, SettingsError, StorageError  # noqa: E402

from test_media import ASSET, ICC, ORG, OTHER_ORG, PUB, Case, picture  # noqa: E402

RUN = os.environ.get("PGN_WORKER_S3_RUN") == "1"
ENV = {"PGN_S3_ACCESS_KEY_ID": "fictional-key-id", "PGN_S3_SECRET_ACCESS_KEY": "fictional-secret-value"}
KEY = keys.KeyGuard(ORG, PUB).asset_original(ASSET)


class SettingsTests(unittest.TestCase):
    def test_the_apis_settings_and_rules(self):
        s = S3Settings.from_env(ENV)
        self.assertEqual((s.endpoint, s.region, s.work_bucket, s.path_style),
                         ("http://127.0.0.1:58333", "ap-south-1", "pgn-dev-work", True))
        for good, path_style in (("https://s3.ap-south-1.amazonaws.com", False), ("https://store.example.org:8443", False),
                                 ("http://localhost:9000", True), ("http://[::1]:9000", True),
                                 ("https://127.0.0.1:9000", True)):
            self.assertEqual(S3Settings.from_env({**ENV, "PGN_S3_ENDPOINT": good}).path_style, path_style, good)
        for bad in ("http://s3.example.org", "http://127.0.0.2:9000", "http://10.0.0.5:9000",   # http off the 3 names
                    "https://s3.example.org/", "https://s3.example.org/bucket", "https://user:pw@s3.example.org",
                    "HTTPS://s3.example.org", "https://S3.example.org", "http://LOCALHOST:9000",
                    " http://127.0.0.1:58333", "http://127.0.0.1:58333 ", "http://127.0.0.1:58333\n",
                    "https://s3.example.org:443", "http://127.0.0.1:80", "http://127.0.0.1:058333",
                    "http://127.0.0.1:65536", "http://127.1:58333", "http://0x7f.0.0.1:58333",
                    "http://[0:0:0:0:0:0:0:1]:9000", "http://[::1", "ftp://127.0.0.1", "https://s3.example.org?x=1",
                    "https://s3.example.org#x", "https://.example.org", "https://a..b", ""):
            with self.subTest(endpoint=bad), self.assertRaises(SettingsError) as e:
                S3Settings.from_env({**ENV, "PGN_S3_ENDPOINT": bad})
            self.assertIn("PGN_S3_ENDPOINT", str(e.exception))
        for bad in ({"PGN_S3_REGION": "Mumbai"}, {"PGN_S3_WORK_BUCKET": "Not_A_Bucket"},
                    {"PGN_S3_SECRET_ACCESS_KEY": ""}, {"PGN_S3_ACCESS_KEY_ID": ""},
                    {"PGN_S3_SECRET_ACCESS_KEY": "   "}, {"PGN_S3_ACCESS_KEY_ID": " \t"}):
            with self.subTest(bad=bad), self.assertRaises(SettingsError) as e:
                S3Settings.from_env({**ENV, **bad})
            self.assertNotIn("fictional-secret-value", str(e.exception))

    def test_the_key_pair_never_shows(self):
        s = S3Settings.from_env(ENV)
        for text in (repr(s), str(s)):
            self.assertNotIn("fictional-secret-value", text)
            self.assertNotIn("fictional-key-id", text)


class Untouchable:
    """A client that fails the test if it is ever called."""

    def __getattr__(self, name):
        raise AssertionError(f"the store was called ({name}) for a key the guard should have refused")


class GuardTests(unittest.TestCase):
    def test_every_call_goes_through_the_jobs_key_guard_first(self):
        store = S3Storage(Untouchable(), "pgn-dev-work", keys.KeyGuard(ORG, PUB))
        theirs = keys.KeyGuard(OTHER_ORG, PUB).asset_original(ASSET)
        for call in (lambda: store.get(theirs, "v1"), lambda: store.put(theirs, b"x", "image/jpeg"),
                     lambda: store.delete(theirs, "v1"), lambda: store.get(f"uploads/orgs/{ORG}/pubs/{PUB}/x", "v1")):
            with self.assertRaises(keys.KeyRefused):
                call()
        for version in ("", None, 7):
            with self.subTest(version=version):
                with self.assertRaisesRegex(ValueError, "^a version id is required$") as e:
                    store.get(KEY, version)                                # a read always names its version
                self.assertIs(type(e.exception), ValueError)               # not a KeyRefused (also a ValueError)


class Body:
    """A stand-in stream: what it holds, whether it was closed, and an error to raise when read."""

    def __init__(self, data: bytes = b"", error: Exception | None = None):
        self.data, self.error, self.closed = data, error, False

    def read(self, *_):
        if self.error:
            raise self.error
        return self.data

    def close(self):
        self.closed = True


class FakeClient:
    """Answers get_object and put_object as told, and records the calls."""

    def __init__(self, answer=None, error: Exception | None = None):
        self.answer, self.error, self.calls = answer, error, []

    def get_object(self, **kw):
        self.calls.append(("get", kw))
        if self.error:
            raise self.error
        return self.answer

    def put_object(self, **kw):
        self.calls.append(("put", kw))
        if self.error:
            raise self.error
        return self.answer


def client_error(code: str) -> ClientError:
    return ClientError({"Error": {"Code": code, "Message": "fictional"},
                        "AWSAccessKeyId": "fictional-key-id"}, "GetObject")


class ReadWriteTests(unittest.TestCase):
    def store(self, client) -> S3Storage:
        return S3Storage(client, "pgn-dev-work", keys.KeyGuard(ORG, PUB))

    def test_a_read_is_refused_unless_it_is_exactly_the_version_and_size_named(self):
        cases = [("another version", {"VersionId": "v2", "ContentLength": 3}, Body(b"abc"), "another version"),
                 ("no length", {"VersionId": "v1"}, Body(b"abc"), "no length"),
                 ("a length that is text", {"VersionId": "v1", "ContentLength": "3"}, Body(b"abc"), "no length"),
                 ("too large, before reading", {"VersionId": "v1", "ContentLength": MAX_OBJECT + 1},
                  Body(error=AssertionError("read")), "larger than the worker reads"),
                 ("a short body", {"VersionId": "v1", "ContentLength": 5}, Body(b"abc"), "not the size"),
                 ("a read that times out", {"VersionId": "v1", "ContentLength": 3},
                  Body(error=ReadTimeoutError(endpoint_url="http://127.0.0.1:58333/secret-place")),
                  "could not be read in full")]
        for name, answer, body, words in cases:
            with self.subTest(name):
                with self.assertRaisesRegex(StorageError, words) as e:
                    self.store(FakeClient({**answer, "Body": body})).get(KEY, "v1")
                self.assertTrue(body.closed, "the body was not closed")
                self.assertIsNone(e.exception.__context__)
                self.assertNotIn("127.0.0.1", str(e.exception))
        # botocore's own stream: a body shorter than its length is caught by botocore itself
        short = StreamingBody(io.BytesIO(b"ab"), 3)
        with self.assertRaisesRegex(StorageError, "could not be read in full"):
            self.store(FakeClient({"VersionId": "v1", "ContentLength": 3, "Body": short})).get(KEY, "v1")
        body = Body(b"abc")
        self.assertEqual(self.store(FakeClient({"VersionId": "v1", "ContentLength": 3, "Body": body})).get(KEY, "v1"),
                         b"abc")
        self.assertTrue(body.closed)

    def test_a_download_streams_exactly_the_version_and_size_named_to_a_file(self):
        """engine.setup's dataset bundle (up to 4 GiB): streamed to disk, its SHA-256 worked out on the way."""
        with tempfile.TemporaryDirectory() as tmp:
            dest = Path(tmp) / "bundle.zip"
            data = b"fictional bundle bytes" * 1000
            body = StreamingBody(io.BytesIO(data), len(data))
            sha = self.store(FakeClient({"VersionId": "v1", "ContentLength": len(data), "Body": body})).download(
                KEY, "v1", dest, 1 << 20)
            self.assertEqual((sha, dest.read_bytes()), (hashlib.sha256(data).hexdigest(), data))
            self.assertEqual(stat.S_IMODE(dest.stat().st_mode), 0o600)
            for name, answer, words in (
                    ("too large, before reading", {"VersionId": "v1", "ContentLength": 11,
                                                   "Body": StreamingBody(io.BytesIO(b"x" * 11), 11)},
                     "larger than the worker reads"),
                    ("a short body", {"VersionId": "v1", "ContentLength": 5,
                                      "Body": StreamingBody(io.BytesIO(b"abc"), 5)}, "could not be read in full"),
                    ("another version", {"VersionId": "v2", "ContentLength": 3,
                                         "Body": StreamingBody(io.BytesIO(b"abc"), 3)}, "another version")):
                with self.subTest(name):
                    with self.assertRaisesRegex(StorageError, words):
                        self.store(FakeClient(answer)).download(KEY, "v1", dest, 10)
                    self.assertFalse(dest.exists())                 # nothing half written is left

    def test_store_errors_carry_no_response_and_a_missing_bucket_is_a_fault(self):
        for code, kind in (("NoSuchKey", MissingObject), ("NoSuchVersion", MissingObject),
                           ("NoSuchBucket", StorageError), ("AccessDenied", StorageError)):
            with self.subTest(code=code):
                with self.assertRaises(kind) as e:
                    self.store(FakeClient(error=client_error(code))).get(KEY, "v1")
                self.assertIs(type(e.exception), kind)
                self.assertIsNone(e.exception.__context__)                 # the response names the key id
                self.assertIsNone(e.exception.__cause__)
                self.assertNotIn("fictional-key-id", str(e.exception))
        with self.assertRaises(StorageError) as e:
            self.store(FakeClient(error=client_error("AccessDenied"))).put(KEY, b"x", "text/plain")
        self.assertIsNone(e.exception.__context__)

    def test_a_write_sends_the_bytes_checksum_and_needs_a_version(self):
        client = FakeClient({"VersionId": "v9"})
        self.assertEqual(self.store(client).put(KEY, b"fictional bytes", "text/plain"), "v9")
        sent = client.calls[0][1]
        self.assertEqual(sent["ChecksumSHA256"], base64.b64encode(hashlib.sha256(b"fictional bytes").digest()).decode())
        for answer in ({}, {"VersionId": "null"}, {"VersionId": ""}):
            with self.subTest(answer=answer), self.assertRaisesRegex(StorageError, "no version"):
                self.store(FakeClient(answer)).put(KEY, b"x", "text/plain")


@unittest.skipUnless(RUN, "the store tests run with PGN_WORKER_S3_RUN=1 (and then fail, never skip)")
class StoreTests(Case):
    @classmethod
    def setUpClass(cls):
        cls.settings = S3Settings.from_env()                               # fails here when the settings are missing
        cls.client = cls.settings.client()
        cls.bucket = cls.make_bucket(versioned=True)

    @classmethod
    def make_bucket(cls, versioned: bool) -> str:
        name = f"pgn-worker-test-{secrets.token_hex(6)}"                  # the tests' own, never another's
        cls.client.create_bucket(Bucket=name)
        cls.addClassCleanup(cls.remove_bucket, name)                       # removed even when a test fails
        if versioned:
            cls.client.put_bucket_versioning(Bucket=name, VersioningConfiguration={"Status": "Enabled"})
        return name

    @classmethod
    def remove_bucket(cls, name: str) -> None:
        assert name.startswith("pgn-worker-test-")
        listed = cls.client.list_object_versions(Bucket=name)
        for v in [*listed.get("Versions", []), *listed.get("DeleteMarkers", [])]:
            cls.client.delete_object(Bucket=name, Key=v["Key"], VersionId=v["VersionId"])
        cls.client.delete_bucket(Bucket=name)

    def setUp(self):
        super().setUp()
        self.store = S3Storage(self.client, self.bucket, self.guard)

    def original(self, data: bytes) -> dict:
        """The original as the API leaves it: copied to orgs/<o>/pubs/<p>/assets/<a>/original, versioned."""
        put = self.client.put_object(Bucket=self.bucket, Key=KEY, Body=data, ContentType="image/jpeg",
                                     Metadata={"sha256": hashlib.sha256(data).hexdigest()})
        return {"org_id": ORG, "pub_id": PUB, "asset_id": ASSET, "version_id": put["VersionId"],
                "sha256": hashlib.sha256(data).hexdigest()}

    def test_an_ingest_round_trip_with_the_libraries_at_debug_logs_no_credential(self):
        records: list[str] = []
        handler = logging.Handler(logging.DEBUG)
        handler.emit = lambda r: records.append(r.getMessage())
        root = logging.getLogger()
        old = root.level, {n: logging.getLogger(n).level for n in LOGGERS}
        root.addHandler(handler)
        root.setLevel(logging.DEBUG)
        try:
            for n in LOGGERS:                                              # forced after import and after the client
                logging.getLogger(n).setLevel(logging.DEBUG)
            data = picture(size=(1200, 800), orientation=6, gps=True)
            ev = media.ingest(self.store, self.original(data), ICC)
            with self.assertRaises(MissingObject):                          # a failing call too
                self.store.get(KEY, "not-a-version-of-it")
            S3Storage(self.settings.client(), self.bucket, self.guard).get(KEY, self.original(data)["version_id"])
        finally:
            root.removeHandler(handler)
            root.setLevel(old[0])
            for n, level in old[1].items():
                logging.getLogger(n).setLevel(level)
        self.assertEqual(ev["kind"], "media.ready")
        self.assertTrue(records, "nothing was logged: the test proves nothing")
        logged = "\n".join(records)
        self.assertIn("[redacted]", logged)                                # the filter saw what it had to remove
        for secret in (self.settings.secret_access_key, self.settings.access_key_id):
            self.assertNotIn(secret, logged)                               # no key id, no secret
        self.assertNotRegex(logged, r"(?i)(signature|credential)=(?!\[redacted\])")   # no signature, no credential
        self.assertNotRegex(logged, r"(?i)authorization['\"]?\s*[:=](?!\s*\[redacted\])")
        self.assertNotIn("AWS4-HMAC-SHA256 Credential", logged)           # no Authorization header's value
        for r in ev["renditions"]:
            body = self.store.get(r["key"], r["version_id"])
            self.assertEqual((hashlib.sha256(body).hexdigest(), len(body)), (r["sha256"], r["bytes"]))

    def test_a_version_that_is_not_the_jobs_is_refused(self):
        first = self.original(picture())
        second = self.original(picture(size=(310, 200)))                            # the same key, a new version
        with self.assertRaises(media.Mismatch):                                    # the old version, the new bytes' hash
            media.ingest(self.store, {**first, "sha256": second["sha256"]}, ICC)
        self.assertEqual(self.store.get(KEY, first["version_id"]), picture())
        for version in ("not-a-version-of-it", "0" * 32):
            with self.subTest(version=version), self.assertRaises(MissingObject):
                self.store.get(KEY, version)
        other = self.store.put(self.guard.key("assets", ASSET, "notes"), b"fictional", "text/plain")
        with self.assertRaises(MissingObject):                                     # another key's version
            self.store.get(KEY, other)

    def test_the_store_refuses_bytes_that_do_not_match_their_checksum(self):
        wrong = base64.b64encode(hashlib.sha256(b"other bytes").digest()).decode()
        with self.assertRaises(ClientError) as e:
            self.client.put_object(Bucket=self.bucket, Key=KEY, Body=b"fictional", ChecksumSHA256=wrong)
        self.assertEqual(e.exception.response["Error"]["Code"], "BadDigest")

    def test_a_delete_removes_one_version(self):
        key = self.guard.key("assets", ASSET, "r", "preview-" + "0" * 32 + ".jpg")
        one = self.store.put(key, b"one", "image/jpeg")
        two = self.store.put(key, b"two", "image/jpeg")
        self.store.delete(key, one)
        with self.assertRaises(MissingObject):
            self.store.get(key, one)
        self.assertEqual(self.store.get(key, two), b"two")

    def test_an_unversioned_bucket_and_a_missing_one_are_refused(self):
        plain = self.make_bucket(versioned=False)
        with self.assertRaisesRegex(StorageError, "no version"):
            S3Storage(self.client, plain, self.guard).put(self.guard.key("assets", ASSET, "x"), b"x", "text/plain")
        with self.assertRaises(StorageError) as e:
            S3Storage(self.client, f"pgn-worker-test-{secrets.token_hex(6)}-none", self.guard).get(KEY, "v1")
        self.assertIs(type(e.exception), StorageError)


if __name__ == "__main__":
    unittest.main()
