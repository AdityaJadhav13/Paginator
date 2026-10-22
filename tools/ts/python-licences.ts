// The Python half of the licence check (check-licences.ts runs both): every pin of the pinned Python locks, read from
// the inventory tools/licences/python_inventory.py made of their manylinux wheels (CI-10). Same rules as for npm:
// the allowlist (ALLOWED), or a reviewed exception. It fails closed:
// - the inventory must list exactly the locks' pins, each with at least one wheel whose SHA-256 the lock names;
// - a package's licence is its METADATA's SPDX expression (License-Expression, or a License field that is one); a
//   package that states it some other way passes only with a reading a person recorded (PY_DECLARED, per version);
// - every native library a wheel bundles must be a reviewed one (BUNDLED);
// - an exception awaiting the owner's decision passes, and is listed every time (decision: "D-8").
// CI also makes the inventory again from PyPI (python_inventory.py --check), so it cannot drift from the wheels.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { licenceOk } from "./check-licences.ts";

export const PY_LOCKS = [
  "tools/desk/requirements.lock",
  "tools/oracle/v0/requirements.lock",
  "apps/engine-worker/requirements.lock",
];
export const INVENTORY = "tools/licences/python-inventory.json";
const FORMAT = "pageinator.python-licences/1";

/** Reviewed exceptions: package → the licence it was reviewed under, why, and an owner decision it still awaits. */
export const PY_REVIEWED: Record<string, { licence: string; why: string; decision?: string }> = {
  pikepdf: {
    licence: "MPL-2.0",
    why: "file-level copyleft; used unmodified, server-side (the Desk's PDF merge and press ZIP), never distributed",
    decision: "D-8",
  },
  pillow: { licence: "MIT-CMU", why: "permissive (HPND-style); the Desk's photo pipeline" },
  "typing-extensions": { licence: "PSF-2.0", why: "permissive (the Python Software Foundation licence)" },
  certifi: {
    licence: "MPL-2.0",
    why: "a CA certificate bundle (data), unmodified; HTTP tooling of the frozen oracle env",
  },
  hypothesis: { licence: "MPL-2.0", why: "a test tool of the frozen oracle environment; never shipped modified" },
  pathspec: { licence: "MPL-2.0", why: "a tool dependency (mypy) of the frozen oracle environment; never shipped" },
  pypdfium2: {
    licence: "(BSD-3-Clause OR Apache-2.0) AND LicenseRef-PdfiumThirdParty",
    why:
      "pypdfium2 is BSD-3-Clause or Apache-2.0; its PDFium binary carries the notices of libpng, AGG 2.3, FreeType, " +
      "lcms, OpenJPEG, zlib, libjpeg-turbo and ICU (LicenseRef-PdfiumThirdParty.txt): all permissive, no GPL/LGPL",
  },
};

/** How a package states its licence when its METADATA has no SPDX expression, as a person read it (per version). */
export const PY_DECLARED: Record<string, { licence: string; from: string }> = {
  "freetype-py==2.5.1": { licence: "BSD-3-Clause", from: "classifier 'BSD License'; LICENSE.txt: new (revised) BSD" },
  "sortedcontainers==2.4.0": { licence: "Apache-2.0", from: "License: Apache 2.0" },
  "uharfbuzz==0.56.0": { licence: "Apache-2.0", from: "License: Apache License 2.0" },
  "uvloop==0.22.1": { licence: "MIT OR Apache-2.0", from: "License: MIT License; classifiers MIT and Apache" },
  "pathspec==1.1.1": { licence: "MPL-2.0", from: "classifier 'Mozilla Public License 2.0 (MPL 2.0)'" },
  "pypdfium2==4.30.1": {
    licence: "(BSD-3-Clause OR Apache-2.0) AND LicenseRef-PdfiumThirdParty",
    from: "License: BSD-3-Clause, Apache-2.0, PdfiumThirdParty",
  },
};

/** Native libraries the manylinux wheels bundle (auditwheel's `<pkg>.libs/`, PDFium), by library name. One without
 * `why` must pass the allowlist; one with `why` was reviewed. */
export const BUNDLED: Record<string, { licence: string; why?: string }> = {
  libavif: { licence: "BSD-2-Clause" },
  libbrotlicommon: { licence: "MIT" },
  libbrotlidec: { licence: "MIT" },
  libfreetype: { licence: "FTL OR GPL-2.0-or-later", why: "FreeType, used under the FTL (BSD-style, credit clause)" },
  libharfbuzz: { licence: "MIT-Modern-Variant", why: "HarfBuzz's 'Old MIT' licence: permissive" },
  libjpeg: {
    licence: "IJG AND BSD-3-Clause AND Zlib",
    why: "libjpeg-turbo: the IJG licence and BSD-style, permissive",
  },
  liblcms2: { licence: "MIT" },
  liblzma: { licence: "0BSD" },
  libopenjp2: { licence: "BSD-2-Clause" },
  libpdfium: { licence: "BSD-3-Clause AND LicenseRef-PdfiumThirdParty", why: "as pypdfium2 (PY_REVIEWED)" },
  libpng16: { licence: "libpng-2.0", why: "the PNG Reference Library licence: permissive" },
  libqpdf: { licence: "Apache-2.0 OR Artistic-2.0" },
  libsharpyuv: { licence: "BSD-3-Clause" },
  libtiff: { licence: "libtiff", why: "the libtiff licence: permissive (BSD-style)" },
  libwebp: { licence: "BSD-3-Clause" },
  libwebpdemux: { licence: "BSD-3-Clause" },
  libwebpmux: { licence: "BSD-3-Clause" },
  libXau: { licence: "MIT" },
  libxcb: { licence: "X11", why: "the X11 licence: permissive (MIT-style)" },
  libzstd: { licence: "BSD-3-Clause OR GPL-2.0-only" },
};

type Meta = { license_expression: string | null; license: string | null; classifiers: string[] };
type Wheel = { file: string; sha256: string; metadata: Meta; bundled: { file: string; library: string }[] };
export type Inventory = {
  format: string;
  locks: Record<string, string[]>;
  packages: Record<string, { wheels: Wheel[] }>;
};

const PIN = /^([A-Za-z0-9][A-Za-z0-9._-]*)==([^\s\\;]+)\s*\\?$/;
const HASH = /^\s+--hash=sha256:([0-9a-f]{64})\s*\\?$/;
const norm = (name: string) => name.replace(/[-_.]+/g, "-").toLowerCase();

/** A `uv pip compile --generate-hashes` lock: pin ("name==version") → its hashes; and the lines it could not read. */
export function pyLock(text: string): { pins: Map<string, Set<string>>; unread: string[] } {
  const pins = new Map<string, Set<string>>();
  const unread: string[] = [];
  let current: string | null = null;
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const pin = PIN.exec(line);
    const hash = HASH.exec(line);
    if (pin) {
      current = `${norm(pin[1] ?? "")}==${pin[2] ?? ""}`;
      pins.set(current, new Set());
    } else if (hash && current) pins.get(current)?.add(hash[1] ?? "");
    else unread.push(line.trim().slice(0, 120));
  }
  return { pins, unread };
}

/** The licence a wheel states as an SPDX expression, or null (it states it some other way, or not at all). */
export function stated(m: Meta): string | null {
  if (m.license_expression) return m.license_expression;
  if (m.license && /^[A-Za-z0-9.+-]+(?: (?:AND|OR) [A-Za-z0-9.+-]+)*$/.test(m.license)) return m.license;
  return null;
}

export function pythonProblems(
  inv: Inventory,
  locks: Record<string, string | null>,
): { problems: string[]; awaiting: string[] } {
  const problems: string[] = [];
  const awaiting = new Set<string>();
  if (inv.format !== FORMAT) problems.push(`${INVENTORY}: format ${inv.format}, this check reads ${FORMAT}`);
  const all = new Map<string, Set<string>>();
  for (const rel of PY_LOCKS) {
    const text = locks[rel];
    if (text === null || text === undefined) {
      problems.push(`${rel}: the lock cannot be read`);
      continue;
    }
    const { pins, unread } = pyLock(text);
    for (const line of unread) problems.push(`${rel}: a line this check does not read: ${line}`);
    if (!pins.size) problems.push(`${rel}: no pins`);
    for (const [pin, hashes] of pins) {
      if (!hashes.size) problems.push(`${rel}: ${pin} has no hashes`);
      all.set(pin, new Set([...(all.get(pin) ?? []), ...hashes]));
    }
    const listed = [...(inv.locks?.[rel] ?? [])].sort().join(" ");
    if (listed !== [...pins.keys()].sort().join(" "))
      problems.push(`${INVENTORY}: its pins of ${rel} are not the lock's: run tools/licences/python_inventory.py`);
  }
  for (const rel of Object.keys(inv.locks ?? {}))
    if (!PY_LOCKS.includes(rel)) problems.push(`${INVENTORY}: lists ${rel}, which is not a checked lock`);
  for (const pin of Object.keys(inv.packages ?? {}))
    if (!all.has(pin)) problems.push(`${INVENTORY}: ${pin} is in no lock`);
  for (const [pin, hashes] of all) {
    const wheels = inv.packages?.[pin]?.wheels ?? [];
    if (!wheels.length) problems.push(`${pin}: no manylinux wheel in the inventory, so its licence was not checked`);
    const name = pin.slice(0, pin.indexOf("=="));
    for (const w of wheels) {
      if (!hashes.has(w.sha256)) problems.push(`${pin}: ${w.file} is not a wheel the lock names (its SHA-256)`);
      const declared = Object.hasOwn(PY_DECLARED, pin) ? PY_DECLARED[pin] : undefined;
      const own = stated(w.metadata);
      if (own && declared) problems.push(`${pin}: states ${own} itself now: drop its PY_DECLARED reading`);
      const licence = own ?? declared?.licence ?? "";
      const reviewed = Object.hasOwn(PY_REVIEWED, name) ? PY_REVIEWED[name] : undefined;
      if (!licenceOk(licence)) {
        if (reviewed && reviewed.licence === licence) {
          if (reviewed.decision) awaiting.add(`${pin} (${licence}): awaits the owner's decision ${reviewed.decision}`);
        } else
          problems.push(`${pin}: licence ${licence || "(not stated as SPDX; no reading recorded)"} is not allowed`);
      }
      for (const b of w.bundled) {
        const lib = Object.hasOwn(BUNDLED, b.library) ? BUNDLED[b.library] : undefined;
        if (!lib) problems.push(`${pin}: bundles ${b.file}, a library not reviewed (BUNDLED)`);
        else if (!lib.why && !licenceOk(lib.licence))
          problems.push(`${pin}: bundles ${b.library} (${lib.licence}), neither allowed nor reviewed`);
      }
    }
  }
  return { problems: [...new Set(problems)].sort(), awaiting: [...awaiting].sort() };
}

/** The committed inventory and the locks, read from the repository (null for a file that cannot be read). */
export function readPython(repo: string): { inv: Inventory | null; locks: Record<string, string | null> } {
  const read = (rel: string) => {
    try {
      return readFileSync(join(repo, rel), "utf8");
    } catch {
      return null;
    }
  };
  const parse = (text: string | null): Inventory | null => {
    try {
      return JSON.parse(text ?? "") as Inventory;
    } catch {
      return null;
    }
  };
  return { inv: parse(read(INVENTORY)), locks: Object.fromEntries(PY_LOCKS.map((rel) => [rel, read(rel)])) };
}
