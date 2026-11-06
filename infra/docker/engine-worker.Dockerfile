# The engine worker's image (docs/product/10-l2-newsroom-plan.md §2.2, W4). Build from the repository root:
#   docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile -t pageinator-engine-worker .
#   docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile --target test .   # runs the tests
# - linux/amd64 only: the Python licence inventory covers exactly those wheels (tools/licences/python-inventory.json);
# - Python 3.11.14, the base pinned by its amd64 manifest's digest;
# - the worker's lock installed with every hash checked, wheels only, into a venv that then holds the lock and
#   nothing else (its own pip and setuptools are removed once the lock is in);
# - the repository's own code and its 22 OFL stand-in fonts (with their licences), at the repository's paths: no
#   private file (the colour profile is mounted at run time, never built in; a paper's dataset is fetched by
#   engine.setup at run time, into the homes volume);
# - the engine's own environment (L2.3): the frozen oracle's lock (tools/oracle/v0/requirements.lock) with every hash
#   checked, as CI installs it, in a venv of its own at /opt/pageinator/engine-venv (PGN_ENGINE_PYTHON), and the
#   frozen code the engine imports at the repository's paths: tools/oracle/v0 and the experiments/phase0 folders
#   gen1, page1, compose1–3, head1, pdfx1 (the independent checker among them), typeset_harness and results/page1
#   (house_profile.json), byte for byte (never published1: the private dataset's extraction tools);
# - a user that is not root; run with a read-only root (`--read-only`), the homes on a volume and /tmp on a tmpfs:
#   docker run --read-only --tmpfs /tmp -v pgn-homes:/var/lib/pageinator/homes \
#     -v /path/to/newsprint.icc:/run/pageinator/newsprint.icc:ro -e PGN_ICC_SHA256=… pageinator-engine-worker
# - Node 24.22.0 (its binary only, from the official image pinned by its amd64 manifest's digest) and the queue
#   (apps/engine-queue: Graphile Worker, W6) with its production packages from pnpm-lock.yaml, hoisted into
#   /opt/pageinator/node_modules; its own code and packages/contracts at the repository's paths (Node runs the
#   TypeScript as it is). The container runs the queue's process (src/main.ts: as pgn_engine, reporting to the API's
#   inbox, app.engine_event); its health check is the worker's own (pgn_worker.health).

# the queue's packages: the lock's, for apps/engine-queue only, production only, hoisted (pnpm deploy). The copy of
# packages/contracts it makes becomes a link to the repository's path, where Node strips its types (never in node_modules).
# The TypeScript compiler (cosmiconfig's optional peer, for TypeScript config files the queue never has) is left out.
# corepack fetches the pnpm that package.json names, checked against its SHA-512 there
FROM --platform=linux/amd64 node:24.22.0-bookworm-slim@sha256:a8efdaa8f2458a83ad61c9b8e957c94c2312a9e60604d5b9b093cf89ad9f5984 AS queue
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
WORKDIR /build
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/engine-queue/package.json apps/engine-queue/package.json
COPY apps/engine-queue/src apps/engine-queue/src
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/contracts/src packages/contracts/src
RUN corepack enable pnpm \
 && pnpm --filter @pageinator/engine-queue deploy --prod --legacy --frozen-lockfile --ignore-scripts \
      --config.node-linker=hoisted /out \
 && rm -r /out/node_modules/@pageinator/contracts /out/node_modules/.bin /out/node_modules/typescript \
      /out/node_modules/@typescript \
 && ln -s ../../packages/contracts /out/node_modules/@pageinator/contracts

FROM --platform=linux/amd64 python:3.11.14-slim-bookworm@sha256:83f339c1be6340ae1096010fdccf6552ac932d8f410d45d206014916bdf37e48 AS worker

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/opt/pageinator/venv/bin:$PATH \
    PYTHONPATH=/opt/pageinator/apps/engine-worker \
    PGN_WORKER_HOMES=/var/lib/pageinator/homes \
    PAGEINATOR_ICC=/run/pageinator/newsprint.icc \
    PGN_ENGINE_PYTHON=/opt/pageinator/engine-venv/bin/python \
    PGN_ONBOARD_PYTHON=/opt/pageinator/venv/bin/python \
    PGN_ENGINE_STALL_S=600

# the io environment: the worker's lock, wheels only, every hash checked, checked whole; then the venv's own pip and
# setuptools are removed, so the venv holds exactly the lock's packages (pip 24.0's --python cannot install into a
# venv made without pip)
COPY apps/engine-worker/requirements.lock /opt/pageinator/apps/engine-worker/requirements.lock
RUN python -m venv /opt/pageinator/venv \
 && /opt/pageinator/venv/bin/python -m pip install --require-hashes --only-binary=:all: --no-deps \
      -r /opt/pageinator/apps/engine-worker/requirements.lock \
 && /opt/pageinator/venv/bin/python -m pip check \
 && /opt/pageinator/venv/bin/python -m pip uninstall --yes pip setuptools

# the engine environment (L2.3): the frozen oracle's lock, every hash checked, wheels only, then its pip removed too
COPY tools/oracle/v0/requirements.lock /opt/pageinator/tools/oracle/v0/requirements.lock
RUN python -m venv /opt/pageinator/engine-venv \
 && /opt/pageinator/engine-venv/bin/python -m pip install --require-hashes --only-binary=:all: --no-deps \
      -r /opt/pageinator/tools/oracle/v0/requirements.lock \
 && /opt/pageinator/engine-venv/bin/python -m pip check \
 && /opt/pageinator/engine-venv/bin/python -m pip uninstall --yes pip setuptools

# Node and the queue's packages (above), then the repository's code the worker runs, at its paths (pgn_worker finds the
# Desk through them; the queue finds @pageinator/contracts through node_modules' link to packages/contracts)
COPY --from=queue /usr/local/bin/node /usr/local/bin/node
COPY --from=queue /out/node_modules /opt/pageinator/node_modules
COPY apps/engine-queue/package.json /opt/pageinator/apps/engine-queue/package.json
COPY apps/engine-queue/src /opt/pageinator/apps/engine-queue/src
COPY packages/contracts/package.json /opt/pageinator/packages/contracts/package.json
COPY packages/contracts/src /opt/pageinator/packages/contracts/src
COPY tools/desk/deskserver /opt/pageinator/tools/desk/deskserver
COPY tools/desk/engine /opt/pageinator/tools/desk/engine
COPY apps/engine-worker/pgn_worker /opt/pageinator/apps/engine-worker/pgn_worker
# onboarding (engine.onboard): the copy of the Phase-0 PDF reading chain, run in the worker's own venv (its tests and
# fixture generator stay out)
COPY tools/onboard/chain /opt/pageinator/tools/onboard/chain
COPY tools/onboard/onboard.py tools/onboard/intake.py tools/onboard/autocorrect.py /opt/pageinator/tools/onboard/
# the frozen code the engine imports (its OFL stand-in fonts and their licences among it), at the repository's paths
COPY tools/oracle/v0 /opt/pageinator/tools/oracle/v0
COPY experiments/phase0/compose1 /opt/pageinator/experiments/phase0/compose1
COPY experiments/phase0/compose2 /opt/pageinator/experiments/phase0/compose2
COPY experiments/phase0/compose3 /opt/pageinator/experiments/phase0/compose3
COPY experiments/phase0/gen1 /opt/pageinator/experiments/phase0/gen1
COPY experiments/phase0/head1 /opt/pageinator/experiments/phase0/head1
COPY experiments/phase0/page1 /opt/pageinator/experiments/phase0/page1
COPY experiments/phase0/pdfx1 /opt/pageinator/experiments/phase0/pdfx1
COPY experiments/phase0/typeset_harness /opt/pageinator/experiments/phase0/typeset_harness
COPY experiments/phase0/results/page1 /opt/pageinator/experiments/phase0/results/page1
# the synthetic Marathi corpus the press test page sets (tools/desk/engine/deskpresstest.py)
COPY fixtures/typeset/v1/corpus/texts.json /opt/pageinator/fixtures/typeset/v1/corpus/texts.json

RUN groupadd --system --gid 10001 pgn \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin pgn \
 && install -d -o pgn -g pgn -m 0700 /var/lib/pageinator/homes \
 && install -d -o root -g root -m 0755 /run/pageinator

USER 10001:10001
WORKDIR /opt/pageinator
VOLUME ["/var/lib/pageinator/homes"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 CMD ["python", "-B", "-m", "pgn_worker.health"]
# the queue (apps/engine-queue/src/main.ts): Node is the process, so a stop signal reaches it once; running jobs finish
# first (the deployment's stop grace period must exceed PGN_RUNNER_TIMEOUT_S + 5 s). Settings: its header.
CMD ["node", "/opt/pageinator/apps/engine-queue/src/main.ts"]

# the worker's tests, run inside the image as its own user (built with --target test; never shipped)
FROM worker AS test
COPY --chown=10001:10001 apps/engine-worker/test /opt/pageinator/apps/engine-worker/test
COPY --chown=10001:10001 packages/contracts/test/fixtures /opt/pageinator/packages/contracts/test/fixtures
# the Desk's fictional .docx builders (test_docx_import.py uses them)
COPY --chown=10001:10001 tools/desk/test/test_docx.py /opt/pageinator/tools/desk/test/test_docx.py
RUN python -B -m unittest discover -s /opt/pageinator/apps/engine-worker/test \
 && /opt/pageinator/engine-venv/bin/python -B -c 'import sys; sys.path.insert(0, "/opt/pageinator/tools/desk/engine"); import desk_engine' \
 && node --version | grep -qx v24.22.0 \
 && ! find /opt/pageinator/node_modules -name typescript -o -name '@typescript' | grep -q . \
 && node -e 'import("/opt/pageinator/apps/engine-queue/src/index.ts").then((q) => { if (typeof q.startQueue !== "function") process.exit(1); })'

FROM worker
