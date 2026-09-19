"""
Regression tests for the network monitor eBPF tracepoint (ebpf/security/network_monitor.c).

These tests lock in the fix for the BPF spin lock verifier violation:
The Linux BPF verifier rejects any helper calls (such as bpf_ringbuf_output or
bpf_printk) executed while holding a bpf_spin_lock.

The corrected implementation must:
  * Retain bpf_spin_lock protection over the read-modify-write state of the
    rate-limit map entry (last_seen, count).
  * Ensure NO helper calls execute while the spin lock is held.
  * Execute bpf_spin_unlock before calling bpf_ringbuf_output, bpf_printk, or
    any other helper.
  * Emit rate_events only when the rate limit threshold is exceeded.
  * Preserve exact rate-limiting semantics (window reset, threshold checks,
    and counter increments).
"""

import os
import re

import pytest

SOURCE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "security", "network_monitor.c")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _source():
    with open(SOURCE_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


def _strip_comments_and_strings(code):
    """Remove C comments and string/character literals to prevent false positives."""
    pattern = r'("(?:\\.|[^"\\])*")|(\'(?:\\.|[^\'\\])*\')|(/\*.*?\*/)|(//.*?$)'

    def replace(match):
        if match.group(3) or match.group(4):
            return " "
        if match.group(1) or match.group(2):
            return " "
        return match.group(0)

    return re.sub(pattern, replace, code, flags=re.MULTILINE | re.DOTALL)


def _extract_function_body(source, func_name="trace_tcp_connect"):
    """
    Extract the complete function body for func_name using brace matching.
    Correctly ignores braces inside strings, character literals, and comments.
    """
    pattern = rf"\b{re.escape(func_name)}\s*\([^)]*\)\s*\{{"
    match = re.search(pattern, source)
    if not match:
        raise ValueError(f"Function {func_name} definition not found")

    start_pos = match.end()
    depth = 1
    i = start_pos
    n = len(source)

    while i < n and depth > 0:
        ch = source[i]
        # Skip single-line comments
        if ch == "/" and i + 1 < n and source[i + 1] == "/":
            nl = source.find("\n", i + 2)
            i = nl if nl != -1 else n
            continue
        # Skip multi-line comments
        if ch == "/" and i + 1 < n and source[i + 1] == "*":
            end_comment = source.find("*/", i + 2)
            i = end_comment + 2 if end_comment != -1 else n
            continue
        # Skip string literals
        if ch == '"':
            i += 1
            while i < n and source[i] != '"':
                if source[i] == "\\" and i + 1 < n:
                    i += 2
                else:
                    i += 1
            i += 1
            continue
        # Skip character literals
        if ch == "'":
            i += 1
            while i < n and source[i] != "'":
                if source[i] == "\\" and i + 1 < n:
                    i += 2
                else:
                    i += 1
            i += 1
            continue
        # Track brace nesting
        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return source[start_pos:i]
        i += 1

    raise ValueError(f"Unmatched braces encountered in function {func_name}")


def _get_critical_sections(source):
    """Find all code blocks between bpf_spin_lock and bpf_spin_unlock."""
    pattern = r"bpf_spin_lock\s*\([^)]*\)\s*;(.*?)bpf_spin_unlock\s*\([^)]*\)\s*;"
    return re.findall(pattern, source, re.DOTALL)


def test_no_merge_conflict_markers():
    source = _source()
    for marker in CONFLICT_MARKERS:
        assert marker not in source


def test_spin_lock_guards_rate_limit_state():
    source = _source()
    # The rate-limit map value must contain bpf_spin_lock
    assert "struct bpf_spin_lock lock;" in source
    # Spin lock and unlock must be called
    assert "bpf_spin_lock(&entry->lock);" in source
    assert "bpf_spin_unlock(&entry->lock);" in source


def test_no_helpers_inside_spin_lock_critical_section():
    source = _source()
    sections = _get_critical_sections(source)
    assert len(sections) > 0, "Expected at least one bpf_spin_lock critical section"

    # Generic check: NO BPF helper call may occur between bpf_spin_lock() and bpf_spin_unlock().
    # Detect any BPF helper call syntax: bpf_<helper_name>(
    for section in sections:
        cleaned = _strip_comments_and_strings(section)
        helper_calls = re.findall(r"\bbpf_([a-zA-Z0-9_]+)\s*\(", cleaned)
        assert not helper_calls, (
            f"Forbidden BPF helper call(s) {helper_calls} found inside bpf_spin_lock "
            f"critical section:\n{section.strip()}"
        )


def test_ringbuf_output_and_printk_called_after_unlock():
    source = _source()
    body = _extract_function_body(source, "trace_tcp_connect")

    # The extracted body must actually include the spin lock, unlock, and helper calls
    assert "bpf_spin_lock(&entry->lock);" in body, (
        "bpf_spin_lock(&entry->lock) not found in extracted trace_tcp_connect body"
    )
    assert "bpf_spin_unlock(&entry->lock);" in body, (
        "bpf_spin_unlock(&entry->lock) not found in extracted trace_tcp_connect body"
    )
    assert "bpf_ringbuf_output(" in body, (
        "bpf_ringbuf_output not found in extracted trace_tcp_connect body"
    )
    assert "bpf_printk(" in body, (
        "bpf_printk not found in extracted trace_tcp_connect body"
    )

    unlock_pos = body.find("bpf_spin_unlock(&entry->lock);")
    ringbuf_pos = body.find("bpf_ringbuf_output(&rate_events")
    printk_pos = body.find('bpf_printk("Rate limit exceeded')

    assert unlock_pos != -1, "bpf_spin_unlock(&entry->lock) not found in function body"
    assert ringbuf_pos != -1, "bpf_ringbuf_output not found in function body"
    assert printk_pos != -1, "bpf_printk not found in function body"

    assert ringbuf_pos > unlock_pos, (
        f"bpf_ringbuf_output (offset {ringbuf_pos}) must execute strictly after "
        f"bpf_spin_unlock (offset {unlock_pos})"
    )
    assert printk_pos > unlock_pos, (
        f"bpf_printk (offset {printk_pos}) must execute strictly after "
        f"bpf_spin_unlock (offset {unlock_pos})"
    )


def test_rate_limiting_semantics_preserved():
    source = _source()
    sections = _get_critical_sections(source)
    assert len(sections) >= 1, "Expected at least one bpf_spin_lock critical section"
    cs = sections[0]

    # Verify the critical section extractor captures the complete lock/unlock section
    # and maintains the rate-limit window checks, counter updates, and state changes
    assert "now - entry->last_seen < RATE_LIMIT_WINDOW_NS" in cs
    assert "entry->count >= MAX_CONNS_PER_WINDOW" in cs
    assert "rate_limited = 1" in cs
    assert "entry->count++" in cs
    assert "entry->last_seen = now" in cs
    assert "entry->count = 1" in cs


def test_event_data_captured_for_ringbuf():
    source = _source()
    body = _extract_function_body(source, "trace_tcp_connect")

    # Event structure and fields must be populated and passed to ringbuf inside trace_tcp_connect
    assert "struct drop_event ev" in body
    assert "ev.daddr = rk.daddr" in body
    assert "ev.dport = rk.dport" in body
    assert "ev.ts = now" in body
    assert "bpf_ringbuf_output(&rate_events, &ev, sizeof(ev), 0)" in body


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
