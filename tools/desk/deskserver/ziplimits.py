"""What a ZIP's end record says, read before zipfile.ZipFile is opened: zipfile reads the whole central directory into
memory first (a 200 MB file can list millions of entries), so the entry count and the directory's size are checked
here, from the end-of-central-directory record (and its ZIP64 form), as zipfile finds it. Standard library only."""
from __future__ import annotations

import struct
from dataclasses import dataclass

EOCD = b"PK\x05\x06"
EOCD_SIZE = 22
EOCD64 = b"PK\x06\x06"
EOCD64_SIZE = 56
LOCATOR64 = b"PK\x06\x07"
LOCATOR64_SIZE = 20


@dataclass
class Directory:
    entries: int        # the total number of entries the ZIP lists
    size: int           # the central directory's size in bytes
    zip64: bool         # whether the ZIP has the ZIP64 end record (zipfile then reads the counts from it)


def directory(data: bytes) -> Directory | None:
    """The ZIP's listed entry count and central directory size, or None when no end record is found (not a ZIP: zipfile
    then refuses it). As zipfile does: an end record without a comment at the very end, else the last one in the final
    2**16 + 22 bytes; a ZIP64 locator just before it points zipfile to the ZIP64 end record just before that."""
    at = len(data) - EOCD_SIZE
    if at < 0:
        return None
    if data[at:at + 4] != EOCD:
        at = data.rfind(EOCD, max(0, len(data) - EOCD_SIZE - 2**16), len(data) - EOCD_SIZE + len(EOCD))
        if at < 0:
            return None
    _, _, _, _, entries, size, _, _ = struct.unpack("<4s4H2LH", data[at:at + EOCD_SIZE])
    loc = at - LOCATOR64_SIZE
    if loc >= 0 and data[loc:loc + 4] == LOCATOR64:
        rec = loc - EOCD64_SIZE
        if rec < 0 or data[rec:rec + 4] != EOCD64:
            return Directory(entries=2**64, size=2**64, zip64=True)          # a locator with no record: refused
        fields = struct.unpack("<4sQ2H2L4Q", data[rec:rec + EOCD64_SIZE])
        return Directory(entries=max(fields[6], fields[7]), size=fields[8], zip64=True)
    return Directory(entries=entries, size=size, zip64=False)
