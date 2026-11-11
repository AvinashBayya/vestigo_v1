#!/usr/bin/env python3
"""Vestigo adapter for the Agent-Reach CLI.

Turns the argv ``<channel> <action> <target>`` into an Agent-Reach call and its
output into the one JSON envelope the Vestigo collector reads
(packages/collectors/src/platform/agent-reach.ts):

    {"collectedAt": "<ISO-8601 UTC>", "items": [
        {"url": ..., "title": ..., "author": ..., "publishedAt": ..., "text": ...},
        ...
    ]}

Rules this adapter keeps (CLAUDE.md §1, §3, §5, §8):

* It never invents data. Every item field is taken from Agent-Reach's own
  output, or is ``null``. When Agent-Reach returns a shape this adapter does not
  recognise, the whole output is passed through as one item's ``text`` rather
  than being guessed at field by field.
* A failure is a failure. If Agent-Reach cannot be run, exits non-zero, or
  reports ``ok: false``, this adapter writes nothing to stdout and exits
  non-zero, so the collector records a failed collection — never an empty one.
* ``collectedAt`` is this container's own clock when it ran: a measured value,
  never a stand-in for a item's own (unknown) publication time, which stays
  ``null`` unless Agent-Reach states it.
* The target is passed to Agent-Reach as a single argv element, never through a
  shell, so nothing in it is interpreted as a command.

WHAT IS CONFIRMED vs PENDING. Agent-Reach v1.6+ prints one JSON object with
``ok`` / ``result`` / ``error`` fields (its install docs). The exact shape of
``result`` per channel, and which field in it holds a URL, a title, an author or
a timestamp, can only be confirmed against a live container run; the field names
tried below are the common ones, and anything unrecognised is preserved as text
rather than dropped. Adjust ``_ITEM_KEYS`` and ``_LIST_KEYS`` once confirmed.
"""

from __future__ import annotations

import json
import subprocess
import sys
from datetime import datetime, timezone
from typing import Any

# Field names Agent-Reach's per-channel results are tried against, most specific
# first. Unknown fields are never guessed; an item with none of these keeps its
# whole object as text.
_ITEM_KEYS: dict[str, tuple[str, ...]] = {
    "url": ("url", "link", "permalink", "href", "web_url"),
    "title": ("title", "name", "heading", "subject"),
    "author": ("author", "user", "username", "uploader", "owner", "handle"),
    "publishedAt": ("publishedAt", "published_at", "created_at", "date", "time", "timestamp"),
    "text": ("text", "content", "body", "description", "summary", "transcript"),
}

# Keys under which a result object may carry the list of items.
_LIST_KEYS: tuple[str, ...] = (
    "items",
    "results",
    "data",
    "posts",
    "videos",
    "tweets",
    "notes",
    "entries",
    "list",
)


def _fail(message: str, code: int = 1) -> "None":
    """Write a reason to stderr and exit non-zero, printing nothing to stdout."""
    sys.stderr.write(f"agent-reach adapter: {message}\n")
    raise SystemExit(code)


def _pick(obj: dict[str, Any], names: tuple[str, ...]) -> Any:
    for name in names:
        value = obj.get(name)
        if value is not None and value != "":
            return value
    return None


def _as_text(value: Any) -> "str | None":
    if value is None:
        return None
    if isinstance(value, str):
        return value if value.strip() else None
    return json.dumps(value, ensure_ascii=False, sort_keys=True)


def _item_from(raw: Any) -> dict[str, Any]:
    """Map one raw result element to an envelope item, inventing nothing."""
    if not isinstance(raw, dict):
        return {"url": None, "title": None, "author": None, "publishedAt": None, "text": _as_text(raw)}
    item = {
        "url": _as_text(_pick(raw, _ITEM_KEYS["url"])),
        "title": _as_text(_pick(raw, _ITEM_KEYS["title"])),
        "author": _as_text(_pick(raw, _ITEM_KEYS["author"])),
        "publishedAt": _as_text(_pick(raw, _ITEM_KEYS["publishedAt"])),
        "text": _as_text(_pick(raw, _ITEM_KEYS["text"])),
    }
    # If none of the known fields matched, keep the whole object as text so
    # nothing the tool returned is silently dropped.
    if all(value is None for value in item.values()):
        item["text"] = _as_text(raw)
    return item


def _items_from(result: Any) -> list[dict[str, Any]]:
    if isinstance(result, list):
        return [_item_from(element) for element in result]
    if isinstance(result, dict):
        for key in _LIST_KEYS:
            value = result.get(key)
            if isinstance(value, list):
                return [_item_from(element) for element in value]
        return [_item_from(result)]
    # A scalar (a string transcript, say): one item carrying it verbatim.
    text = _as_text(result)
    return [] if text is None else [{"url": None, "title": None, "author": None, "publishedAt": None, "text": text}]


def _agent_reach_argv(channel: str, action: str, target: str) -> list[str]:
    """The Agent-Reach command. A URL target uses its `read` auto-router."""
    lowered = target.strip().lower()
    if lowered.startswith("http://") or lowered.startswith("https://"):
        return ["agent-reach", "read", target]
    return ["agent-reach", channel, action, target]


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        _fail(f"expected <channel> <action> <target>, got {len(argv)} argument(s)", code=2)
    channel, action, target = argv

    try:
        completed = subprocess.run(  # noqa: S603 — argv list, no shell.
            _agent_reach_argv(channel, action, target),
            capture_output=True,
            text=True,
            check=False,
        )
    except FileNotFoundError:
        return _fail("the agent-reach executable was not found in the container", code=127) or 127

    stdout = completed.stdout or ""
    if completed.returncode != 0:
        # The tool ran and failed: propagate the failure, never an empty success.
        hint = (completed.stderr or "").strip() or stdout.strip() or "no detail"
        return _fail(f"agent-reach exited {completed.returncode}: {hint[:500]}", code=1) or 1

    stripped = stdout.strip()
    if not stripped:
        return _fail("agent-reach printed nothing", code=1) or 1

    # Agent-Reach v1.6+ prints one JSON object {ok, result, error}. Older
    # versions (or a channel that prints plain text) are preserved verbatim.
    try:
        parsed = json.loads(stripped)
    except json.JSONDecodeError:
        items = [{"url": None, "title": None, "author": None, "publishedAt": None, "text": stripped}]
        parsed = None
    else:
        if isinstance(parsed, dict) and parsed.get("ok") is False:
            error = parsed.get("error")
            hint = error.get("hint") if isinstance(error, dict) else error
            return _fail(f"agent-reach reported failure: {_as_text(hint) or 'no hint'}", code=1) or 1
        result = parsed.get("result") if isinstance(parsed, dict) and "result" in parsed else parsed
        items = _items_from(result)

    envelope = {
        "collectedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "items": items,
    }
    json.dump(envelope, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
