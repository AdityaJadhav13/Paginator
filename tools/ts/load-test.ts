// The deadline load test (docs/architecture/v2/13_ROADMAP_AND_RISKS.md G4: "load testing at 3× expected deadline
// concurrency"; results in docs/product/12-l2.1-evidence.md). Against a running stack, for a fixed time, all at once:
//   - layout runs: each layout worker lays out its own edition again and again (POST …/editions/:e/runs, then GET
//     …/runs/:r every 2 s until it ends), on the hosted engine;
//   - page-editor moves: each editor opens its own page of a laid-out run (POST …/pages/:n/edit) and, every few
//     seconds, swaps the places of two of its stories and back (POST …/edit/change {kind: "set", rev, modules}: the
//     web editor's swap, on the page's revision), beating the page's lock every 30 s as the web does;
//   - live updates: listeners on the organisation's event stream (GET /api/v1/orgs/:o/events, read as the web reads
//     it), each timing its connection and how late each new run's `layout` event reaches it.
// It records, per kind, the count, the errors by status, p50/p95/max latency (of the answers that succeeded); each run's
// wall time; and, with --project, the peak CPU and memory of that compose project's containers (docker stats).
//
// THE BASELINE IS AN ASSUMPTION. No figure for "expected deadline concurrency" is written anywhere. ASSUMED_BASELINE
// below is ours for the pilot (one Marathi daily, 8–16 pages a night) for the owner to confirm: one layout at a time
// (one page designer lays out; an edition locks while its run goes on), 4 people in the page editor each moving
// something every ~5 s, and 15 screens on live updates (the desk's whole team with the app open). --factor 3 (the
// default) runs three times it.
//
// Setup first (its own, not this script's): a stack with an engine profile ready, and people of one publication who may
// lay out and edit pages (page designers) and are not asked for two-step sign-in. The test makes its own fictional
// editions (POST …/onboarding/test-edition: the sample stories) and lays each editor's edition out once before the
// clock starts (those runs, one at a time, are the unloaded layout times).
//   node tools/ts/load-test.ts <origin> --people <file.json> --out <results.json> [--duration 300] [--factor 3]
//       [--layouts 1] [--editors 4] [--move-every 5] [--screens 15] [--streams-per-person 4] [--project <compose project>]
// <file.json>: {"org": "<id>", "pub": "<id>", "people": [{"email": "…", "password": "…"}, …]}. A person may hold 5
// event streams at once (the API's STREAMS_PER_PERSON): the listeners are spread at most --streams-per-person each.
// pilot-local (Caddy's local CA): NODE_EXTRA_CA_CERTS=<its root.crt>.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { loadavg } from "node:os";
import { parseArgs, promisify } from "node:util";

export type Baseline = { layouts: number; editors: number; moveEveryS: number; screens: number };
/** OUR ASSUMPTION for the pilot at its deadline, for the owner to confirm (see the header). */
export const ASSUMED_BASELINE: Baseline = { layouts: 1, editors: 4, moveEveryS: 5, screens: 15 };

/** The baseline times the factor: more layouts, editors and screens; each editor moves as often as before. */
export function scaled(base: Baseline, factor: number): Baseline {
  const times = (n: number) => Math.ceil(n * factor);
  return {
    layouts: times(base.layouts),
    editors: times(base.editors),
    moveEveryS: base.moveEveryS,
    screens: times(base.screens),
  };
}

/** The nearest-rank percentile of values sorted ascending (0 when there are none). */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))] ?? 0;
}

export type Stats = { n: number; p50: number; p95: number; max: number };
export function stats(values: readonly number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const round = (x: number) => Math.round(x * 10) / 10;
  return {
    n: sorted.length,
    p50: round(percentile(sorted, 50)),
    p95: round(percentile(sorted, 95)),
    max: round(sorted.at(-1) ?? 0),
  };
}

/** One request: its time, its status (a number, or "network" / "timeout" when no answer came) and an error's code. */
export type Sample = { ms: number; status: number | string; code?: string };
export type Summary = { count: number; errors: Record<string, number>; latencyMs: Stats };
/** Count, errors by status and code (4xx, 5xx and no answer), and latency over the answers that succeeded. */
export function summarise(samples: readonly Sample[]): Summary {
  const errors: Record<string, number> = {};
  const ok: number[] = [];
  for (const s of samples) {
    if (typeof s.status === "number" && s.status < 400) ok.push(s.ms);
    else {
      const key = s.code ? `${s.status} ${s.code}` : String(s.status);
      errors[key] = (errors[key] ?? 0) + 1;
    }
  }
  return { count: samples.length, errors, latencyMs: stats(ok) };
}

/** docker stats' sizes ("512KiB", "1.2GiB", "300MB") in bytes. */
export function parseBytes(text: string): number {
  const m = /^([\d.]+)\s*([KMGT]?i?B)$/.exec(text.trim());
  if (!m) return 0;
  const units: Record<string, number> = {
    B: 1,
    KB: 1e3,
    MB: 1e6,
    GB: 1e9,
    TB: 1e12,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  };
  return Number(m[1]) * (units[m[2] ?? "B"] ?? 1);
}

export type Peak = { cpuPct: number; memBytes: number; memLimitBytes: number };
/** Folds one line of `docker stats --format '{{json .}}'` into the peaks per container. */
export function foldStats(peaks: Map<string, Peak>, line: string): void {
  const row = JSON.parse(line) as { Name: string; CPUPerc: string; MemUsage: string };
  const [used = "", limit = ""] = row.MemUsage.split("/");
  const was = peaks.get(row.Name) ?? { cpuPct: 0, memBytes: 0, memLimitBytes: 0 };
  peaks.set(row.Name, {
    cpuPct: Math.max(was.cpuPct, Number.parseFloat(row.CPUPerc) || 0),
    memBytes: Math.max(was.memBytes, parseBytes(used)),
    memLimitBytes: parseBytes(limit),
  });
}

// ------------------------------------------------------------------------------------------- the run

type Json = Record<string, unknown>;
type Answer = { status: number | string; json: Json };
type Module = { story: string; x: number; y: number; w: number; h: number; locked?: boolean };
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const DONE = new Set(["done", "failed", "cancelled"]);

/** A signed-in person: a cookie jar, and requests timed into the kind's samples. */
function person(origin: string, samples: Map<string, Sample[]>) {
  const jar = new Map<string, string>();
  const headers = (json: boolean, extra: Record<string, string> = {}) => ({
    origin,
    "x-pageinator": "1", // the API's Origin and header guard (ADR-025), as the web client sends it
    ...(jar.size ? { cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; ") } : {}),
    ...(json ? { "content-type": "application/json" } : {}),
    ...extra,
  });
  async function call(kind: string, method: string, path: string, body?: unknown, extra?: Record<string, string>) {
    const t0 = performance.now();
    let answer: Answer;
    try {
      const res = await fetch(origin + path, {
        method,
        headers: headers(body !== undefined, extra),
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
        signal: AbortSignal.timeout(120_000),
      });
      for (const cookie of res.headers.getSetCookie()) {
        const [pair = ""] = cookie.split(";");
        const at = pair.indexOf("=");
        jar.set(pair.slice(0, at), pair.slice(at + 1));
      }
      const text = await res.text();
      answer = { status: res.status, json: text.startsWith("{") ? (JSON.parse(text) as Json) : {} };
    } catch (error) {
      answer = { status: error instanceof Error && error.name === "TimeoutError" ? "timeout" : "network", json: {} };
    }
    const list = samples.get(kind) ?? [];
    const code = (answer.json["error"] as Json | undefined)?.["code"];
    list.push({ ms: performance.now() - t0, status: answer.status, ...(typeof code === "string" ? { code } : {}) });
    samples.set(kind, list);
    return answer;
  }
  return { call, headers };
}
type Person = ReturnType<typeof person>;

const idem = () => ({ "idempotency-key": randomUUID() });

/** Lays the edition out once and waits for the run's end → the run as last read, and its wall time. */
async function layOut(
  p: Person,
  api: string,
  edition: string,
  kind: string,
  created?: (run: string, t0: number) => void,
) {
  const t0 = Date.now();
  const made = await p.call(`${kind}.create`, "POST", `${api}/editions/${edition}/runs`, {}, idem());
  const runId = made.json["id"];
  if (made.status !== 202 || typeof runId !== "string") return { run: made.json, wallS: null, status: made.status };
  created?.(runId, t0);
  let run = made.json;
  // at most the engine's own layout limit (compose.pilot.yml PGN_LAYOUT_TIMEOUT_S, 3600 s): a run left hanging ends here
  while (!DONE.has(String(run["state"])) && Date.now() - t0 < 3_600_000) {
    await sleep(2000);
    const now = await p.call(`${kind}.poll`, "GET", `${api}/runs/${runId}`);
    if (now.status === 200) run = now.json;
  }
  return { run, wallS: (Date.now() - t0) / 1000, status: made.status };
}

/** One live-update listener: connect time, every event's arrival, and the first arrival of each run's layout event. */
function listen(
  p: Person,
  origin: string,
  org: string,
  until: () => boolean,
  stream: { connectMs: number[]; drops: number; types: Record<string, number> },
) {
  const firstSeen = new Map<string, number>();
  const controller = new AbortController();
  const run = async () => {
    while (!until()) {
      const t0 = performance.now();
      try {
        const res = await fetch(`${origin}/api/v1/orgs/${org}/events`, {
          headers: { ...p.headers(false), accept: "text/event-stream" },
          signal: controller.signal,
        });
        if (res.status !== 200 || !res.body) {
          stream.types[`refused ${res.status}`] = (stream.types[`refused ${res.status}`] ?? 0) + 1;
          await res.body?.cancel();
          await sleep(5000);
          continue;
        }
        stream.connectMs.push(performance.now() - t0);
        let buffer = "";
        for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
          buffer += chunk;
          let end: number;
          while ((end = buffer.indexOf("\n\n")) >= 0) {
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end + 2);
            const type = /^event: (.*)$/m.exec(block)?.[1];
            const data = /^data: (.*)$/m.exec(block)?.[1];
            if (!type) continue;
            stream.types[type] = (stream.types[type] ?? 0) + 1;
            const runId = type === "layout" && data ? (JSON.parse(data) as Json)["runId"] : null;
            if (typeof runId === "string" && !firstSeen.has(runId)) firstSeen.set(runId, Date.now());
          }
        }
        if (!until()) stream.drops += 1; // the server ended it while the test still ran
      } catch {
        if (!until()) stream.drops += 1;
      }
      if (!until()) await sleep(1000); // the web's retry is 5 s; sooner here, so a drop costs less of the window
    }
  };
  return { done: run(), firstSeen, stop: () => controller.abort() };
}

/** One editor on one page: open it, then a swap of two stories' places (and back) every ~moveEvery s. */
async function edit(p: Person, api: string, run: string, page: number, moveEveryS: number, until: () => boolean) {
  const base = `${api}/runs/${run}/pages/${page}/edit`;
  const opened = await p.call("editor.open", "POST", base);
  let rev = Number(opened.json["rev"] ?? 0);
  let modules = ((opened.json["view"] as Json | undefined)?.["modules"] ?? []) as Module[];
  let beat = Date.now();
  while (!until()) {
    await sleep(moveEveryS * 1000 * (0.8 + Math.random() * 0.4));
    if (until()) break;
    if (Date.now() - beat >= 30_000) {
      await p.call("editor.lock", "POST", `${base}/lock`);
      beat = Date.now();
    }
    const [a, b] = modules.filter((m) => !m.locked);
    if (!a || !b) continue;
    const place = (m: Module) => ({ x: m.x, y: m.y, w: m.w, h: m.h });
    const next = modules.map((m) =>
      m.story === a.story ? { ...m, ...place(b) } : m.story === b.story ? { ...m, ...place(a) } : m,
    );
    const answer = await p.call("editor.move", "POST", `${base}/change`, { kind: "set", rev, modules: next });
    const page_ = answer.status === 200 ? answer.json : ((answer.json["current"] as Json | undefined) ?? null);
    if (page_) {
      rev = Number(page_["rev"] ?? rev);
      modules = ((page_["view"] as Json | undefined)?.["modules"] ?? modules) as Module[];
    }
  }
  await p.call("editor.unlock", "DELETE", `${base}/lock`);
}

/** The peak CPU and memory of the project's containers, sampled until stopped. */
function dockerPeaks(project: string, until: () => boolean) {
  const run = promisify(execFile);
  const peaks = new Map<string, Peak>();
  const done = (async () => {
    const names = (
      await run("docker", ["ps", "--filter", `label=com.docker.compose.project=${project}`, "--format", "{{.Names}}"])
    ).stdout
      .split("\n")
      .filter(Boolean);
    while (!until() && names.length) {
      const out = (await run("docker", ["stats", "--no-stream", "--format", "{{json .}}", ...names])).stdout;
      for (const line of out.split("\n").filter(Boolean)) foldStats(peaks, line);
    }
  })().catch((error: unknown) => {
    // the run goes on and writes its results: only the container peaks stop where they were
    console.error(`docker stats stopped: ${error instanceof Error ? error.message : String(error)}`);
  });
  return { done, peaks };
}

async function main() {
  const { values, positionals } = parseArgs({
    options: {
      people: { type: "string" },
      out: { type: "string" },
      duration: { type: "string", default: "300" },
      factor: { type: "string", default: "3" },
      layouts: { type: "string", default: String(ASSUMED_BASELINE.layouts) },
      editors: { type: "string", default: String(ASSUMED_BASELINE.editors) },
      "move-every": { type: "string", default: String(ASSUMED_BASELINE.moveEveryS) },
      screens: { type: "string", default: String(ASSUMED_BASELINE.screens) },
      "streams-per-person": { type: "string", default: "4" },
      project: { type: "string" },
    },
    allowPositionals: true,
  });
  const origin = positionals[0];
  if (!origin || !values.people || !values.out) {
    console.error("usage: node tools/ts/load-test.ts <origin> --people <file.json> --out <results.json> [options]");
    process.exit(2);
  }
  const baseline: Baseline = {
    layouts: Number(values.layouts),
    editors: Number(values.editors),
    moveEveryS: Number(values["move-every"]),
    screens: Number(values.screens),
  };
  const factor = Number(values.factor);
  const load = scaled(baseline, factor);
  const durationS = Number(values.duration);
  const perPerson = Number(values["streams-per-person"]);
  const setup = JSON.parse(readFileSync(values.people, "utf8")) as {
    org: string;
    pub: string;
    people: { email: string; password: string }[];
  };
  const api = `/api/v1/orgs/${setup.org}/pubs/${setup.pub}`;
  if (load.screens > setup.people.length * perPerson)
    throw new Error(
      `${load.screens} listeners need ${Math.ceil(load.screens / perPerson)} people (${perPerson} streams each)`,
    );

  const samples = new Map<string, Sample[]>();
  const people: Person[] = [];
  for (const { email, password } of setup.people) {
    const p = person(origin, samples);
    const signed = await p.call("sign-in", "POST", "/api/auth/sign-in/email", { email, password });
    if (signed.status !== 200) throw new Error(`${email} could not sign in (${signed.status})`);
    people.push(p);
  }
  const who = (i: number) => people[i % people.length] as Person;

  // ── before the clock: the editions, and each editor's page (laid out one at a time: the unloaded runs) ──
  const edition = async (i: number) => {
    const made = await who(i).call("prepare.test-edition", "POST", `${api}/onboarding/test-edition`, {}, idem());
    if (made.status !== 201)
      throw new Error(`a test edition was refused (${made.status}): ${JSON.stringify(made.json)}`);
    return String(made.json["editionId"]);
  };
  const unloaded: { wallS: number | null; elapsedS: unknown; state: unknown }[] = [];
  const pages: { run: string; page: number }[] = [];
  for (let i = 0; pages.length < load.editors && i < load.editors; i++) {
    const laid = await layOut(who(i), api, await edition(i), "prepare.layout");
    unloaded.push({ wallS: laid.wallS, elapsedS: laid.run["elapsedS"], state: laid.run["state"] });
    for (const pg of (laid.run["pages"] ?? []) as Json[])
      if (pg["state"] === "done") pages.push({ run: String(laid.run["id"]), page: Number(pg["page"]) });
  }
  if (pages.length < load.editors) throw new Error(`only ${pages.length} laid-out pages for ${load.editors} editors`);
  // one at a time: two test editions made at once pick the same free date, and the second answers 500
  const layoutEditions: string[] = [];
  for (let i = 0; i < load.layouts; i++) layoutEditions.push(await edition(i));

  // ── the clock: everything at once ──
  const startedAt = new Date().toISOString();
  // the machine's own load (the generator shares it with the stack, and maybe with other work): 1-minute averages
  const start = loadavg()[0] ?? 0;
  const hostLoad = { start, peak: start, end: 0 };
  const loadTimer = setInterval(() => (hostLoad.peak = Math.max(hostLoad.peak, loadavg()[0] ?? 0)), 5000);
  const end = Date.now() + durationS * 1000;
  const until = () => Date.now() >= end;
  const docker = values.project ? dockerPeaks(values.project, until) : null;
  const stream = { connectMs: [] as number[], drops: 0, types: {} as Record<string, number> };
  const listeners = Array.from({ length: load.screens }, (_, i) => listen(who(i), origin, setup.org, until, stream));
  const created = new Map<string, number>();
  const runs: { wallS: number | null; elapsedS: unknown; state: unknown; status: number | string }[] = [];
  const layouts = layoutEditions.map(async (e, i) => {
    while (!until()) {
      const laid = await layOut(who(i), api, e, "layout", (run, t0) => created.set(run, t0));
      runs.push({ wallS: laid.wallS, elapsedS: laid.run["elapsedS"], state: laid.run["state"], status: laid.status });
      if (laid.wallS === null) await sleep(5000);
    }
  });
  const editors = pages
    .slice(0, load.editors)
    .map((pg, i) => edit(who(i), api, pg.run, pg.page, load.moveEveryS, until));
  await Promise.all([...layouts, ...editors]); // a run going at the end is waited for: its wall time counts
  for (const l of listeners) l.stop();
  await Promise.all(listeners.map((l) => l.done));
  await docker?.done;
  clearInterval(loadTimer);
  hostLoad.end = loadavg()[0] ?? 0;

  const delays: number[] = [];
  let missed = 0;
  for (const [run, t0] of created) {
    for (const l of listeners) {
      const seen = l.firstSeen.get(run);
      if (seen === undefined) missed += 1;
      else delays.push(seen - t0);
    }
  }
  const kinds = Object.fromEntries([...samples].map(([kind, list]) => [kind, summarise(list)]));
  const result = {
    assumption:
      "The baseline is OUR ASSUMPTION for the pilot (no figure is written anywhere): the owner must confirm it.",
    startedAt,
    origin,
    baseline,
    factor,
    load,
    durationS,
    people: people.length,
    hostLoad1m: hostLoad,
    unloadedLayouts: { runs: unloaded, wallS: stats(unloaded.flatMap((r) => (r.wallS === null ? [] : [r.wallS]))) },
    layoutRuns: {
      count: runs.length,
      states: runs.reduce<Record<string, number>>(
        (n, r) => ({ ...n, [String(r.state)]: (n[String(r.state)] ?? 0) + 1 }),
        {},
      ),
      wallS: stats(runs.flatMap((r) => (r.wallS === null ? [] : [r.wallS]))),
      engineElapsedS: stats(runs.flatMap((r) => (typeof r.elapsedS === "number" ? [r.elapsedS] : []))),
    },
    requests: kinds,
    sse: {
      listeners: load.screens,
      connectMs: stats(stream.connectMs),
      drops: stream.drops,
      events: stream.types,
      layoutEventDelayMs: { ...stats(delays), missed, note: "from POST …/runs sent to the run's first layout event" },
    },
    containers: docker ? Object.fromEntries(docker.peaks) : null,
  };
  writeFileSync(values.out, `${JSON.stringify(result, null, 2)}\n`);

  console.log(
    `Load test: baseline ${JSON.stringify(baseline)} (ASSUMED, for the owner to confirm) × ${factor}, ${durationS} s`,
  );
  console.log(`unloaded layout wall s: ${JSON.stringify(result.unloadedLayouts.wallS)}`);
  console.log(
    `layout runs under load: ${runs.length} ${JSON.stringify(result.layoutRuns.states)} wall s ${JSON.stringify(result.layoutRuns.wallS)}`,
  );
  for (const [kind, s] of Object.entries(kinds))
    console.log(
      `${kind.padEnd(22)} n=${s.count} errors=${JSON.stringify(s.errors)} ms p50=${s.latencyMs.p50} p95=${s.latencyMs.p95} max=${s.latencyMs.max}`,
    );
  console.log(
    `sse: connect ms ${JSON.stringify(result.sse.connectMs)}, drops ${stream.drops}, layout event delay ms ${JSON.stringify(result.sse.layoutEventDelayMs)}`,
  );
  for (const [name, p] of docker?.peaks ?? [])
    console.log(
      `${name.padEnd(36)} cpu ${p.cpuPct}%  mem ${(p.memBytes / 2 ** 20).toFixed(0)} / ${(p.memLimitBytes / 2 ** 20).toFixed(0)} MiB`,
    );
  console.log(`host load (1 min): ${JSON.stringify(hostLoad)}`);
  console.log(`results: ${values.out}`);
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
