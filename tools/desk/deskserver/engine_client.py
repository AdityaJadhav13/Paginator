"""Runs the layout engine (CONTRACT.md §2): `<oracle python> tools/desk/engine/desk_engine.py <command> --home <home>`
from the repository root. Every command prints one JSON object on stdout and exits 0, or prints {"error"} and
exits 1. `plan` and `samples` results are cached in memory (keyed by the config.json they were made from)."""
from __future__ import annotations

import os
import subprocess
import threading
from pathlib import Path

from .util import DeskError, last_json_object, tail

PLAN_TIMEOUT_S = 120
SETUP_TIMEOUT_S = 600
IMPORT_TIMEOUT_S = 900


class EngineError(DeskError):
    def __init__(self, message: str):
        super().__init__(500, message)


class EngineClient:
    def __init__(self, repo_root: Path, home: Path, python: Path, script: Path):
        self.repo_root = Path(repo_root)
        self.home = Path(home)
        self.python = Path(python)
        self.script = Path(script)
        self._lock = threading.Lock()          # one plan/samples/setup call at a time
        self._cache: dict[tuple, dict] = {}
        self._error: tuple[str, tuple | None] | None = None   # last plan/samples failure and the config it saw

    @classmethod
    def from_env(cls, repo_root: Path, home: Path) -> "EngineClient":
        python = os.environ.get("PAGEINATOR_ORACLE_PY") or repo_root / "tools/oracle/v0/.venv/bin/python"
        script = os.environ.get("PAGEINATOR_DESK_ENGINE") or repo_root / "tools/desk/engine/desk_engine.py"
        return cls(repo_root, home, Path(python).expanduser(), Path(script).expanduser())

    # ------------------------------------------------------------------------------------------- state

    def ok(self) -> bool:
        return self.python.is_file() and os.access(self.python, os.X_OK) and self.script.is_file()

    def missing_message(self) -> str:
        if not (self.python.is_file() and os.access(self.python, os.X_OK)):
            return f"The layout engine's Python is missing ({self.python}). Set up tools/oracle/v0/.venv first."
        return f"The layout engine is missing ({self.script})."

    def _config_stamp(self) -> tuple | None:
        try:
            st = (self.home / "config.json").stat()
        except OSError:
            return None
        return st.st_mtime_ns, st.st_size

    def config_state(self) -> tuple[bool, str]:
        """(config_ok, message) for /api/status: set up, and the last plan/samples call on this config worked."""
        stamp = self._config_stamp()
        if stamp is None:
            return False, "The Desk is not set up yet: run setup first."
        error = self._error
        if error and error[1] == stamp:
            return False, error[0]
        return True, ""

    # ------------------------------------------------------------------------------------------- calls

    def env(self) -> dict[str, str]:
        env = dict(os.environ)
        env["PYTHONDONTWRITEBYTECODE"] = "1"
        env["PYTHONIOENCODING"] = "utf-8"
        return env

    def argv(self, command: str, *args: str) -> list[str]:
        return [str(self.python), str(self.script), command, "--home", str(self.home), *args]

    def run(self, command: str, *args: str, timeout: float) -> dict:
        if not self.ok():
            raise EngineError(self.missing_message())
        try:
            proc = subprocess.run(self.argv(command, *args), cwd=self.repo_root, env=self.env(),
                                  stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise EngineError(f"The layout engine did not answer within {timeout:.0f} seconds ({command}).") from None
        except OSError as e:
            raise EngineError(f"The layout engine could not be started: {e.strerror or e}.") from None
        result = last_json_object(proc.stdout.decode("utf-8", "replace"))
        problem = result.get("error") if isinstance(result, dict) else None
        if proc.returncode != 0 or problem:
            if isinstance(problem, str) and problem.strip():
                raise EngineError(problem.strip())
            detail = tail(proc.stderr.decode("utf-8", "replace"))
            raise EngineError(f"The layout engine stopped with an error ({command}, exit code {proc.returncode})."
                              + (f" {detail}" if detail else ""))
        if not isinstance(result, dict):
            raise EngineError(f"The layout engine's answer could not be read ({command}).")
        return result

    def _cached(self, key: tuple, command: str, *args: str) -> dict:
        with self._lock:
            stamp = self._config_stamp()
            full_key = (*key, stamp)
            if full_key in self._cache:
                return self._cache[full_key]
            try:
                result = self.run(command, *args, timeout=PLAN_TIMEOUT_S)
            except EngineError as e:
                self._error = (e.message, stamp)
                raise
            self._error = None
            self._cache = {k: v for k, v in self._cache.items() if k[-1] == stamp}
            self._cache[full_key] = result
            return result

    def plan(self, pages: int, back_ads: bool) -> dict:
        result = self._cached(("plan", pages, bool(back_ads)), "plan", "--pages", str(pages),
                              "--back-ads", "1" if back_ads else "0")
        if not isinstance(result.get("pages"), list):
            raise EngineError("The layout engine's page plan could not be read.")
        return result

    def samples(self) -> dict:
        result = self._cached(("samples",), "samples")
        if not isinstance(result.get("samples"), list):
            raise EngineError("The layout engine's list of sample editions could not be read.")
        return result

    def setup(self, dataset: str | None = None) -> dict:
        with self._lock:
            result = self.run("setup", *(["--dataset", dataset] if dataset else []), timeout=SETUP_TIMEOUT_S)
            self._cache.clear()
            self._error = None
            return result

    def import_sample(self, eid: str, names: list[str]) -> dict:
        args = [arg for n in names for arg in ("--sample", n)]
        return self.run("import-sample", "--edition", eid, *args, timeout=IMPORT_TIMEOUT_S)

    def generate_argv(self, eid: str, rid: str) -> list[str]:
        return self.argv("generate", "--edition", eid, "--run", rid)
