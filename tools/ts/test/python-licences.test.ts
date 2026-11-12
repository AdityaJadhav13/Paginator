import { describe, expect, it } from "vitest";
import { REPO } from "../lib.ts";
import { type Inventory, PY_LOCKS, pyLock, pythonProblems, readPython, stated } from "../python-licences.ts";

const A = "a".repeat(64);
const B = "b".repeat(64);
const lockText = (pins: [string, string[]][]) =>
  "# uv pip compile …\n" +
  pins.map(([pin, hashes]) => `${pin} \\\n${hashes.map((h) => `    --hash=sha256:${h}`).join(" \\\n")}\n`).join("");
type Wheel = Inventory["packages"][string]["wheels"][number];
const wheel = (meta: Partial<Wheel["metadata"]>, sha = A, bundled: Wheel["bundled"] = []): Wheel => ({
  file: "x-1.0-py3-none-any.whl",
  sha256: sha,
  metadata: { license_expression: null, license: null, classifiers: [], ...meta },
  bundled,
});

/** One lock (the first checked one) with the pins given; the other two empty-but-valid copies of it. */
function world(pkgs: Record<string, ReturnType<typeof wheel>[]>, lockPins?: [string, string[]][]) {
  const pins = lockPins ?? Object.keys(pkgs).map((p) => [p, [A]] as [string, string[]]);
  const text = lockText(pins);
  const locks = Object.fromEntries(PY_LOCKS.map((rel) => [rel, text]));
  const inv: Inventory = {
    format: "pageinator.python-licences/1",
    locks: Object.fromEntries(PY_LOCKS.map((rel) => [rel, Object.keys(pkgs).sort()])), // as made from pkgs
    packages: Object.fromEntries(Object.entries(pkgs).map(([p, wheels]) => [p, { wheels }])),
  };
  return { inv, locks };
}

describe("the Python licence inventory", () => {
  it("passes for the committed inventory and locks, and lists what awaits the owner", () => {
    const { inv, locks } = readPython(REPO);
    expect(inv).not.toBeNull();
    const { problems, awaiting } = pythonProblems(inv as Inventory, locks);
    expect(problems).toEqual([]);
    expect(awaiting).toEqual(["pikepdf==9.11.0 (MPL-2.0): awaits the owner's decision D-8"]);
  });

  it("reads uv's locks and nothing else", () => {
    const { pins, unread } = pyLock(lockText([["Foo_Bar==1.2", [A, B]]]) + "    # via something\n");
    expect([...pins.keys()]).toEqual(["foo-bar==1.2"]);
    expect([...(pins.get("foo-bar==1.2") ?? [])]).toEqual([A, B]);
    expect(unread).toEqual([]);
    for (const line of ["-r other.txt", "--index-url https://example.org/simple", "foo @ https://example.org/f.whl"])
      expect(pyLock(lockText([["foo==1", [A]]]) + line + "\n").unread).toEqual([line]);
  });

  it("states a licence only as an SPDX expression", () => {
    expect(stated({ license_expression: "MIT", license: null, classifiers: [] })).toBe("MIT");
    expect(stated({ license_expression: null, license: "BSD-3-Clause", classifiers: [] })).toBe("BSD-3-Clause");
    for (const l of ["MIT License", "Apache 2.0", "BSD-3-Clause, Apache-2.0", null])
      expect(stated({ license_expression: null, license: l, classifiers: ["License :: OSI Approved :: MIT"] })).toBe(
        null,
      );
  });

  it("fails closed", () => {
    const ok = world({ "foo==1": [wheel({ license_expression: "MIT" })] });
    expect(pythonProblems(ok.inv, ok.locks).problems).toEqual([]);
    const cases: [ReturnType<typeof world>, RegExp][] = [
      [world({ "foo==1": [wheel({ license_expression: "GPL-3.0-only" })] }), /GPL-3.0-only is not allowed/],
      [world({ "psycopg==3.3.6": [wheel({ license_expression: "LGPL-3.0-only" })] }), /LGPL-3.0-only is not allowed/],
      [world({ "foo==1": [wheel({ license: "MIT License" })] }), /not stated as SPDX; no reading recorded/],
      [world({ "foo==1": [wheel({ license_expression: "MIT" }, B)] }), /not a wheel the lock names/],
      [world({ "foo==1": [] }), /no manylinux wheel/],
      [
        world({ "foo==1": [wheel({ license_expression: "MIT" })] }, [
          ["foo==1", [A]],
          ["bar==2", [A]],
        ]),
        /not the lock's/,
      ],
      [
        world({
          "foo==1": [
            {
              ...wheel({ license_expression: "MIT" }),
              bundled: [{ file: "foo.libs/libgnutls-1.so.30", library: "libgnutls" }],
            },
          ],
        }),
        /libgnutls-1\.so\.30, a library not reviewed/,
      ],
      [world({ "pikepdf==9.11.0": [wheel({ license_expression: "GPL-2.0-only" })] }), /GPL-2.0-only is not allowed/],
      [world({ "sortedcontainers==2.4.0": [wheel({ license_expression: "Apache-2.0" })] }), /drop its PY_DECLARED/],
    ];
    for (const [w, problem] of cases) expect(pythonProblems(w.inv, w.locks).problems.join("\n")).toMatch(problem);
    const extra = world({ "foo==1": [wheel({ license_expression: "MIT" })] });
    extra.inv.packages["bar==9"] = { wheels: [] };
    extra.inv.locks["other/requirements.lock"] = [];
    expect(pythonProblems(extra.inv, extra.locks).problems.join("\n")).toMatch(/bar==9 is in no lock/);
    expect(pythonProblems(extra.inv, extra.locks).problems.join("\n")).toMatch(/not a checked lock/);
    const missing = world({ "foo==1": [wheel({ license_expression: "MIT" })] });
    missing.locks[PY_LOCKS[0] ?? ""] = null as unknown as string;
    expect(pythonProblems(missing.inv, missing.locks).problems.join("\n")).toMatch(/the lock cannot be read/);
  });
});
