"""The Desk's own messages, in a form the screens can show in English or Marathi.

A message is still the English text it always was (a Msg is a str: logs, tests, older clients and every place that
compares, joins or writes it see the same characters), and it also carries its wire form, which a JSON answer sends
beside the text so the screens can say it in the language chosen:
  {"code": "m.…", "params": {…}}   a message of messages.json, with its values;
  {"data": "…"}                    text shown as it is, in its own language (a headline, a file name, a server's words);
  {"parts": [wire, …]}             several sentences, joined with a space.
A value in params is a number, a string, or one of these forms (a headline is {"data": …}; a name such as "the column
of short items" is a message of its own). The registry, code → English template, is messages.json (shared with
tools/desk/static/strings.js, which has every code in both languages). Both the engine and the server import this file.
"""
from __future__ import annotations

import json
import string
from pathlib import Path
from typing import Any

MESSAGES: dict[str, str] = {k: v for k, v in json.loads((Path(__file__).with_name("messages.json")).read_text("utf-8")).items()
                            if k.startswith("m.")}
_FMT = string.Formatter()


class Msg(str):
    """English text that also carries its wire form (None: plain text)."""

    wire: Any = None

    def __new__(cls, text: str, wire: Any = None) -> "Msg":
        s = super().__new__(cls, text)
        s.wire = wire
        return s


def wire_of(value: Any) -> Any:
    """The wire form of a value given as a message's param: a Msg's own form, a number as it is, any other text as data."""
    if isinstance(value, Msg) and value.wire is not None:
        return value.wire
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    return {"data": str(value)}


def msg(code: str, /, **params: Any) -> Msg:            # (a template may have a value named "code")
    """The message `code` with its values: its English text, exactly as the template gives it, and its wire form. A
    value the template converts or formats ({page!r}, {h:g}) is sent as the template shows it."""
    template = MESSAGES[code]
    text = template.format(**params)
    wire: dict[str, Any] = {}
    for _, field, spec, conv in _FMT.parse(template):
        if field is None or field in wire:
            continue
        value = params[field]
        if conv or spec:                                    # sent as the English shows it
            shown = _FMT.convert_field(value, conv) if conv else value
            wire[field] = format(shown, spec or "")
        else:
            wire[field] = wire_of(value)
    return Msg(text, {"code": code, "params": wire})


def data(text: str) -> Msg:
    """Text shown as it is (a headline in quotes, a file name, words from elsewhere), in its own language."""
    return Msg(text, {"data": str(text)})


def join(*parts: Any, sep: str = " ") -> Msg:
    """Several messages as one text (sentences joined with a space); empty parts are left out."""
    kept = [p for p in parts if p]
    return Msg(sep.join(kept), {"parts": [wire_of(p) for p in kept]} if sep == " " else {"data": sep.join(kept)})


def from_wire(text: Any, msgs: Any) -> Any:
    """A text read from a JSON answer, as a Msg again when the answer's "msgs" map has it (else the text as it is)."""
    if isinstance(text, str) and isinstance(msgs, dict) and isinstance(msgs.get(text), dict):
        return Msg(text, msgs[text])
    return text


def annotate(doc: Any) -> Any:
    """Before a JSON document is written or sent (a status, an answer): its top-level "msgs" maps each English text in it
    that is a message to its wire form ({code, params} or {parts}), so a screen can say it in the language chosen. A
    text read back from an earlier write keeps its entry; entries for texts no longer in the document are dropped."""
    if not isinstance(doc, dict):
        return doc
    found: dict[str, Any] = {}
    present: set[str] = set()

    def walk(v: Any) -> None:
        if isinstance(v, str):
            present.add(str(v))
            w = v.wire if isinstance(v, Msg) else None
            if isinstance(w, dict) and ("code" in w or "parts" in w):
                found[str(v)] = w
        elif isinstance(v, dict):
            for x in v.values():
                walk(x)
        elif isinstance(v, (list, tuple)):
            for x in v:
                walk(x)

    for k, v in doc.items():
        if k != "msgs":
            walk(v)
    old = doc.get("msgs") if isinstance(doc.get("msgs"), dict) else {}
    merged = {t: w for t, w in old.items() if t in present}
    merged.update(found)
    if merged:
        doc["msgs"] = merged
    else:
        doc.pop("msgs", None)
    return doc
