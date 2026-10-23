"""The object store for the worker (W3): S3 (the pilot) or SeaweedFS (this machine), through boto3, as the API's own
port does it (apps/api/src/storage/s3.ts):
- every read names the version it reads (VersionId is required, and the version the store answers must be it), and
  is refused before reading when the store lists no length or more than the worker reads; a short body is caught;
- every write sends the bytes' SHA-256 (`ChecksumSHA256`), so the store refuses bytes that arrive damaged, and returns
  the version the store made (a store that gives none is not versioned: refused);
- a delete removes one version, by its id;
- every key goes through the job's key guard first, on every call (never only at the job's start).

Settings are the API's (`PGN_S3_*`, apps/api/src/config.ts), checked as it checks them: the endpoint is exactly an
origin (http only on 127.0.0.1, ::1 or localhost, which are addressed by path), a region, the key pair (both, neither
blank) and the work bucket.

No credential reaches a log or an error: boto3's, botocore's, s3transfer's and urllib3's loggers are pinned to
WARNING (at import and again for every client), and a filter on each of them removes `Authorization` headers,
signatures, credentials and the key id from whatever they would still print. Errors are raised without the
library's exception attached (a ClientError's response can hold the key id)."""
from __future__ import annotations

import base64
import hashlib
import ipaddress
import logging
import os
import re
from dataclasses import dataclass, field
from typing import Any, Callable

import boto3
from botocore.config import Config
from botocore.exceptions import BotoCoreError, ClientError

from .keys import KeyGuard
from .storage import MissingObject

LOGGERS = ("boto3", "botocore", "s3transfer", "urllib3")
REGION = re.compile(r"[a-z]{2}(-[a-z]+)+-[0-9]", re.ASCII)
BUCKET = re.compile(r"[a-z0-9][a-z0-9-]{1,61}[a-z0-9]", re.ASCII)
LOOPBACK = {"127.0.0.1", "::1", "localhost"}                     # exactly the API's set
ORIGIN = re.compile(r"(?P<scheme>https?)://(?P<host>[a-z0-9.-]+|\[[0-9a-f:.]+\])(?::(?P<port>[0-9]+))?", re.ASCII)
DEFAULT_PORT = {"http": "80", "https": "443"}
MAX_OBJECT = 64 * 1024 * 1024        # the most the worker reads of one object (an original is at most 40 MB)
MISSING = {"NoSuchKey", "NoSuchVersion", "404", "NotFound", "InvalidArgument"}


class StorageError(RuntimeError):
    """The store answered with something the worker does not take, or could not be reached (never with its address)."""


class SettingsError(ValueError):
    """A `PGN_S3_*` setting that is missing or not valid (the message names the setting, never its value)."""


# ------------------------------------------------------------------------------------------- logs

_SECRETS = [
    re.compile(r"(Authorization['\"]?\s*[:=]\s*)(?:b?'[^'\r\n]*'?|b?\"[^\"\r\n]*\"?|[^,}\r\n]*)", re.IGNORECASE),
    re.compile(r"(X-Amz-Signature=)[^&\s'\"]*", re.IGNORECASE),
    re.compile(r"(Credential=)[^,&\s'\"]*", re.IGNORECASE),
    re.compile(r"(Signature=)[^,&\s'\"]*", re.IGNORECASE),
    re.compile(r"(X-Amz-Security-Token['\"]?\s*[:=]\s*)(?:b?'[^'\r\n]*'?|b?\"[^\"\r\n]*\"?|[^,}\r\n]*)",
               re.IGNORECASE),
]


class Redact(logging.Filter):
    """Removes credentials from a log record: Authorization headers, signatures, credentials and the key ids."""

    key_ids: set[str] = set()

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            text = record.getMessage()
        except Exception:  # noqa: BLE001 — a record that cannot be formatted is dropped, never printed raw
            return False
        for pattern in _SECRETS:
            text = pattern.sub(lambda m: m.group(1) + "[redacted]", text)
        for key_id in self.key_ids:
            text = text.replace(key_id, "[redacted]")
        record.msg, record.args = text, None
        return True


_REDACT = Redact()


def quiet(key_id: str | None = None) -> None:
    """Pins the libraries' loggers to WARNING and puts the redacting filter on each of them (the children too)."""
    if key_id:
        Redact.key_ids.add(key_id)
    names = [n for n in list(logging.Logger.manager.loggerDict)
             if any(n == p or n.startswith(p + ".") for p in LOGGERS)]
    for name in {*LOGGERS, *names}:
        logger = logging.getLogger(name)
        if name in LOGGERS:
            logger.setLevel(logging.WARNING)
        if _REDACT not in logger.filters:
            logger.addFilter(_REDACT)


quiet()


# --------------------------------------------------------------------------------------- settings


def _origin(value: str) -> tuple[str, str] | None:
    """(scheme, host) when value is exactly an origin as the API's URL parser writes one, else None: lower case, no
    path, user, query or white space, a port only when it is not the scheme's own, an IP address written canonically."""
    m = ORIGIN.fullmatch(value)
    if not m:
        return None
    scheme, host, port = m.group("scheme"), m.group("host"), m.group("port")
    if port is not None and (port != str(int(port)) or not 0 <= int(port) <= 65535 or port == DEFAULT_PORT[scheme]):
        return None
    if host.startswith("["):
        try:
            ip = ipaddress.IPv6Address(host[1:-1])
        except ValueError:
            return None
        if f"[{ip.compressed}]" != host:
            return None
        return scheme, ip.compressed
    if re.fullmatch(r"[0-9.]+", host):                            # a URL parser rewrites 127.1 or 010.0.0.1
        try:
            if str(ipaddress.IPv4Address(host)) != host:
                return None
        except ValueError:
            return None
    if host.startswith(".") or ".." in host:
        return None
    return scheme, host


@dataclass(frozen=True)
class S3Settings:
    endpoint: str
    region: str
    access_key_id: str = field(repr=False)
    secret_access_key: str = field(repr=False)
    work_bucket: str
    path_style: bool = False

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "S3Settings":
        env = dict(os.environ if env is None else env)
        endpoint = env.get("PGN_S3_ENDPOINT", "http://127.0.0.1:58333")
        found = _origin(endpoint)
        if found is None:
            raise SettingsError("PGN_S3_ENDPOINT must be an origin such as https://s3.ap-south-1.amazonaws.com")
        scheme, host = found
        if scheme == "http" and host not in LOOPBACK:
            raise SettingsError("PGN_S3_ENDPOINT may be http only for a store on this machine")
        region = env.get("PGN_S3_REGION", "ap-south-1")
        if not REGION.fullmatch(region):
            raise SettingsError("PGN_S3_REGION must be a region such as ap-south-1")
        bucket = env.get("PGN_S3_WORK_BUCKET", "pgn-dev-work")
        if not BUCKET.fullmatch(bucket):
            raise SettingsError("PGN_S3_WORK_BUCKET must be a bucket name")
        key_id, secret = env.get("PGN_S3_ACCESS_KEY_ID", ""), env.get("PGN_S3_SECRET_ACCESS_KEY", "")
        if not re.search(r"\S", key_id) or not re.search(r"\S", secret):
            raise SettingsError("PGN_S3_ACCESS_KEY_ID and PGN_S3_SECRET_ACCESS_KEY are both needed, not blank")
        # SeaweedFS (any store on this machine) answers by path; S3 itself by the bucket's host name (as the API)
        return cls(endpoint, region, key_id, secret, bucket, host in LOOPBACK)

    def client(self) -> Any:
        quiet(self.access_key_id)                                   # again: a caller may have changed the levels
        config = Config(region_name=self.region, signature_version="s3v4", connect_timeout=10, read_timeout=60,
                        retries={"max_attempts": 3, "mode": "standard"},
                        s3={"addressing_style": "path" if self.path_style else "virtual"},
                        request_checksum_calculation="when_required", response_checksum_validation="when_required")
        client = boto3.session.Session().client("s3", endpoint_url=self.endpoint, aws_access_key_id=self.access_key_id,
                                                aws_secret_access_key=self.secret_access_key, config=config)
        quiet(self.access_key_id)                                   # and for the loggers the client has just made
        return client


# ------------------------------------------------------------------------------------------- store


def _code(e: ClientError) -> str:
    return str(e.response.get("Error", {}).get("Code") or "an error")


class S3Storage:
    """One job's view of the work bucket: every key through its guard."""

    def __init__(self, client: Any, bucket: str, guard: KeyGuard):
        self._client, self.bucket, self.guard = client, bucket, guard

    @staticmethod
    def _version(version_id: object) -> str:
        if not isinstance(version_id, str) or not version_id or len(version_id) > 1024:
            raise ValueError("a version id is required")
        return version_id

    def _call(self, what: str, key: str, call: Callable[[], Any], missing: bool = False) -> Any:
        """The store's answer, or the error to raise, built without the library's exception (raised by the caller
        outside any except block, so no `__context__` carries a response that names the key id)."""
        try:
            return call(), None
        except ClientError as e:
            code = _code(e)
            if missing and code in MISSING:
                return None, MissingObject(f"{key}")
            return None, StorageError(f"the store refused to {what} {key}: {code}")
        except BotoCoreError as e:
            return None, StorageError(f"the store could not be reached to {what} {key} ({type(e).__name__})")

    def get(self, key: str, version_id: str) -> bytes:
        key, version_id = self.guard.check(key), self._version(version_id)
        answer, error = self._call("read", key, lambda: self._client.get_object(
            Bucket=self.bucket, Key=key, VersionId=version_id), missing=True)
        if error is not None:
            raise error
        body = answer.get("Body")
        data, failure = None, None
        try:
            length = answer.get("ContentLength")
            if answer.get("VersionId") != version_id:
                failure = StorageError(f"the store answered another version of {key}")
            elif not isinstance(length, int) or isinstance(length, bool) or length < 0:
                failure = StorageError(f"the store listed no length for {key}")
            elif length > MAX_OBJECT:
                failure = StorageError(f"{key} is larger than the worker reads")
            else:
                try:
                    data = body.read()                              # botocore's StreamingBody: a short body raises
                except Exception as e:  # noqa: BLE001 — timeouts, cut-off streams, urllib3 and socket errors
                    failure = StorageError(f"the store's answer for {key} could not be read in full "
                                           f"({type(e).__name__})")
                else:
                    if len(data) != length:
                        failure = StorageError(f"{key}: not the size the store listed")
        finally:
            if body is not None:
                body.close()
        if failure is not None:
            raise failure
        return data

    def put(self, key: str, data: bytes, content_type: str) -> str:
        key = self.guard.check(key)
        checksum = base64.b64encode(hashlib.sha256(data).digest()).decode("ascii")
        answer, error = self._call("write", key, lambda: self._client.put_object(
            Bucket=self.bucket, Key=key, Body=data, ContentType=content_type, ChecksumSHA256=checksum))
        if error is not None:
            raise error
        version = answer.get("VersionId")
        if not version or version == "null":
            raise StorageError(f"the store gave no version for {key}: is the bucket versioned?")
        return version

    def delete(self, key: str, version_id: str) -> None:
        key, version_id = self.guard.check(key), self._version(version_id)
        _, error = self._call("delete", key, lambda: self._client.delete_object(
            Bucket=self.bucket, Key=key, VersionId=version_id))
        if error is not None:
            raise error
