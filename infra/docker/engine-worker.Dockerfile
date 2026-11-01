# The engine worker's image (docs/product/10-l2-newsroom-plan.md §2.2, W4). Build from the repository root:
#   docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile -t pageinator-engine-worker .
#   docker build --platform linux/amd64 -f infra/docker/engine-worker.Dockerfile --target test .   # runs the tests
# - linux/amd64 only: the Python licence inventory covers exactly those wheels (tools/licences/python-inventory.json);
# - Python 3.11.14, the base pinned by its amd64 manifest's digest;
# - the worker's lock installed with every hash checked, wheels only, into a venv that then holds the lock and
#   nothing else (its own pip and setuptools are removed once the lock is in);
# - the repository's own code and its 22 OFL stand-in fonts (with their licences), at the repository's paths: no
#   private file (the colour profile is mounted at run time, never built in; the dataset arrives with L2.3);
# - a user that is not root; run with a read-only root (`--read-only`), the homes on a volume and /tmp on a tmpfs:
#   docker run --read-only --tmpfs /tmp -v pgn-homes:/var/lib/pageinator/homes \
#     -v /path/to/newsprint.icc:/run/pageinator/newsprint.icc:ro -e PGN_ICC_SHA256=… pageinator-engine-worker
# The engine's own environment (the frozen oracle lock) and the queue come with L2.3 and W6.

FROM --platform=linux/amd64 python:3.11.14-slim-bookworm@sha256:83f339c1be6340ae1096010fdccf6552ac932d8f410d45d206014916bdf37e48 AS worker

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PATH=/opt/pageinator/venv/bin:$PATH \
    PYTHONPATH=/opt/pageinator/apps/engine-worker \
    PGN_WORKER_HOMES=/var/lib/pageinator/homes \
    PAGEINATOR_ICC=/run/pageinator/newsprint.icc

# the io environment: the worker's lock, wheels only, every hash checked, checked whole; then the venv's own pip and
# setuptools are removed, so the venv holds exactly the lock's packages (pip 24.0's --python cannot install into a
# venv made without pip)
COPY apps/engine-worker/requirements.lock /opt/pageinator/apps/engine-worker/requirements.lock
RUN python -m venv /opt/pageinator/venv \
 && /opt/pageinator/venv/bin/python -m pip install --require-hashes --only-binary=:all: --no-deps \
      -r /opt/pageinator/apps/engine-worker/requirements.lock \
 && /opt/pageinator/venv/bin/python -m pip check \
 && /opt/pageinator/venv/bin/python -m pip uninstall --yes pip setuptools

# the repository's code the worker runs, at its paths (pgn_worker finds the Desk through them)
COPY tools/desk/deskserver /opt/pageinator/tools/desk/deskserver
COPY tools/desk/engine /opt/pageinator/tools/desk/engine
COPY apps/engine-worker/pgn_worker /opt/pageinator/apps/engine-worker/pgn_worker
# the OFL stand-in fonts and their licences (the engine's, from L2.3), nothing else of those folders
COPY experiments/phase0/compose2/fonts /opt/pageinator/experiments/phase0/compose2/fonts
COPY tools/oracle/v0/assets/fonts /opt/pageinator/tools/oracle/v0/assets/fonts

RUN groupadd --system --gid 10001 pgn \
 && useradd --system --uid 10001 --gid 10001 --no-create-home --home-dir /nonexistent --shell /usr/sbin/nologin pgn \
 && install -d -o pgn -g pgn -m 0700 /var/lib/pageinator/homes \
 && install -d -o root -g root -m 0755 /run/pageinator

USER 10001:10001
WORKDIR /opt/pageinator
VOLUME ["/var/lib/pageinator/homes"]
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 CMD ["python", "-B", "-m", "pgn_worker.health"]
# until the queue arrives (W6), the container checks itself once and says so
CMD ["python", "-B", "-m", "pgn_worker.health"]

# the worker's tests, run inside the image as its own user (built with --target test; never shipped)
FROM worker AS test
COPY --chown=10001:10001 apps/engine-worker/test /opt/pageinator/apps/engine-worker/test
COPY --chown=10001:10001 packages/contracts/test/fixtures /opt/pageinator/packages/contracts/test/fixtures
RUN python -B -m unittest discover -s /opt/pageinator/apps/engine-worker/test

FROM worker
