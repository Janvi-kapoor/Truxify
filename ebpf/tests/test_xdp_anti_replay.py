"""
Regression tests for the XDP anti-replay / anti-DoS filter (ebpf/xdp_anti_replay.c).

These tests lock in the fix from issue #13085: the previous implementation was a
per-source-IP inter-arrival throttle (clock based, keyed by the raw, spoofable
source IP, dropping any packet within 5 ms) which neither detected replays nor
protected legitimate bursts. The corrected filter must:

  * read a real per-packet sequence parsed from the UDP payload (with proper
    data_end bounds checks) instead of the local clock,
  * key replay state on a flow that includes the source port (not the raw IP
    alone, so it cannot be trivially spoofed / used for source-spoofing DoS),
  * drop only duplicate/stale replays and otherwise pass strictly-increasing
    sequences (so legitimate bursts survive).
"""

import os
import re

import pytest

SOURCE_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "xdp_anti_replay.c")
)

CONFLICT_MARKERS = ("<<<<<<<", "=======", ">>>>>>>")


def _source():
    with open(SOURCE_PATH, "r", encoding="utf-8") as fh:
        return fh.read()


def test_no_merge_conflict_markers():
    source = _source()
    for marker in CONFLICT_MARKERS:
        assert marker not in source


def test_no_clock_based_inter_arrival_throttle():
    source = _source()
    # The broken implementation keyed on the local clock and dropped packets
    # arriving within 5 ms of the previous one from the same raw source IP.
    assert "bpf_ktime_get_ns" not in source
    assert "5000000" not in source
    assert "current_time" not in source
    assert "last_seen" not in source


def test_reads_real_payload_sequence_with_bounds_check():
    source = _source()
    # A real sequence must be parsed from the packet payload and bounds-checked
    # against data_end before dereferencing.
    assert "__builtin_bswap32" in source
    assert "data_end" in source
    assert "seq_ptr" in source


def test_flow_key_includes_source_port_not_just_ip():
    source = _source()
    # The flow key must combine the source IP *and* the source port so distinct
    # flows / spoofed source IPs cannot starve each other.
    assert "udp->source" in source
    assert "ip->saddr" in source
    assert "flow_key" in source


def test_replay_state_tracks_last_seq_not_just_time():
    source = _source()
    # Replay detection is driven by a per-flow sequence window.
    assert "last_seq" in source
    assert "REPLAY_WINDOW_SIZE" in source
    # Genuine replays are dropped, not throttled by clock.
    assert "XDP_DROP" in source
    assert "XDP_PASS" in source


def test_seq_tracking_map_uses_hash_map_for_spin_lock():
    source = _source()
    # Isolate the seq_tracking_map declaration block
    map_match = re.search(
        r"struct\s*\{([^}]*)\}\s*seq_tracking_map\s*SEC\([^\)]*\);",
        source,
        re.DOTALL,
    )
    assert map_match is not None, "seq_tracking_map declaration block not found"
    map_body = map_match.group(1)

    # Verify that the map's type field is BPF_MAP_TYPE_HASH and not BPF_MAP_TYPE_LRU_HASH
    type_match = re.search(r"__uint\s*\(\s*type\s*,\s*([A-Za-z0-9_]+)\s*\)", map_body)
    assert type_match is not None, "type field not found in seq_tracking_map declaration"
    actual_map_type = type_match.group(1)
    assert actual_map_type == "BPF_MAP_TYPE_HASH", (
        f"Expected seq_tracking_map type to be BPF_MAP_TYPE_HASH, got {actual_map_type}"
    )
    assert "BPF_MAP_TYPE_LRU_HASH" not in map_body

    # Isolate anti_replay_entry struct and verify it contains struct bpf_spin_lock
    struct_match = re.search(
        r"struct\s+anti_replay_entry\s*\{([^}]*)\};",
        source,
        re.DOTALL,
    )
    assert struct_match is not None, "struct anti_replay_entry definition not found"
    struct_body = struct_match.group(1)
    assert "struct bpf_spin_lock lock;" in struct_body, (
        "anti_replay_entry must contain struct bpf_spin_lock lock;"
    )

    # Verify spin lock/unlock are called on entry->lock
    assert "bpf_spin_lock(&entry->lock);" in source
    assert "bpf_spin_unlock(&entry->lock);" in source


def test_map_update_handles_failure_fail_closed():
    source = _source()
    # Structurally verify that bpf_map_update_elem failure on the new-entry path
    # returns XDP_DROP (fail-closed)
    update_fail_pattern = re.search(
        r"if\s*\(\s*bpf_map_update_elem\s*\(\s*&seq_tracking_map\s*,\s*&flow_key\s*,\s*&new_entry\s*,\s*BPF_ANY\s*\)\s*!=\s*0\s*\)\s*\{([^}]*)\}",
        source,
        re.DOTALL,
    )
    assert update_fail_pattern is not None, (
        "bpf_map_update_elem error-handling block not found in xdp_anti_replay.c"
    )
    branch_body = update_fail_pattern.group(1).strip()
    assert "return XDP_DROP;" in branch_body, (
        f"Expected failure branch to return XDP_DROP, got: {branch_body}"
    )


def test_flow_key_packs_ip_into_upper_32_bits():
    source = _source()
    # Flow key must place the 32-bit source IP into the upper 32 bits of the 64-bit key.
    assert "((__u64)ip->saddr << 32) | (__u64)udp->source" in source


if __name__ == "__main__":
    raise SystemExit(pytest.main([__file__, "-v"]))
