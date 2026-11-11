# The Agent-Reach reader container — the repo's first tool container.
#
# Agent-Reach (https://github.com/Panniantong/Agent-Reach, MIT) is a CLI that
# reads public web and platform channels for an agent. Vestigo runs it as a
# LOCAL_ANALYSIS tool container (packages/collectors/src/platform/agent-reach.ts):
# the worker launches it one-shot per collection, argv-only, and records what it
# prints as evidence. The container does its own egress; the operator authorises
# the channels and owns each platform's terms in their deployment (CLAUDE.md §3).
#
# The image is invoked as:  <image> <channel> <action> <target>
# e.g.                      vestigo/agent-reach github search "<query>"
# The entrypoint adapts Agent-Reach's output into the one envelope the collector
# expects; see infra/agent-reach/README.md for the contract and what still needs
# confirming against a live run.

FROM python:3.12.7-slim-bookworm

# uv, the installer Agent-Reach's own docs use. Copied from the official image,
# pinned, rather than curl|sh so the build has no network trust-on-first-use.
COPY --from=ghcr.io/astral-sh/uv:0.5.11 /uv /usr/local/bin/uv

# Install Agent-Reach from its GitHub release (NOT from PyPI — the PyPI package
# of the same name is a different project, per the upstream install docs).
# TODO(operator): pin to a specific release tag for reproducible builds once a
# version is chosen; `latest` is used here as the upstream docs document it.
RUN uv tool install --python python3.12 \
      https://github.com/Panniantong/Agent-Reach/releases/latest/download/agent-reach.zip \
    && ln -s /root/.local/bin/agent-reach /usr/local/bin/agent-reach

# A non-interactive scaffold step; per-channel sign-in and configuration are
# provided at run time (a mounted config directory or environment), not baked
# into the image. It is allowed to be a no-op if the tool defers setup.
RUN agent-reach setup || true

# The Vestigo adapter: turns `<channel> <action> <target>` into an Agent-Reach
# call and its output into the Vestigo envelope. Run isolated (-I): it ignores
# PYTHONPATH and the cwd, so no planted module can be imported.
COPY entrypoint.py /app/entrypoint.py
ENTRYPOINT ["python", "-I", "/app/entrypoint.py"]
