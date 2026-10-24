"""Tests for the Python licence inventory's generator (tools/licences/python_inventory.py), offline: PyPI is stood in
for. Run from the repository root:
    python3 -B -m unittest discover -s tools/licences
"""
from __future__ import annotations

import contextlib
import io
import sys
import tempfile
import unittest
import urllib.error
import zipfile
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parent))

import python_inventory as inv  # noqa: E402


def wheel(files: dict[str, bytes]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("fictional-1.0.dist-info/METADATA", "Metadata-Version: 2.4\nName: fictional\nVersion: 1.0\n"
                                                      "License-Expression: Apache-2.0\n\n")
        for name, data in files.items():
            z.writestr(name, data)
    return buf.getvalue()


class GeneratorTests(unittest.TestCase):
    def test_a_pin_missing_from_pypi_is_a_clean_refusal(self):
        def missing(url, timeout):
            raise urllib.error.HTTPError(url, 404, "Not Found", {}, None)
        err = io.StringIO()
        with tempfile.TemporaryDirectory() as tmp, mock.patch.object(inv.urllib.request, "urlopen", missing), \
                mock.patch.object(sys, "argv", ["python_inventory.py", "--check", "--cache", tmp]), \
                contextlib.redirect_stderr(err):
            code = inv.main()
        self.assertEqual(code, 1)
        lines = err.getvalue().strip().splitlines()
        self.assertEqual(len(lines), 1, lines)                              # one line, no traceback
        self.assertTrue(lines[0].startswith("✗ python licences: "), lines[0])
        self.assertIn("PyPI answered 404", lines[0])
        self.assertNotIn("Traceback", err.getvalue())

    def test_a_bundled_ca_list_is_listed_like_a_bundled_library(self):
        found = inv.inspect(wheel({"botocore/cacert.pem": b"-----BEGIN CERTIFICATE-----", "botocore/data.json": b"{}",
                                   "fictional.libs/libz-0123abcd.so.1.3": b"\x7fELF"}))
        self.assertEqual(found["bundled"], [{"file": "botocore/cacert.pem", "library": "cacert.pem"},
                                            {"file": "fictional.libs/libz-0123abcd.so.1.3", "library": "libz"}])
        self.assertEqual(found["metadata"]["license_expression"], "Apache-2.0")


if __name__ == "__main__":
    unittest.main()
