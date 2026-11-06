// The pilot's deployment files agree with the API (PR 25): the bucket rules the AWS CLI applies (infra/aws) are the
// ones the API's code names, and the pilot compose waits longer for a stop than the API can take.
import { spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/config.ts";
import { STUCK_MS } from "../../src/shutdown.ts";
import { PASSWORDS } from "./helpers.ts";
import { UPLOADS_LIFECYCLE, uploadsCors } from "../../src/storage/s3.ts";

const read = (path: string) => readFileSync(new URL(`../../../../${path}`, import.meta.url), "utf8");

describe("the pilot's deployment files", () => {
  it("s3-cors.json is uploadsCors for https://app.${PGN_DOMAIN}: POST and GET, no header, nothing exposed", () => {
    const rule = JSON.parse(read("infra/aws/s3-cors.json")) as { CORSRules: unknown[] };
    expect(rule.CORSRules).toEqual(uploadsCors("https://app.${PGN_DOMAIN}"));
    expect(JSON.stringify(rule)).not.toMatch(/PUT|DELETE|AllowedHeaders|ExposeHeaders|\*/);
  });

  it("s3-work-lifecycle.json holds the uploads/ rules of UPLOADS_LIFECYCLE", () => {
    const { Rules } = JSON.parse(read("infra/aws/s3-work-lifecycle.json")) as { Rules: { ID: string }[] };
    expect(Rules.filter((rule) => rule.ID.startsWith("uploads-"))).toEqual(UPLOADS_LIFECYCLE);
  });

  it("the API's key deletes only under uploads/ (all that src/modules/media/uploads.ts deletes); the host role has no KMS right", () => {
    type Policy = { Statement: { Effect: string; Action: string | string[]; Resource: string | string[] }[] };
    const api = JSON.parse(read("infra/aws/iam-api-policy.json")) as Policy;
    const deletes = api.Statement.filter(
      (s) => s.Effect === "Allow" && [s.Action].flat().some((action) => action.startsWith("s3:Delete")),
    );
    expect(deletes.map((s) => s.Resource)).toEqual(["arn:aws:s3:::${PGN_S3_WORK_BUCKET}/uploads/*"]);
    expect(UPLOADS_LIFECYCLE.every((rule) => rule.Filter?.Prefix === "uploads/")).toBe(true);
    const host = JSON.parse(read("infra/aws/iam-app-host-role-policy.json")) as Policy;
    expect(JSON.stringify(host)).not.toContain("kms:");
  });

  it("the API's key writes the archive only under Object Lock and can never delete, unlock or hold it", () => {
    type Statement = { Effect: string; Action: string | string[]; Resource: string | string[] };
    const api = JSON.parse(read("infra/aws/iam-api-policy.json")) as { Statement: Statement[] };
    const ARCHIVE = "arn:aws:s3:::${PGN_S3_ARCHIVE_BUCKET}";
    const on = (s: Statement) => [s.Resource].flat().filter((r) => r.startsWith(ARCHIVE));
    const allowed = api.Statement.filter((s) => s.Effect === "Allow" && on(s).length > 0);
    expect(allowed.flatMap((s) => [s.Action].flat()).sort()).toEqual([
      "s3:GetObject",
      "s3:GetObjectVersion",
      "s3:PutObject",
      "s3:PutObjectRetention",
    ]);
    expect(allowed.flatMap(on)).toEqual([`${ARCHIVE}/*`]);
    const denied = api.Statement.filter((s) => s.Effect === "Deny" && on(s).length > 0);
    expect(denied.flatMap((s) => [s.Action].flat()).sort()).toEqual([
      "s3:BypassGovernanceRetention",
      "s3:DeleteObject",
      "s3:DeleteObjectVersion",
      "s3:PutBucketObjectLockConfiguration",
      "s3:PutObjectLegalHold",
    ]);
    expect(denied.flatMap(on).sort()).toEqual([ARCHIVE, `${ARCHIVE}/*`]);
    // the bucket's default: governance mode, the API's default retention (PGN_ARCHIVE_RETAIN_DAYS, owner decision D-20)
    const lock = JSON.parse(read("infra/aws/s3-archive-object-lock.json")) as unknown;
    expect(lock).toEqual({
      ObjectLockEnabled: "Enabled",
      Rule: { DefaultRetention: { Mode: "GOVERNANCE", Days: loadConfig(PASSWORDS).archiveRetainDays } },
    });
  });

  it("compose waits for a stop longer than the API's grace period and its last 5 s", () => {
    const compose = read("infra/docker/compose.pilot.yml");
    const grace = Number(/PGN_SHUTDOWN_GRACE_S: "(\d+)"/.exec(compose)?.[1]);
    const api = compose.slice(compose.indexOf("x-api: &api"), compose.indexOf("x-migrate:"));
    const wait = Number(/stop_grace_period: (\d+)s/.exec(api)?.[1]);
    expect(grace).toBe(10);
    expect(wait).toBeGreaterThan(grace + STUCK_MS / 1000);
    expect(api).toMatch(/init: true|<<: \*hardened/);
    expect(compose).toMatch(/x-hardened: &hardened[\s\S]*?init: true/);
  });

  it("the engine waits out its runner's time limit, runs hardened and gets only its own secrets", () => {
    const compose = read("infra/docker/compose.pilot.yml");
    const engine = compose.slice(compose.indexOf("x-engine-environment:"), compose.indexOf("x-caddy:"));
    const limit = Number(/PGN_RUNNER_TIMEOUT_S: "(\d+)"/.exec(engine)?.[1]);
    const wait = Number(/stop_grace_period: (\d+)s/.exec(engine)?.[1]);
    expect(wait).toBeGreaterThan(limit + 5);
    expect(engine).toMatch(/<<: \*hardened/);
    expect(engine).toMatch(/mem_limit: \d+[mg]/);
    const secrets = [...engine.matchAll(/\$\{(PGN_[A-Z0-9_]+)/g)].map((m) => m[1]);
    for (const name of secrets)
      expect(name).not.toMatch(/^PGN_(APP|AUTH|LISTEN|MIGRATOR|BACKUP|SMTP|POSTGRES)_|^PGN_AUTH_SECRET$/);
    expect(secrets).toContain("PGN_ENGINE_PASSWORD");
    expect(secrets).toContain("PGN_ENGINE_S3_SECRET_ACCESS_KEY");
    expect(engine).not.toMatch(/PGN_S3_SECRET_ACCESS_KEY: \$\{PGN_S3_SECRET_ACCESS_KEY/); // not the API's key
    // reads under orgs/, writes only renditions, deletes nothing: a decoder exploit cannot destroy any paper's originals
    type Policy = { Statement: { Effect: string; Action: string | string[]; Resource: string }[] };
    const policy = JSON.parse(read("infra/aws/iam-engine-policy.json")) as Policy;
    expect(policy.Statement.map((st) => [st.Effect, [st.Action].flat().sort(), st.Resource])).toEqual([
      ["Allow", ["s3:GetObject", "s3:GetObjectVersion"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*"],
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/assets/*/r/*"],
      // a Word import's result file only, never its original (imports/<id>/original)
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/imports/*/result-*.json"],
      // L2.3: an engine profile's config, and a run's own files; never its request (runs/<id>/request.json)
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/profiles/*/config.json"],
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/runs/*/pages/*"],
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/runs/*/edition.pdf"],
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/runs/*/press-files.zip"],
      // L4: the bundle an onboarding made; never its PDFs or inputs.json
      ["Allow", ["s3:PutObject"], "arn:aws:s3:::${PGN_S3_WORK_BUCKET}/orgs/*/pubs/*/onboarding/*/dataset.zip"],
    ]);
  });

  it("serves the owner's legal texts from a read-only host folder, the six names only, never the app's page (L2-230)", () => {
    const caddy = read("infra/caddy/Caddyfile");
    const legal = caddy.slice(caddy.indexOf("handle /legal-text/* {"), caddy.indexOf("# Any other path"));
    expect(legal).toContain("@other not path_regexp ^/legal-text/(privacy|terms|grievance)\\.(en|mr)\\.txt$");
    expect(legal).toContain("error @other 404");
    expect(legal).toContain("import spa_headers");
    expect(legal).toMatch(/root \* \/srv\n\t\tfile_server\n/);
    expect(legal).not.toMatch(/try_files|index\.html/);
    // before the app's catch-all, which would answer index.html
    expect(caddy.indexOf("handle /legal-text/*")).toBeLessThan(caddy.indexOf("\thandle {"));
    const compose = read("infra/docker/compose.pilot.yml");
    expect(compose).toContain("- ${PGN_LEGAL_DIR:-/etc/pageinator/legal}:/srv/legal-text:ro"); // pilot: x-caddy
    expect(compose).toContain("- ${PGN_LEGAL_DIR:-legal-text-local}:/srv/legal-text:ro"); // pilot-local: caddy-local
  });
});

describe("the pilot compose and its settings", () => {
  it("needs, in the pilot, only settings that docs/runbooks/aws-setup.md lists (pilot-local's own have defaults)", () => {
    const compose = read("infra/docker/compose.pilot.yml");
    const setup = read("docs/runbooks/aws-setup.md");
    // compose interpolates every service, whatever its profile: a pilot-local-only :? would stop the pilot
    const required = new Set([...compose.matchAll(/\$\{([A-Z0-9_]+):\?/g)].map((m) => m[1] ?? ""));
    required.delete("PGN_IMAGE_TAG"); // deploy.sh sets it
    for (const name of required) expect(setup, name).toContain(`\`${name}\``);
    // optional: passed only when the env file has it, so the contact form can stay unconnected (L2-230)
    expect(compose).toMatch(/^ {2}PGN_CONTACT_TO:$/m);
  });

  it("has an ECR repository (aws-setup.md §8) and a build line (deploy.md) for every image the pilot runs", () => {
    const compose = read("infra/docker/compose.pilot.yml");
    const repos = /for r in ([^;]+); do\n {2}aws ecr create-repository/.exec(read("docs/runbooks/aws-setup.md"));
    const deploy = read("docs/runbooks/deploy.md");
    const images = new Set([...compose.matchAll(/\/(pageinator-[a-z-]+):\$\{PGN_IMAGE_TAG/g)].map((m) => m[1] ?? ""));
    expect([...images].sort()).toEqual([
      "pageinator-api",
      "pageinator-backup",
      "pageinator-engine-worker",
      "pageinator-web",
    ]);
    for (const image of images) {
      expect(repos?.[1]?.split(" "), image).toContain(image);
      expect(deploy, image).toContain(`$reg/${image}:$tag --push`);
    }
  });

  it("runs the edit gateway hardened on the engine's homes, with the engine's S3 key and no database or Claude key", () => {
    const compose = read("infra/docker/compose.pilot.yml");
    const gateway = compose.slice(compose.indexOf("x-gateway-environment:"), compose.indexOf("x-caddy:"));
    expect(gateway).toMatch(/<<: \*hardened/);
    expect(gateway).toMatch(/mem_limit: \d+[mg]/);
    expect(gateway).toContain('command: ["python", "-B", "-m", "pgn_worker.gateway"]');
    const secrets = [...gateway.matchAll(/\$\{(PGN_[A-Z0-9_]+)/g)].map((m) => m[1]);
    expect(secrets).toContain("PGN_GATEWAY_SECRET");
    expect(secrets).toContain("PGN_ENGINE_S3_SECRET_ACCESS_KEY");
    for (const name of secrets) expect(name).not.toMatch(/PASSWORD|^PGN_AUTH_SECRET$|ANTHROPIC|^PGN_S3_SECRET/);
    const service = compose.slice(compose.indexOf("\n  gateway:\n"), compose.indexOf("# ---- pilot-local"));
    expect(service).toContain("engine-homes:/var/lib/pageinator/homes");
    expect(service).not.toMatch(/ports:/); // only the API reaches it
    // the API is signed to it, at the one http address its settings allow
    const config = loadConfig({
      ...PASSWORDS,
      PGN_GATEWAY_URL: "http://gateway:8790",
      PGN_GATEWAY_SECRET: "ab".repeat(32),
    });
    expect(compose).toContain("PGN_GATEWAY_URL: http://gateway:8790");
    expect(config.gateway?.url).toBe("http://gateway:8790");
  });
});

// infra/deploy/deploy.sh with fake docker, curl, aws, id and flock on PATH: what it starts, in which order, and what
// it records. Each fake logs its arguments, with the image tag in force, to one file.
// Each test runs the real deploy.sh with stub commands: seconds of shell work that overran 5 s on a busy machine.
describe("deploy.sh", { timeout: 30_000 }, () => {
  const script = fileURLToPath(new URL("../../../../infra/deploy/deploy.sh", import.meta.url));
  let dir = "";
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pgn-deploy-"));
    mkdirSync(join(dir, "bin"));
    const fake = (name: string, body: string) => {
      writeFileSync(
        join(dir, "bin", name),
        `#!/bin/sh\necho "${name} \${PGN_IMAGE_TAG:-} $*" >>"${dir}/log"\n${body}\n`,
      );
      chmodSync(join(dir, "bin", name), 0o755);
    };
    // FAIL_UP / FAIL_MIGRATE: the tag whose `up --wait` or migration fails
    fake(
      "docker",
      `case "$*" in *" up "*) [ "$PGN_IMAGE_TAG" != "\${FAIL_UP:-}" ] ;; *" run "*) [ "$PGN_IMAGE_TAG" != "\${FAIL_MIGRATE:-}" ] ;; esac`,
    );
    fake("curl", "exit 0");
    fake("flock", "exit 0");
    fake("id", "echo 0");
    // SSM's answer: AWS_ANSWER lines, then AWS_EXIT
    fake("aws", `case "$*" in *ssm*) printf "$AWS_ANSWER"; exit "\${AWS_EXIT:-0}" ;; *) echo token ;; esac`);
    writeFileSync(join(dir, "pilot.env"), "PGN_REGISTRY='registry.example.test'\n");
    writeFileSync(join(dir, "ca.pem"), "a certificate\n");
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  const deploy = (args: string[], env: Record<string, string> = {}) => {
    writeFileSync(join(dir, "log"), "");
    const result = spawnSync("sh", [script, ...args], {
      encoding: "utf8",
      env: {
        PATH: `${dir}/bin:/usr/bin:/bin`,
        PGN_PROFILE: "pilot-local",
        PGN_ENV_FILE: join(dir, "pilot.env"),
        PGN_STATE_DIR: join(dir, "state"),
        ...env,
      },
    });
    const log = readFileSync(join(dir, "log"), "utf8");
    return { status: result.status, out: result.stdout + result.stderr, log };
  };
  const state = (name: string) => readFileSync(join(dir, "state", name), "utf8").trim();
  const started = (log: string) => [...log.matchAll(/^docker (\S+) .* up -d --wait/gm)].map((m) => m[1]);
  const migrated = (log: string) => [...log.matchAll(/^docker (\S+) .* run --rm migrate/gm)].map((m) => m[1]);

  it("checks, after the services are up, that the API reaches the edit gateway", () => {
    const { status, log } = deploy(["deploy", "t1"]);
    expect(status).toBe(0);
    const up = log.indexOf(" up -d --wait");
    const exec = log.indexOf(" exec -T api-local node -e");
    expect(up).toBeGreaterThan(-1);
    expect(exec).toBeGreaterThan(up);
    expect(log).toContain("http://gateway:8790/v1/call");
  });

  it("after a deploy that failed at the start, a rollback starts the release that ran before it, not the one before that", () => {
    expect(deploy(["deploy", "r1"]).status).toBe(0);
    expect(deploy(["deploy", "r2"]).status).toBe(0);
    const failed = deploy(["deploy", "r3"], { FAIL_UP: "r3" });
    expect(failed.status).not.toBe(0);
    expect(migrated(failed.log)).toEqual(["r3"]);
    expect([state("current"), state("previous"), state("attempt")]).toEqual(["r2", "r1", "r3"]);

    const rollback = deploy(["rollback"]);
    expect(rollback.status).toBe(0);
    expect(rollback.out).toContain("the deploy of r3 did not finish: starting r2 again");
    expect(started(rollback.log)).toEqual(["r2"]);
    expect(migrated(rollback.log)).toEqual([]);
    expect([state("current"), state("previous")]).toEqual(["r2", "r1"]);
    expect(existsSync(join(dir, "state", "attempt"))).toBe(false);

    // with no deploy under way, a rollback goes to the previous release, and the two swap
    const back = deploy(["rollback"]);
    expect(started(back.log)).toEqual(["r1"]);
    expect([state("current"), state("previous")]).toEqual(["r1", "r2"]);
  });

  it("after a migration that failed, a rollback starts the current release again", () => {
    deploy(["deploy", "r1"]);
    deploy(["deploy", "r2"]);
    const failed = deploy(["deploy", "r3"], { FAIL_MIGRATE: "r3" });
    expect(failed.status).not.toBe(0);
    expect(started(failed.log)).toEqual([]);
    expect(started(deploy(["rollback"]).log)).toEqual(["r2"]);
  });

  it("refuses a state file that holds anything but a tag", () => {
    deploy(["deploy", "r1"]);
    writeFileSync(join(dir, "state", "previous"), "r0; rm -rf /\n");
    const result = deploy(["rollback"]);
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("does not hold an image tag");
    expect(started(result.log)).toEqual([]);
  });

  it("keeps the settings file when reading SSM fails part way, and leaves nothing decrypted behind", () => {
    const pilot = { PGN_PROFILE: "pilot", PGN_DB_CA_FILE: join(dir, "ca.pem") };
    const answer = "/pageinator/pilot/PGN_A\\ta\\n/pageinator/pilot/PGN_B\\tb\\n/pageinator/pilot/PGN_C\\tc\\n";
    const result = deploy(["deploy", "r1"], { ...pilot, AWS_ANSWER: answer, AWS_EXIT: "255" });
    expect(result.status).not.toBe(0);
    expect(result.out).toContain("is unchanged");
    expect(readFileSync(join(dir, "pilot.env"), "utf8")).toBe("PGN_REGISTRY='registry.example.test'\n");
    expect(readdirSync(dir).sort()).toEqual(["bin", "ca.pem", "log", "pilot.env", "state"]);
    expect(result.log).not.toMatch(/^docker /m);
  });

  it("writes the settings from a whole SSM answer, and logs out of the registry after the pull", () => {
    const ok = deploy(["deploy", "r1"], {
      PGN_PROFILE: "pilot",
      AWS_ANSWER: `/pageinator/pilot/PGN_REGISTRY\\tregistry.example.test\\n/pageinator/pilot/PGN_DB_CA_FILE\\t${dir}/ca.pem\\n`,
    });
    expect(ok.status).toBe(0);
    expect(readFileSync(join(dir, "pilot.env"), "utf8")).toBe(
      `PGN_REGISTRY='registry.example.test'\nPGN_DB_CA_FILE='${dir}/ca.pem'\n`,
    );
    expect(ok.log).toMatch(/pull --quiet\n(.*\n)?docker \S+ logout registry\.example\.test\n/);
  });
});
