"""Offline relay contract tests; fake Sites and synthetic loopback HTTP only."""
import io
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
import threading
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
import uuid

import site_relay as relay


RELAY_TOKEN = "synthetic-relay-" + "r" * 48
SITES_TOKEN = "synthetic-sites-" + "s" * 48
BRIDGE_TOKEN = "synthetic-bridge-" + "b" * 48
EXPECTED_SHA = "c" * 64


def task(operation="status", identifier=None, **arguments):
    return {"id": identifier or uuid.uuid4().hex,
            "operation": operation, "arguments": arguments}


def envelope(identifier, status="queued", **fields):
    return {"ok": True, "data": {"id": identifier, "status": status, **fields}}


class FakeBridge:
    def __init__(self):
        self.calls = []
        self.post_error = None
        self.get_error = None
        self.jobs = {}
        self.local_imports = {}
        self.local_import_fields = {}
        self.post_status = "queued"
        self.post_fields = {}
        self.metadata = {"engine": {"blocked_unknown": True}, "device": {"device_io": False}}
        self.catalog = {"apps": [{"profile": "nes", "variants": [
            {"id": "nes-test", "sha256": EXPECTED_SHA, "ready": True}]}]}
        self.hook = None

    def request(self, method, route, body=None):
        self.calls.append((method, route, body))
        if self.hook is not None:
            self.hook(method, route, body)
        if method == "POST":
            if route == "/v1/library/open":
                self.local_imports[body["id"]] = {"ok": True, "data": {
                    "id": body["id"], "opened": True, "device_io": False,
                    "expires_in": 300, **self.local_import_fields}}
                if self.post_error is not None:
                    raise self.post_error
                return self.local_imports[body["id"]]
            self.jobs[body["id"]] = envelope(body["id"], self.post_status, **self.post_fields)
            if self.post_error is not None:
                raise self.post_error
            return self.jobs[body["id"]]
        if self.get_error is not None:
            raise self.get_error
        if route.startswith("/v1/library/open/"):
            identifier = route.rsplit("/", 1)[-1]
            if identifier not in self.local_imports:
                raise relay.RelayError("http_rejected", 404)
            return self.local_imports[identifier]
        if route.startswith("/v1/jobs/"):
            identifier = route.rsplit("/", 1)[-1]
            if identifier not in self.jobs:
                raise relay.RelayError("http_rejected", 404)
            return self.jobs[identifier]
        if route == "/v1/catalog":
            return {"ok": True, "data": self.catalog}
        return {"ok": True, "data": self.metadata}


class FakeSite:
    def __init__(self):
        self.tasks = []
        self.calls = []
        self.result_error = None
        self.connected = True

    def request(self, method, route, body=None):
        self.calls.append((method, route, body))
        if route == "/relay/poll":
            batch, self.tasks = self.tasks, []
            return {"tasks": batch, "connected": self.connected}
        if route == "/relay/result" and self.result_error is not None:
            raise self.result_error
        if route == "/relay/result":
            return {"saved": True}
        return {"ok": True}


class BoundedSite(FakeSite):
    """Enforce the Worker's wire and sanitized-result envelope limits."""

    def __init__(self):
        super().__init__()
        self.accepted = []
        self.result_attempts = []
        self.receipts = {}
        self.lose_ack_once = False
        self.result_hook = None
        self.rejections = []

    def request(self, method, route, body=None):
        if route == "/relay/result":
            self.result_attempts.append(json.loads(relay.json_bytes(body)))
            if self.result_hook is not None:
                self.result_hook(body)
            if self.rejections:
                raise self.rejections.pop(0)
        if body is not None and len(relay.json_bytes(body)) > 65_536:
            raise relay.RelayError("http_rejected", 413)
        if route == "/relay/result":
            wire_body = json.loads(relay.json_bytes(body))
            clean = {key: wire_body[key] for key in ("status", "data", "error") if key in wire_body}
            # JSON.stringify emits Unicode directly and counts UTF-16 code
            # units. Inputs here are already projected metadata, like the
            # production relay, so no forbidden fields need sanitizing.
            encoded = json.dumps(clean, separators=(",", ":"), ensure_ascii=False)
            if len(encoded.encode("utf-16-le")) // 2 > 60_000:
                raise relay.RelayError("http_rejected", 413)
            previous = self.receipts.get(body["id"])
            if previous is not None and previous != encoded:
                raise relay.RelayError("http_rejected", 409)
        response = super().request(method, route, body)
        if route == "/relay/result":
            self.receipts[body["id"]] = encoded
            self.accepted.append(json.loads(relay.json_bytes(body)))
            if self.lose_ack_once:
                self.lose_ack_once = False
                raise relay.RelayError("network_unavailable")
        return response


def metadata_at_budget(sample, max_bytes=relay.MAX_METADATA_BYTES):
    """Real descriptive metadata exactly at the wire budget, without payloads."""
    value = {"id": "d" * 32, "status": "unknown", "operation": "plan_app",
        "error": "bridge_outcome_unknown",
        "progress": {"phase": "failed", "failed": True, "verified_sectors": 1,
                     "total_sectors": 2, "message": "Inspect the protected session."},
        "engine": {"active": None, "blocked_unknown": True, "storage_fault": True,
                   "updater_handoff": False, "jobs": {"unknown": 1}},
        "notes": [], "tail": ""}
    while True:
        value["notes"].append(sample)
        if len(relay.json_bytes(value)) > max_bytes:
            value["notes"].pop()
            break
    remaining = max_bytes - len(relay.json_bytes(value))
    value["tail"] = "z " * (remaining // 2) + ("!" if remaining % 2 else "")
    assert len(value["tail"]) <= 500
    assert len(relay.json_bytes(value)) == max_bytes
    return value


class ValidationTests(unittest.TestCase):
    def test_input_snapshot_accepts_no_cloud_port_or_command_arguments(self):
        self.assertEqual(relay.normalize_task(task('input_snapshot'))['arguments'], {})
        self.assertNotIn('input_snapshot', relay.JOB_OPERATIONS)
        for arguments in ({'port': 'COM4'}, {'command': 'FORGE STOP'}, {'path': '/v1/status'},
                          {'firmware': 'FM1-FORGE/1'}):
            with self.subTest(arguments=arguments), self.assertRaises(relay.RelayError):
                relay.normalize_task(task('input_snapshot', **arguments))

    def test_normalized_firmware_identity_and_volume_value_survive_metadata_scrub(self):
        value = {'firmware': 'FM1-FORGE/1', 'volume': {'value': 501, 'gain': 62},
                 'keys': {'pressed': '0000000000000002'}, 'raw': 'private bytes',
                 'firmware_image': 'private bytes'}
        result = relay.metadata_only(value)
        self.assertEqual(result['firmware'], 'FM1-FORGE/1')
        self.assertEqual(result['volume']['value'], 501)
        self.assertNotIn('raw', result)
        self.assertNotIn('firmware_image', result)
        self.assertEqual(relay.metadata_only({'firmware': 'MOD-EDITOR/1'})['firmware'], 'MOD-EDITOR/1')
        self.assertIsNone(relay.metadata_only({'firmware': None})['firmware'])
        self.assertNotIn('firmware', relay.metadata_only({'firmware': 'private firmware blob'}))

    def test_exact_task_schema_rejects_device_or_arbitrary_paths(self):
        bad = [task("reset"), task("read_firmware"), task("status", url="https://other.example"),
               task("status", path="/v1/baseline"), task("plan_app", catalog_id="../escape"),
               task("switch_app", catalog_id="nes-test", entry_method="guess"),
               task("switch_app", catalog_id="nes-test"), task("job", job_id="../escape"),
               task("catalog", command="rm"), task("status", identifier="A" * 32),
               task("open_local_import", url="https://other.example"),
               task("open_local_import", path="F:\\private"),
               task("open_local_import", bundle={"image": "raw"}),
               dict(task(), payload={}), dict(task(), arguments=[])]
        for value in bad:
            with self.subTest(value=value), self.assertRaises(relay.RelayError):
                relay.normalize_task(value)

    def test_origin_rules_require_https_site_and_literal_loopback_http(self):
        self.assertEqual(relay.normalize_origin("https://fm1.example/", site=True), "https://fm1.example")
        self.assertEqual(relay.normalize_origin("http://127.0.0.1:9770", site=False), "http://127.0.0.1:9770")
        self.assertEqual(relay.normalize_origin("http://[::1]:9770", site=False), "http://[::1]:9770")
        self.assertEqual(relay.normalize_origin("https://bench.tailnet.ts.net", site=False), "https://bench.tailnet.ts.net")
        values = [("http://fm1.example", True), ("http://localhost:9770", False),
                  ("http://127.0.0.1.evil.example:9770", False), ("http://192.168.1.2", False),
                  ("https://public.example", False), ("https://user:secret@fm1.example", True),
                  ("https://fm1.example/tools", True), ("https://fm1.example?token=x", True),
                  ("https://fm1.example#part", True), ("https://fm1.example:0", True),
                  ("https://fm1.example\\@evil.example", True), ("https://fm1.example\n", True)]
        for value, site in values:
            with self.subTest(value=value), self.assertRaises(relay.RelayError):
                relay.normalize_origin(value, site=site)

    def test_json_rejects_duplicate_keys_nonfinite_and_oversize(self):
        for raw in (b'{"x":1,"x":2}', b'{"x":NaN}', b'{"x":Infinity}',
                    b"x" * (relay.MAX_JSON_BYTES + 1)):
            with self.assertRaises(relay.RelayError):
                relay.parse_json(raw)

    def test_token_sources_reject_missing_newline_and_oversized_tokens(self):
        with patch.dict(os.environ, {"FM1_TEST_TOKEN": RELAY_TOKEN}):
            self.assertEqual(relay.load_token("FM1_TEST_TOKEN", None), RELAY_TOKEN)
        for value in (None, "short", RELAY_TOKEN + "\r\nInjection", "x" * 4097):
            with self.assertRaises(relay.RelayError):
                relay.validate_token(value)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "synthetic.token"
            path.write_text(RELAY_TOKEN)
            path.chmod(0o600)
            self.assertEqual(relay.load_token("FM1_TEST_TOKEN", path), RELAY_TOKEN)

    def test_recursive_projection_removes_bytes_paths_payloads_and_credentials(self):
        metadata = {"engine": {"blocked_unknown": True}, "id": "a" * 32, "status": "unknown",
                    "image": "raw-image", "firmwareBlob": "raw-firmware", "accessToken": RELAY_TOKEN,
                    "nested": [{"path": "F:\\private\\x", "title": "safe", "note": BRIDGE_TOKEN,
                                "unexpected": b"firmware", "file_name": "secret.bin"}],
                    "message": "Failure in C:\\private\\session.json", "encoded": "A" * 200,
                    "baseline_sha256": "a" * 64,
                    "session": {"blocked": True, "root": "F:\\secret", "loader_running": False},
                    "description": "NES offline variant"}
        result = relay.metadata_only(metadata, (RELAY_TOKEN, SITES_TOKEN, BRIDGE_TOKEN))
        raw = relay.json_bytes(result)
        for private in (b"raw-image", b"raw-firmware", b"private", b"secret", BRIDGE_TOKEN.encode(), RELAY_TOKEN.encode()):
            self.assertNotIn(private, raw)
        self.assertEqual(result["status"], "unknown")
        self.assertTrue(result["session"]["blocked"])
        self.assertEqual(result["nested"], [{"title": "safe"}])
        self.assertEqual(result["baseline_sha256"], "a" * 64)

    def test_recursive_projection_removes_physical_identifiers_preserving_inventory(self):
        identifiers = {key: "synthetic-unique-identity" for key in (
            "serial_number", "SerialNumber", "SERIAL_NUMBER", "serial_no",
            "device_serial_number", "usb_serial_number", "PNPDeviceID",
            "pnp_device_id", "PNP_DEVICE_ID", "pnp_id", "device_instance_id",
            "hardware_id", "hardware_ids", "physical_device_id",
            "device_unique_id", "device_uuid")}
        inventory = {"serial_ports": [{"port": "COM7", "vid": 0x3654,
            "pid": 0x5155, "description": "Synthetic FM1 serial port", **identifiers}],
            "uboot_disks": [{"Model": "WL82 UBOOT1.00 USB Device", **identifiers}],
            "session_configured": True, "device_io": False, "blocked": True}
        result = relay.metadata_only({"device": inventory})
        self.assertEqual(result, {"device": {
            "serial_ports": [{"port": "COM7", "vid": 0x3654, "pid": 0x5155,
                              "description": "Synthetic FM1 serial port"}],
            "uboot_disks": [{"Model": "WL82 UBOOT1.00 USB Device"}],
            "session_configured": True, "device_io": False, "blocked": True}})
        self.assertNotIn(b"synthetic-unique-identity", relay.json_bytes(result))

    def test_ascii_and_multibyte_metadata_at_budget_fit_site_envelopes(self):
        for sample in ("safe text " * 48, "検証済み " * 16):
            with self.subTest(sample=sample[:10]):
                value = metadata_at_budget(sample)
                projected = relay.metadata_only(value)
                self.assertEqual(projected, value)
                self.assertEqual(len(relay.json_bytes(projected)), 58_000)
                result = {"id": "a" * 32, "status": "succeeded", "data": projected}
                site = BoundedSite()
                self.assertEqual(site.request("POST", "/relay/result", result), {"saved": True})
                self.assertLess(len(relay.json_bytes(result)), 65_536)

    def test_one_byte_over_budget_compacts_ascii_and_multibyte_without_losing_outcome(self):
        for sample in ("safe text " * 48, "検証済み " * 16):
            with self.subTest(sample=sample[:10]):
                value = metadata_at_budget(sample)
                value["tail"] += "!"
                self.assertEqual(len(relay.json_bytes(value)), 58_001)
                projected = relay.metadata_only(value)
                self.assertTrue(projected["metadata_truncated"])
                for key in ("id", "status", "operation", "error", "progress", "engine"):
                    self.assertEqual(projected[key], value[key])
                self.assertNotIn("notes", projected)
                self.assertLess(len(relay.json_bytes(projected)), relay.MAX_METADATA_BYTES)


class PrivatePathTests(unittest.TestCase):
    def setUp(self):
        self.path = Path("synthetic-state/tasks/" + "a" * 32 + ".json").absolute()
        self.components = (self.path, *self.path.parents)
        self.leaf_info = SimpleNamespace(st_mode=stat.S_IFREG | 0o600,
                                        st_size=128, st_file_attributes=0)
        self.parent_info = SimpleNamespace(st_mode=stat.S_IFDIR | 0o700,
                                          st_size=0, st_file_attributes=0)

    def info(self, candidate):
        return self.leaf_info if candidate == self.path else self.parent_info

    def test_each_component_is_checked_once_and_verified_leaf_metadata_is_returned(self):
        with patch.object(Path, "lstat", autospec=True, side_effect=self.info) as checked, \
                patch.object(Path, "is_symlink", side_effect=AssertionError("second stat")), \
                patch.object(Path, "stat", side_effect=AssertionError("follows path")):
            self.assertIs(relay._no_symlinks(self.path), self.leaf_info)
        self.assertEqual([call.args[0] for call in checked.call_args_list], list(self.components))

    def test_symlink_mode_and_windows_reparse_attributes_are_rejected_on_any_component(self):
        for unsafe in self.components:
            for mode, attributes in ((stat.S_IFLNK, 0), (stat.S_IFDIR, 0x400)):
                with self.subTest(component=unsafe, mode=mode, attributes=attributes):
                    def info(candidate):
                        return (SimpleNamespace(st_mode=mode, st_file_attributes=attributes)
                                if candidate == unsafe else self.info(candidate))
                    with patch.object(Path, "lstat", autospec=True, side_effect=info), \
                            self.assertRaisesRegex(relay.RelayError, "unsafe_private_path"):
                        relay._no_symlinks(self.path)

    def test_missing_leaf_still_checks_all_ancestors(self):
        def missing_leaf(candidate):
            if candidate == self.path:
                raise FileNotFoundError
            return self.info(candidate)
        with patch.object(Path, "lstat", autospec=True, side_effect=missing_leaf) as checked:
            self.assertIsNone(relay._no_symlinks(self.path))
        self.assertEqual([call.args[0] for call in checked.call_args_list], list(self.components))
        def unsafe_parent(candidate):
            if candidate == self.path:
                raise FileNotFoundError
            if candidate == self.path.parent:
                return SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)
            return self.info(candidate)
        with patch.object(Path, "lstat", autospec=True, side_effect=unsafe_parent), \
                self.assertRaisesRegex(relay.RelayError, "unsafe_private_path"):
            relay._no_symlinks(self.path)

    def test_path_metadata_is_not_cached_between_reads(self):
        with patch.object(Path, "lstat", autospec=True, side_effect=self.info):
            self.assertIs(relay._no_symlinks(self.path), self.leaf_info)
        def changed_parent(candidate):
            if candidate == self.path.parent:
                return SimpleNamespace(st_mode=stat.S_IFLNK, st_file_attributes=0)
            return self.info(candidate)
        with patch.object(Path, "lstat", autospec=True, side_effect=changed_parent), \
                self.assertRaisesRegex(relay.RelayError, "unsafe_private_path"):
            relay._no_symlinks(self.path)


class RelayTests(unittest.TestCase):
    def stock_task(self, expires=9999999999):
        value = task('stock_sysex_update', expected_sha256=EXPECTED_SHA,
                     expected_stock_pair={'inputName': 'FM-1', 'outputName': 'FM-1'}, approval_expires=expires)
        value['arguments']['endpoint_review_id'] = value['id']
        return value

    def test_stock_update_is_independently_disabled_and_invalid_routes_are_rejected(self):
        value = self.stock_task()
        self.assertEqual(self.relay.handle_task(value)['error'], 'stock_update_disabled')
        self.assertFalse(self.bridge.calls)
        value = self.stock_task()
        value['arguments']['expected_stock_pair']['inputName'] = 'Another synth'
        with self.assertRaises(relay.RelayError):
            self.relay.handle_task(value)

    def test_stock_one_use_expiry_and_lost_reply_never_retry_original_write(self):
        self.restart(allow_stock_update=True)
        expired = self.stock_task(expires=1)
        self.assertEqual(self.relay.handle_task(expired)['error'], 'approval_expired')
        self.assertFalse(self.bridge.calls)
        value = self.stock_task()
        self.bridge.post_error = relay.RelayError('network_unavailable')
        first = self.relay.handle_task(value)
        self.assertEqual(first['data']['id'], value['id'])
        posts = [entry for entry in self.bridge.calls if entry[0] == 'POST']
        self.assertEqual(len(posts), 1)
        self.assertEqual(posts[0][2]['expected_stock_pair'], value['arguments']['expected_stock_pair'])
        self.restart()
        self.assertEqual(self.relay.handle_task(value), first)
        self.assertEqual(len([entry for entry in self.bridge.calls if entry[0] == 'POST']), 1)

    def test_stock_heartbeat_capability_can_be_enabled_without_custom_switch_or_vendor_handoff(self):
        self.restart(allow_stock_update=True)
        self.relay.run_once()
        self.assertEqual(self.site.calls[0], ('POST', '/relay/heartbeat', {
            'allow_switch': False, 'allow_official_update': False, 'allow_stock_update': True}))

    def setUp(self):
        self.folder = tempfile.TemporaryDirectory()
        self.root = Path(self.folder.name) / "relay-state"
        self.bridge, self.site = FakeBridge(), FakeSite()
        self.relay = relay.Relay(self.root, self.site, self.bridge,
                                 secrets=(RELAY_TOKEN, SITES_TOKEN, BRIDGE_TOKEN))

    def tearDown(self):
        self.relay.close()
        self.folder.cleanup()

    def restart(self, **fields):
        self.relay.close()
        self.relay = relay.Relay(self.root, self.site, self.bridge, **fields)

    def legacy_result(self, value, max_bytes, sample="safe text " * 48):
        """Seed a completed receipt produced under the former size budget."""
        self.relay.handle_task(value)
        record = self.relay._load(value["id"])
        old = metadata_at_budget(sample, max_bytes)
        old["id"] = value["id"]
        record["result"]["data"] = old
        self.assertLess(len(relay.json_bytes(record)), relay.MAX_JSON_BYTES)
        relay.atomic_json(self.relay._path(value["id"]), record)
        return record["result"]

    def test_metadata_routes_are_fixed_and_job_status_is_authoritative(self):
        job_id = uuid.uuid4().hex
        self.bridge.jobs[job_id] = envelope(job_id, "unknown", operation="switch_app")
        for value in (task("status"), task("catalog"), task("job", job_id=job_id)):
            result = self.relay.handle_task(value)
            self.assertEqual(result["status"], "succeeded")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/status", None), ("GET", "/v1/catalog", None),
                                            ("GET", "/v1/jobs/" + job_id, None)])
        self.assertEqual(result["data"]["status"], "unknown")

    def test_input_snapshot_uses_fixed_get_and_saved_read_only_result(self):
        value = task('input_snapshot')
        self.bridge.metadata = {'state': 'unsupported', 'firmware': 'MOD-EDITOR/1',
            'port': 'COM4', 'capabilities': {'keys': False, 'encoders': False, 'volume': True},
            'keys': None, 'encoders': None,
            'volume': {'value': 501, 'gain': 62, 'valid': True, 'samples': 5, 'errors': 0},
            'observation': {'started_at': 100, 'completed_at': 101},
            'message': 'This firmware exposes volume only; keys and encoders require Forge diagnostics.'}
        first = self.relay.handle_task(value)
        self.assertEqual(first['status'], 'succeeded')
        self.assertEqual(first['data'], self.bridge.metadata)
        self.assertEqual(self.bridge.calls, [('GET', '/v1/input_snapshot', None)])
        self.assertEqual(self.relay.handle_task(value), first)
        self.restart()
        self.assertEqual(self.relay.handle_task(value), first)
        self.assertEqual(len(self.bridge.calls), 1)
        self.assertFalse(self.bridge.jobs)

    def test_local_import_launch_is_saved_before_fixed_post_and_cached_across_restart(self):
        value = task("open_local_import")
        def inspect(method, route, body):
            self.assertEqual(self.relay._load(value["id"])["phase"], "executing")
            self.assertEqual((method, route, body), ("POST", "/v1/library/open", {"id": value["id"]}))
        self.bridge.hook = inspect
        first = self.relay.handle_task(value)
        self.assertEqual(first, {"id": value["id"], "status": "succeeded", "data": {
            "id": value["id"], "opened": True, "device_io": False, "expires_in": 300}})
        self.assertEqual(self.relay.handle_task(value), first)
        self.restart()
        self.assertEqual(self.relay.handle_task(value), first)
        self.assertEqual(len(self.bridge.calls), 1)
        self.assertFalse(self.bridge.jobs)

    def test_local_import_lost_reply_and_redirect_only_inspect_original_launch(self):
        for error in (relay.RelayError("network_unavailable"), relay.RelayError("redirect_rejected", 302)):
            with self.subTest(error=error.label):
                self.bridge.calls.clear()
                value = task("open_local_import")
                self.bridge.post_error = error
                result = self.relay.handle_task(value)
                self.assertTrue(result["data"]["opened"])
                self.assertEqual(self.bridge.calls, [("POST", "/v1/library/open", {"id": value["id"]}),
                    ("GET", "/v1/library/open/" + value["id"], None)])

    def test_local_import_missing_receipt_is_unknown_and_never_relaunches(self):
        value = task("open_local_import")
        self.bridge.post_error = relay.RelayError("network_unavailable")
        self.bridge.get_error = relay.RelayError("http_rejected", 404)
        result = self.relay.handle_task(value)
        self.assertEqual(result, {"id": value["id"], "status": "unknown", "error": "local_import_outcome_unknown"})
        self.restart()
        self.assertEqual(self.relay.handle_task(value), result)
        self.assertEqual(len(self.bridge.calls), 2)

    def test_executing_local_import_recovers_by_get_only_even_without_receipt(self):
        value = task("open_local_import")
        record = self.relay._prepare(value)
        record["phase"] = "executing"
        relay.atomic_json(self.relay._path(value["id"]), record)
        self.restart()
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/library/open/" + value["id"], None)])

    def test_local_import_receipt_is_metadata_allowlist_and_has_no_device_io(self):
        self.bridge.local_import_fields = {"url": "http://127.0.0.1:9770/#private-token", "path": "F:\\private",
            "token": BRIDGE_TOKEN, "image": "A" * 200, "request": {"payload": "bytes"}, "extra": "private"}
        value = task("open_local_import")
        result = self.relay.handle_task(value)
        self.assertEqual(set(result["data"]), {"id", "opened", "device_io", "expires_in"})
        for private in ("private", BRIDGE_TOKEN, "http://", "image", "payload"):
            self.assertNotIn(private, self.relay._path(value["id"]).read_text())

    def test_invalid_local_import_receipt_cannot_report_success(self):
        for fields in ({"id": "f" * 32}, {"opened": "yes"}, {"device_io": True},
                       {"expires_in": True}, {"expires_in": 301}, {"error": "arbitrary exception details"}):
            with self.subTest(fields=fields):
                self.bridge.local_import_fields = fields
                result = self.relay.handle_task(task("open_local_import"))
                self.assertEqual(result["status"], "unknown")
        self.assertTrue(all(route.startswith("/v1/library/open") for _, route, _ in self.bridge.calls))

    def test_local_import_known_failed_unknown_and_expired_receipts_remain_distinct(self):
        for error, opened, status in (("local_import_launch_failed", False, "failed"),
                ("local_import_launch_unknown", False, "unknown"), ("local_import_session_expired", True, "failed")):
            with self.subTest(error=error):
                self.bridge.local_import_fields = {"opened": opened, "error": error}
                result = self.relay.handle_task(task("open_local_import"))
                self.assertEqual(result["status"], status)
                self.assertEqual(result["data"]["error"], error)

    def test_catalog_set_metadata_survives_projection_without_local_package_material(self):
        member = {"id": "nes-test", "profile": "nes", "title": "Local game", "variant": "personal",
                  "sha256": EXPECTED_SHA, "image": "A" * 200, "path": "F:\\private\\game.json"}
        self.bridge.catalog["sets"] = [{"id": "e" * 32, "name": "My apps", "members": [member],
            "imported": 123, "device_io": False, "session_token": BRIDGE_TOKEN}]
        result = self.relay.handle_task(task("catalog"))
        self.assertEqual(result["data"]["apps"], self.bridge.catalog["apps"])
        local_set = result["data"]["sets"][0]
        self.assertEqual(local_set["name"], "My apps")
        self.assertEqual(local_set["members"], [{key: value for key, value in member.items() if key not in {"image", "path"}}])
        self.assertNotIn("session_token", local_set)

    def test_normalized_task_is_persisted_as_executing_before_submission(self):
        value = task("plan_app", catalog_id="nes-test")
        def inspect(method, route, body):
            record = self.relay._load(value["id"])
            self.assertEqual(record["task"], value)
            self.assertEqual(record["phase"], "executing")
        self.bridge.hook = inspect
        result = self.relay.handle_task(value)
        self.assertEqual(result["data"]["id"], value["id"])
        self.assertEqual(self.bridge.calls, [("POST", "/v1/jobs", {"id": value["id"], "operation": "plan_app", "catalog_id": "nes-test"})])

    def test_duplicate_and_restart_use_cached_result_without_repost(self):
        value = task("plan_app", catalog_id="nes-test")
        first = self.relay.handle_task(value)
        self.assertEqual(self.relay.handle_task(value), first)
        self.restart()
        self.assertEqual(self.relay.handle_task(value), first)
        self.assertEqual(len(self.bridge.calls), 1)

    def test_conflicting_task_id_never_executes_second_request(self):
        value = task("plan_app", catalog_id="nes-test")
        self.relay.handle_task(value)
        with self.assertRaisesRegex(relay.RelayError, "task_id_conflict"):
            self.relay.handle_task(task("plan_app", identifier=value["id"], catalog_id="doom-test"))
        self.assertEqual(len(self.bridge.calls), 1)

    def test_lost_submission_reply_queries_original_id_once(self):
        value = task("plan_app", catalog_id="nes-test")
        self.bridge.post_error = relay.RelayError("network_unavailable")
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["data"]["status"], "queued")
        self.assertEqual([(method, route) for method, route, _ in self.bridge.calls],
                         [("POST", "/v1/jobs"), ("GET", "/v1/jobs/" + value["id"])])

    def test_lost_submission_and_missing_receipt_remain_unknown(self):
        value = task("plan_app", catalog_id="nes-test")
        self.bridge.post_error = relay.RelayError("network_unavailable")
        self.bridge.get_error = relay.RelayError("http_rejected", 404)
        result = self.relay.handle_task(value)
        self.assertEqual(result, {"id": value["id"], "status": "unknown", "error": "bridge_outcome_unknown"})
        self.restart()
        self.assertEqual(self.relay.handle_task(value), result)
        self.assertEqual(len(self.bridge.calls), 2)

    def test_restart_of_executing_job_only_queries_saved_id_even_if_switch_disabled(self):
        value = task("switch_app", catalog_id="nes-test", entry_method="already_uboot", expected_sha256=EXPECTED_SHA,
                     approval_expires=int(time.time()) - 1)
        self.relay._prepare(value)
        record = self.relay._load(value["id"])
        record["phase"] = "executing"
        relay.atomic_json(self.relay._path(value["id"]), record)
        self.bridge.jobs[value["id"]] = envelope(value["id"], "failed")
        self.restart()
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(result["data"]["status"], "failed")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/jobs/" + value["id"], None)])

    def test_executing_record_without_bridge_job_cannot_be_resubmitted(self):
        value = task("plan_app", catalog_id="nes-test")
        self.relay._prepare(value)
        record = self.relay._load(value["id"])
        record["phase"] = "executing"
        relay.atomic_json(self.relay._path(value["id"]), record)
        self.restart()
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/jobs/" + value["id"], None)])

    def test_switch_requires_deliberate_local_enable(self):
        disabled = task("switch_app", catalog_id="nes-test", entry_method="serial", expected_sha256=EXPECTED_SHA,
                        approval_expires=int(time.time()) + 120)
        self.assertEqual(self.relay.handle_task(disabled)["error"], "switch_disabled")
        self.assertEqual(self.bridge.calls, [])
        self.restart(allow_switch=True)
        enabled = task("switch_app", catalog_id="nes-test", entry_method="already_uboot", expected_sha256=EXPECTED_SHA,
                       approval_expires=int(time.time()) + 120)
        self.assertEqual(self.relay.handle_task(enabled)["status"], "succeeded")
        self.assertEqual(self.bridge.calls[1][2]["entry_method"], "already_uboot")
        self.assertEqual(set(self.bridge.calls[1][2]), {"id", "operation", "catalog_id", "entry_method"})

    def test_switch_rechecks_exact_approved_digest_and_readiness_before_submission(self):
        self.restart(allow_switch=True)
        fixtures = [({"apps": []}, "catalog_digest_mismatch"),
                    ({"apps": [{"variants": [{"id": "nes-test", "sha256": "d" * 64, "ready": True}]}]}, "catalog_digest_mismatch"),
                    ({"apps": [{"variants": [{"id": "nes-test", "ready": True}]}]}, "catalog_digest_mismatch"),
                    ({"apps": [{"variants": [{"id": "nes-test", "sha256": EXPECTED_SHA, "ready": False}]}]}, "catalog_not_ready")]
        for catalog, label in fixtures:
            self.bridge.catalog = catalog
            value = task("switch_app", catalog_id="nes-test", entry_method="serial", expected_sha256=EXPECTED_SHA,
                         approval_expires=int(time.time()) + 120)
            result = self.relay.handle_task(value)
            self.assertEqual(result["error"], label)
            self.assertEqual(self.relay._load(value["id"])["task"]["arguments"]["expected_sha256"], EXPECTED_SHA)
        self.assertTrue(all(method == "GET" and route == "/v1/catalog" for method, route, _ in self.bridge.calls))

    def test_switch_task_requires_a_valid_approved_digest(self):
        for args in ({}, {"expected_sha256": "invalid"}, {"expected_sha256": "D" * 64}):
            with self.assertRaises(relay.RelayError):
                self.relay.handle_task(task("switch_app", catalog_id="nes-test", entry_method="serial",
                                           approval_expires=int(time.time()) + 120, **args))
        self.assertEqual(self.bridge.calls, [])

    def test_prepared_switch_approval_expiration_prevents_submission_after_restart(self):
        value = task("switch_app", catalog_id="nes-test", entry_method="serial", expected_sha256=EXPECTED_SHA,
                     approval_expires=100)
        self.relay._prepare(value)
        self.restart(allow_switch=True)
        with patch.object(relay.time, "time", return_value=101):
            result = self.relay.handle_task(value)
        self.assertEqual(result["error"], "approval_expired")
        self.assertEqual(self.bridge.calls, [])

    def test_approval_is_rechecked_after_catalog_lookup_immediately_before_post(self):
        self.restart(allow_switch=True)
        value = task("switch_app", catalog_id="nes-test", entry_method="serial", expected_sha256=EXPECTED_SHA,
                     approval_expires=100)
        with patch.object(relay.time, "time", side_effect=[99, 100]):
            result = self.relay.handle_task(value)
        self.assertEqual(result["error"], "approval_expired")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/catalog", None)])

    def test_switch_approval_expiry_is_a_required_integer_timestamp(self):
        for expiry in (None, True, 100.5, "100", 0, 2 ** 53):
            args = {} if expiry is None else {"approval_expires": expiry}
            with self.assertRaises(relay.RelayError):
                self.relay.handle_task(task("switch_app", catalog_id="nes-test", entry_method="serial",
                                           expected_sha256=EXPECTED_SHA, **args))
        self.assertEqual(self.bridge.calls, [])

    def test_auto_switch_preserves_approved_package_and_uses_fixed_bridge_route(self):
        self.restart(allow_switch=True)
        value = task("switch_app", catalog_id="nes-test", entry_method="auto",
                     expected_sha256=EXPECTED_SHA, approval_expires=int(time.time()) + 120)
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "succeeded")
        self.assertEqual(self.bridge.calls, [("GET", "/v1/catalog", None),
            ("POST", "/v1/jobs", {"id": value["id"], "operation": "switch_app",
                "catalog_id": "nes-test", "entry_method": "auto"})])

    def test_official_update_permission_is_independent_of_switch_permission(self):
        for permissions in ({}, {"allow_switch": True}):
            self.restart(**permissions)
            value = task("official_updater", expected_sha256=EXPECTED_SHA,
                         approval_expires=int(time.time()) + 120)
            self.assertEqual(self.relay.handle_task(value), {"id": value["id"],
                "status": "failed", "error": "official_update_disabled"})
            self.assertEqual(self.bridge.calls, [])
        self.restart(allow_official_update=True)
        value = task("official_updater", expected_sha256=EXPECTED_SHA,
                     approval_expires=int(time.time()) + 120)
        self.assertEqual(self.relay.handle_task(value)["status"], "succeeded")
        self.assertEqual(self.bridge.calls, [("POST", "/v1/jobs", {"id": value["id"],
            "operation": "official_updater", "expected_sha256": EXPECTED_SHA})])
        switch = task("switch_app", catalog_id="nes-test", entry_method="auto",
                      expected_sha256=EXPECTED_SHA, approval_expires=int(time.time()) + 120)
        self.assertEqual(self.relay.handle_task(switch)["error"], "switch_disabled")
        self.assertEqual(len(self.bridge.calls), 1)

    def test_official_task_requires_exact_digest_expiry_schema_before_journaling(self):
        valid = {"expected_sha256": EXPECTED_SHA, "approval_expires": 100}
        invalid = [{"approval_expires": 100}, {"expected_sha256": EXPECTED_SHA},
            dict(valid, path="M-UPGRADE.exe"), dict(valid, catalog_id="nes-test"),
            dict(valid, entry_method="auto")]
        invalid.extend(dict(valid, expected_sha256=digest)
                       for digest in (None, True, "invalid", "D" * 64, "d" * 63, "d" * 65))
        invalid.extend(dict(valid, approval_expires=expiry)
                       for expiry in (None, True, 100.5, "100", 0, 2 ** 53))
        for arguments in invalid:
            value = task("official_updater", **arguments)
            with self.subTest(arguments=arguments), self.assertRaises(relay.RelayError):
                self.relay.handle_task(value)
            self.assertFalse(self.relay._path(value["id"]).exists())
        self.assertEqual(self.bridge.calls, [])

    def test_prepared_official_task_expiry_prevents_submission_after_restart(self):
        value = task("official_updater", expected_sha256=EXPECTED_SHA, approval_expires=100)
        self.relay._prepare(value)
        self.restart(allow_official_update=True)
        with patch.object(relay.time, "time", return_value=100):
            result = self.relay.handle_task(value)
        self.assertEqual(result["error"], "approval_expired")
        self.assertEqual(self.bridge.calls, [])

    def test_official_approval_is_rechecked_immediately_before_submission(self):
        self.restart(allow_official_update=True)
        value = task("official_updater", expected_sha256=EXPECTED_SHA, approval_expires=100)
        with patch.object(relay.time, "time", side_effect=[99, 100]):
            result = self.relay.handle_task(value)
        self.assertEqual(result["error"], "approval_expired")
        self.assertEqual(self.bridge.calls, [])

    def test_official_handoff_receipt_survives_duplicate_and_lost_site_ack_restart(self):
        self.restart(allow_official_update=True)
        self.bridge.post_status = "succeeded"
        self.bridge.post_fields = {"operation": "official_updater", "result": {
            "handoff": True, "written_verified": False, "sha256": EXPECTED_SHA}}
        value = task("official_updater", expected_sha256=EXPECTED_SHA,
                     approval_expires=int(time.time()) + 120)
        def inspect(method, route, body):
            record = self.relay._load(value["id"])
            self.assertEqual(record["phase"], "executing")
            self.assertEqual(record["task"], value)
        self.bridge.hook = inspect
        result = self.relay.handle_task(value)
        self.assertTrue(result["data"]["result"]["handoff"])
        self.assertFalse(result["data"]["result"]["written_verified"])
        self.site.result_error = relay.RelayError("network_unavailable")
        with self.assertRaises(relay.RelayError):
            self.relay.report(result)
        self.site.result_error = None
        self.bridge.hook = None
        self.restart()
        self.assertEqual(self.relay.handle_task(value), result)
        self.relay.run_once()
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual(len(self.bridge.calls), 1)
        reports = [body for _, route, body in self.site.calls if route == "/relay/result"]
        self.assertEqual(reports, [result, result])

    def test_official_lost_submission_queries_original_id_and_never_reposts(self):
        self.restart(allow_official_update=True)
        self.bridge.post_error = relay.RelayError("network_unavailable")
        self.bridge.post_status = "succeeded"
        self.bridge.post_fields = {"result": {"handoff": True, "written_verified": False}}
        value = task("official_updater", expected_sha256=EXPECTED_SHA,
                     approval_expires=int(time.time()) + 120)
        result = self.relay.handle_task(value)
        self.assertTrue(result["data"]["result"]["handoff"])
        self.restart()
        self.assertEqual(self.relay.handle_task(value), result)
        self.assertEqual([(method, route) for method, route, _ in self.bridge.calls],
            [("POST", "/v1/jobs"), ("GET", "/v1/jobs/" + value["id"])])

    def test_executing_official_task_recovers_even_if_disabled_and_expired(self):
        value = task("official_updater", expected_sha256=EXPECTED_SHA, approval_expires=100)
        self.relay._prepare(value)
        record = self.relay._load(value["id"])
        record["phase"] = "executing"
        relay.atomic_json(self.relay._path(value["id"]), record)
        self.bridge.jobs[value["id"]] = envelope(value["id"], "succeeded",
            result={"handoff": True, "written_verified": False})
        self.restart()
        result = self.relay.handle_task(value)
        self.assertTrue(result["data"]["result"]["handoff"])
        self.assertEqual(self.bridge.calls, [("GET", "/v1/jobs/" + value["id"], None)])

    def test_official_unknown_receipt_and_changed_digest_never_allow_resubmission(self):
        self.restart(allow_official_update=True)
        self.bridge.post_error = relay.RelayError("network_unavailable")
        self.bridge.get_error = relay.RelayError("http_rejected", 404)
        value = task("official_updater", expected_sha256=EXPECTED_SHA,
                     approval_expires=int(time.time()) + 120)
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "unknown")
        self.restart(allow_official_update=True)
        self.assertEqual(self.relay.handle_task(value), result)
        changed = task("official_updater", identifier=value["id"], expected_sha256="d" * 64,
                       approval_expires=value["arguments"]["approval_expires"])
        with self.assertRaisesRegex(relay.RelayError, "task_id_conflict"):
            self.relay.handle_task(changed)
        self.assertEqual(len(self.bridge.calls), 2)

    def test_metadata_projection_has_journal_headroom_and_stable_cached_receipt(self):
        self.bridge.metadata = {"id": "d" * 32, "status": "unknown",
            "engine": {"blocked_unknown": True, "unknown_jobs": [uuid.uuid4().hex for _ in range(400)]},
            "lots": ["descriptive metadata " * 20 for _ in range(400)]}
        value = task()
        first = self.relay.handle_task(value)
        self.assertLess(len(relay.json_bytes(first)), relay.MAX_METADATA_BYTES)
        self.assertTrue(first["data"]["metadata_truncated"])
        self.assertTrue(first["data"]["engine"]["blocked_unknown"])
        self.assertEqual(first, self.relay.handle_task(value))

    def test_oversized_first_result_does_not_block_later_task_with_real_site_limits(self):
        self.site = BoundedSite()
        self.restart()
        first = task("status", identifier="0" * 32)
        second = task("plan_app", catalog_id="nes-test")
        self.bridge.metadata = {"status": "unknown", "engine": {"blocked_unknown": True},
                                "notes": ["safe text " * 48 for _ in range(125)]}
        self.assertGreater(len(relay.json_bytes(self.bridge.metadata)), 60_000)
        self.assertLess(len(relay.json_bytes(self.bridge.metadata)), relay.MAX_JSON_BYTES)
        self.site.tasks = [first, second]
        self.assertEqual(self.relay.run_once(), 2)
        self.assertEqual([result["id"] for result in self.site.accepted], [first["id"], second["id"]])
        self.assertTrue(self.site.accepted[0]["data"]["metadata_truncated"])
        self.assertEqual(self.site.accepted[0]["data"]["status"], "unknown")
        self.assertTrue(self.site.accepted[0]["data"]["engine"]["blocked_unknown"])
        self.assertEqual(self.site.accepted[1]["data"]["id"], second["id"])
        self.assertTrue(self.relay._load(first["id"])["reported"])
        self.assertTrue(self.relay._load(second["id"])["reported"])
        self.assertEqual([call[0] for call in self.bridge.calls], ["GET", "POST"])
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual([call[0] for call in self.bridge.calls], ["GET", "POST"])

    def test_old_oversized_journal_compacts_only_after_413_and_persists_before_retry(self):
        value = task("plan_app", identifier="0" * 32, catalog_id="nes-test")
        original = self.legacy_result(value, 62_000)
        self.site = BoundedSite()
        def inspect_retry(body):
            if len(self.site.result_attempts) == 2:
                stored = self.relay._load(value["id"])
                self.assertEqual(stored["result"], body)
                self.assertEqual(stored["phase"], "completed")
                self.assertFalse(stored["reported"])
                self.assertTrue(body["data"]["metadata_truncated"])
        self.site.result_hook = inspect_retry
        next_task = task("status")
        self.site.tasks = [next_task]
        self.restart()
        self.assertEqual(self.relay.handle_task(value), original)
        self.assertEqual(self.relay.run_once(), 1)
        recovered = self.site.accepted[0]
        self.assertEqual(recovered["id"], value["id"])
        self.assertTrue(recovered["data"]["metadata_truncated"])
        for key in ("id", "status", "operation", "error", "progress", "engine"):
            self.assertEqual(recovered["data"][key], original["data"][key])
        self.assertEqual(self.site.result_attempts[0], original)
        self.assertEqual(self.site.result_attempts[1], recovered)
        self.assertEqual(self.relay._load(value["id"])["result"], recovered)
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual([result["id"] for result in self.site.accepted], [value["id"], next_task["id"]])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST", "GET"])

    def test_old_accepted_59k_result_with_lost_ack_replays_exactly_after_restart(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, 59_000)
        self.site = BoundedSite()
        self.site.lose_ack_once = True
        self.restart()
        with self.assertRaisesRegex(relay.RelayError, "network_unavailable"):
            self.relay.run_once()
        self.assertEqual(self.site.accepted, [original])
        self.assertFalse(self.relay._load(value["id"])["reported"])
        self.assertEqual(self.relay._load(value["id"])["result"], original)
        self.restart()
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.result_attempts, [original, original])
        self.assertEqual(self.site.accepted, [original, original])
        self.assertEqual(len(self.site.receipts), 1)
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual(self.relay._load(value["id"])["result"], original)
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_legacy_64k_metadata_in_larger_journal_migrates_413_without_repost(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, relay.LEGACY_METADATA_BYTES)
        self.assertEqual(len(relay.json_bytes(original["data"])), 65_536)
        self.assertGreater(self.relay._path(value["id"]).stat().st_size, 65_536)
        self.site = BoundedSite()
        def inspect_retry(body):
            if len(self.site.result_attempts) == 2:
                stored = self.relay._load(value["id"])
                self.assertEqual(stored["result"], body)
                self.assertFalse(stored["reported"])
        self.site.result_hook = inspect_retry
        self.restart()
        self.assertEqual(self.relay.handle_task(value), original)
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.result_attempts[0], original)
        self.assertGreater(len(relay.json_bytes(self.site.result_attempts[0])), 65_536)
        self.assertEqual(len(self.site.result_attempts), 2)
        compact = self.site.accepted[0]
        self.assertTrue(compact["data"]["metadata_truncated"])
        for key in ("id", "status", "operation", "error", "progress", "engine"):
            self.assertEqual(compact["data"][key], original["data"][key])
        record = self.relay._load(value["id"])
        self.assertEqual(record["result"], compact)
        self.assertTrue(record["reported"])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_already_reported_legacy_journal_above_64k_loads_without_reexecution(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, relay.LEGACY_METADATA_BYTES)
        record = self.relay._load(value["id"])
        record["reported"] = True
        path = self.relay._path(value["id"])
        relay.atomic_json(path, record)
        stored_bytes = path.read_bytes()
        self.assertGreater(len(stored_bytes), 65_536)
        self.site = BoundedSite()
        self.restart()
        self.assertEqual(self.relay._load(value["id"]), record)
        self.assertEqual(self.relay.handle_task(value), original)
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.result_attempts, [])
        self.assertEqual(path.read_bytes(), stored_bytes)
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_accepted_multibyte_result_with_large_journal_replays_after_lost_ack(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, 65_350, "検証済み " * 16)
        self.assertLess(len(relay.json_bytes(original)), 65_536)
        self.assertGreater(self.relay._path(value["id"]).stat().st_size, 65_536)
        self.site = BoundedSite()
        self.site.lose_ack_once = True
        self.restart()
        with self.assertRaisesRegex(relay.RelayError, "network_unavailable"):
            self.relay.run_once()
        self.assertEqual(self.site.accepted, [original])
        self.assertFalse(self.relay._load(value["id"])["reported"])
        self.restart()
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.result_attempts, [original, original])
        self.assertEqual(self.site.accepted, [original, original])
        self.assertEqual(self.relay._load(value["id"])["result"], original)
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_local_request_size_rejection_persists_compaction_before_retry(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, 59_000)
        self.site = BoundedSite()
        self.site.rejections = [relay.RelayError("request_too_large")]
        def inspect_retry(body):
            if len(self.site.result_attempts) == 2:
                stored = self.relay._load(value["id"])
                self.assertEqual(stored["result"], body)
                self.assertFalse(stored["reported"])
        self.site.result_hook = inspect_retry
        self.restart()
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.result_attempts[0], original)
        self.assertTrue(self.site.accepted[0]["data"]["metadata_truncated"])
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_non_size_report_errors_do_not_compact_retry_or_change_legacy_receipt(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, 59_000)
        self.site = BoundedSite()
        self.restart()
        for error in (relay.RelayError("network_unavailable"),
                      relay.RelayError("http_rejected", 409),
                      relay.RelayError("http_rejected", 400),
                      relay.RelayError("invalid_response_type")):
            with self.subTest(label=error.label, status=error.status):
                attempts = len(self.site.result_attempts)
                self.site.rejections = [error]
                with self.assertRaises(relay.RelayError):
                    self.relay.report(self.relay.handle_task(value))
                self.assertEqual(len(self.site.result_attempts), attempts + 1)
                self.assertEqual(self.site.result_attempts[-1], original)
                record = self.relay._load(value["id"])
                self.assertEqual(record["result"], original)
                self.assertFalse(record["reported"])
        self.assertEqual(self.site.accepted, [])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_immutable_saved_result_conflict_does_not_change_cached_receipt(self):
        value = task("plan_app", catalog_id="nes-test")
        original = self.legacy_result(value, 59_000)
        self.site = BoundedSite()
        self.site.request("POST", "/relay/result", original)
        conflicting = json.loads(relay.json_bytes(original))
        conflicting["data"]["status"] = "failed"
        self.restart()
        with self.assertRaises(relay.RelayError) as caught:
            self.relay.report(conflicting)
        self.assertEqual(caught.exception.status, 409)
        self.assertEqual(self.site.accepted, [original])
        self.assertEqual(self.site.result_attempts, [original, conflicting])
        record = self.relay._load(value["id"])
        self.assertEqual(record["result"], original)
        self.assertFalse(record["reported"])
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST"])

    def test_site_result_requires_exact_saved_ack_before_marking_reported(self):
        value = task()
        result = self.relay.handle_task(value)
        self.site.request = lambda *_: {"ok": True}
        with self.assertRaisesRegex(relay.RelayError, "invalid_result_acknowledgment"):
            self.relay.report(result)
        self.assertFalse(self.relay._load(value["id"])["reported"])

    def test_known_bridge_rejection_is_fixed_failure_without_private_text(self):
        self.bridge.post_error = relay.RelayError(BRIDGE_TOKEN + " C:\\secret", 409)
        result = self.relay.handle_task(task("plan_app", catalog_id="nes-test"))
        self.assertEqual(result["error"], "bridge_request_rejected")
        self.assertNotIn(BRIDGE_TOKEN, json.dumps(result))
        self.assertEqual(len(self.bridge.calls), 1)

    def test_invalid_job_metadata_after_submit_is_queried_and_never_reposted(self):
        value = task("plan_app", catalog_id="nes-test")
        def malformed(method, route, body):
            self.bridge.calls.append((method, route, body))
            return envelope(uuid.uuid4().hex)
        self.bridge.request = malformed
        result = self.relay.handle_task(value)
        self.assertEqual(result["status"], "unknown")
        self.assertEqual([call[0] for call in self.bridge.calls], ["POST", "GET"])

    def test_lost_site_result_ack_resumes_cached_result_after_restart(self):
        value = task("plan_app", catalog_id="nes-test")
        self.site.tasks = [value]
        self.site.result_error = relay.RelayError("network_unavailable")
        with self.assertRaises(relay.RelayError):
            self.relay.run_once()
        self.assertEqual(len(self.bridge.calls), 1)
        self.restart()
        self.site.result_error = None
        self.relay.run_once()
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.assertEqual(len(self.bridge.calls), 1)
        results = [body for _, route, body in self.site.calls if route == "/relay/result"]
        self.assertEqual(results[0], results[1])

    def test_entire_poll_batch_is_persisted_before_first_result_report(self):
        first, second = task("status"), task("plan_app", catalog_id="nes-test")
        self.site.tasks = [first, second]
        self.site.result_error = relay.RelayError("network_unavailable")
        with self.assertRaises(relay.RelayError):
            self.relay.run_once()
        self.assertEqual(self.relay._load(second["id"])["phase"], "prepared")
        self.site.result_error = None
        self.restart()
        self.relay.run_once()
        self.assertEqual([call[0] for call in self.bridge.calls], ["GET", "POST"])

    def test_idle_heartbeat_reports_switch_disabled_without_bridge_io(self):
        self.assertEqual(self.relay.run_once(), 0)
        self.assertEqual(self.site.calls, [("POST", "/relay/heartbeat", {
            "allow_switch": False, "allow_official_update": False}),
                                          ("POST", "/relay/poll", {})])
        self.assertEqual(self.bridge.calls, [])

    def test_heartbeat_reports_independent_deliberate_official_update_enable(self):
        self.restart(allow_official_update=True)
        self.relay.run_once()
        self.assertEqual(self.site.calls[0], ("POST", "/relay/heartbeat", {
            "allow_switch": False, "allow_official_update": True}))
        self.assertEqual(self.bridge.calls, [])

    def test_poll_validation_happens_before_any_bridge_call(self):
        for values in ([task(), task("reset")], [task(identifier="b" * 32)] * 2):
            self.site.tasks = values
            with self.assertRaises(relay.RelayError):
                self.relay.run_once()
        self.assertEqual(self.bridge.calls, [])

    def test_private_metadata_never_reaches_site_or_journal(self):
        self.bridge.metadata = {"status": "unknown", "image": "x" * 1000,
            "firmware": "x" * 1000, "path": "C:\\private", "message": BRIDGE_TOKEN,
            "safe": True}
        self.site.tasks = [task()]
        self.relay.run_once()
        result = [body for _, route, body in self.site.calls if route == "/relay/result"][0]
        self.assertEqual(result["data"], {"status": "unknown", "safe": True})
        for path in self.relay.tasks_dir.glob("*.json"):
            raw = path.read_bytes()
            self.assertNotIn(BRIDGE_TOKEN.encode(), raw)
            self.assertNotIn(b"private", raw)

    def test_physical_identifiers_never_reach_site_result_or_journal(self):
        self.bridge.metadata = {"engine": {"blocked_unknown": True}, "device": {
            "serial_ports": [{"port": "COM7", "serial_number": "synthetic-unit-serial"}],
            "uboot_disks": [{"Model": "WL82 UBOOT1.00 USB Device",
                             "PNPDeviceID": "synthetic-unit-pnp-identity"}],
            "device_io": False}}
        value = task()
        self.site.tasks = [value]
        self.relay.run_once()
        result = [body for _, route, body in self.site.calls if route == "/relay/result"][0]
        self.assertEqual(result["data"]["device"]["serial_ports"], [{"port": "COM7"}])
        self.assertEqual(result["data"]["device"]["uboot_disks"], [{"Model": "WL82 UBOOT1.00 USB Device"}])
        self.assertTrue(result["data"]["engine"]["blocked_unknown"])
        for raw in (relay.json_bytes(result), self.relay._path(value["id"]).read_bytes()):
            self.assertNotIn(b"synthetic-unit-serial", raw)
            self.assertNotIn(b"synthetic-unit-pnp-identity", raw)

    def test_task_cannot_copy_configured_credentials_into_private_journal(self):
        token = "e" * 64
        self.restart(secrets=(token,))
        with self.assertRaisesRegex(relay.RelayError, "invalid_task"):
            self.relay.handle_task(task("plan_app", catalog_id=token))
        self.assertEqual(list(self.relay.tasks_dir.glob("*.json")), [])
        self.assertEqual(self.bridge.calls, [])

    def test_corrupt_journal_blocks_start_instead_of_forgetting_old_submission(self):
        value = task("plan_app", catalog_id="nes-test")
        self.relay.handle_task(value)
        self.relay.close()
        self.relay._path(value["id"]).write_text('{"broken":true}')
        with self.assertRaisesRegex(relay.RelayError, "invalid_relay_state"):
            relay.Relay(self.root, self.site, self.bridge)

    def test_reported_journal_is_validated_again_on_every_poll(self):
        value = task("plan_app", catalog_id="nes-test")
        self.site.tasks = [value]
        self.relay.run_once()
        self.assertTrue(self.relay._load(value["id"])["reported"])
        self.bridge.calls.clear()
        self.relay._path(value["id"]).write_text('{"broken":true}')
        with self.assertRaisesRegex(relay.RelayError, "invalid_relay_state"):
            self.relay.run_once()
        self.assertFalse(self.bridge.calls)

    def test_load_reuses_verified_leaf_stat_without_following_it_again(self):
        value = task("plan_app", catalog_id="nes-test")
        self.relay.handle_task(value)
        path = self.relay._path(value["id"])
        calls = []
        def counted_lstat(candidate):
            calls.append(candidate)
            return os.lstat(candidate)
        with patch.object(Path, "lstat", autospec=True, side_effect=counted_lstat), \
                patch.object(Path, "exists", side_effect=AssertionError("extra existence stat")), \
                patch.object(Path, "stat", side_effect=AssertionError("follows path")):
            self.assertEqual(self.relay._load(value["id"])["task"], value)
        self.assertEqual(calls, [path, *path.parents])

    def test_oversized_journal_is_rejected_before_reading_contents(self):
        value = task("plan_app", catalog_id="nes-test")
        self.relay.handle_task(value)
        self.relay._path(value["id"]).write_bytes(b" " * (relay.MAX_JSON_BYTES + 1))
        with patch.object(Path, "read_bytes", side_effect=AssertionError("reads oversized state")), \
                self.assertRaisesRegex(relay.RelayError, "invalid_relay_state"):
            self.relay._load(value["id"])

    def test_another_process_cannot_own_same_state(self):
        script = ('import sys\nfrom pathlib import Path\nimport site_relay as r\n'
                  'try:\n x=r.Relay(Path(sys.argv[1]),None,None)\n'
                  'except r.RelayError as e:\n print(e.label)\n'
                  'else:\n x.close(); raise SystemExit("unexpected owner")\n')
        result = subprocess.run([sys.executable, "-c", script, str(self.root)],
            cwd=Path(__file__).parent, capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("relay_state_already_owned", result.stdout)


class HttpTransportTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.payload = b'{"ok":true,"data":{"device_io":false}}'
        self.code = 200
        self.content_type = "application/json"
        self.length_extra = 0
        owner = self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *_):
                pass
            def do_GET(self):
                owner.requests.append((self.path, dict(self.headers)))
                self.send_response(owner.code)
                self.send_header("Content-Type", owner.content_type)
                self.send_header("Content-Length", str(len(owner.payload) + owner.length_extra))
                if owner.code == 302:
                    self.send_header("Location", "/credential-sink")
                self.end_headers()
                self.wfile.write(owner.payload)
            def do_POST(self):
                self.rfile.read(int(self.headers.get("Content-Length", "0")))
                self.do_GET()
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.origin = "http://127.0.0.1:" + str(self.server.server_address[1])
        self.client = relay.JsonClient(self.origin, {"Authorization": "Bearer " + BRIDGE_TOKEN})

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(5)

    def test_authenticated_fixed_origin_json(self):
        self.assertFalse(self.client.request("GET", "/v1/status")["data"]["device_io"])
        self.assertEqual(self.requests[0][1]["Authorization"], "Bearer " + BRIDGE_TOKEN)
        self.assertNotIn("Oai-Sites-Authorization", self.requests[0][1])

    def test_bridge_catalog_json_above_site_limit_remains_readable(self):
        data = {"ok": True, "data": {"notes": ["safe text " * 48 for _ in range(160)]}}
        self.payload = relay.json_bytes(data)
        self.assertGreater(len(self.payload), 65_536)
        self.assertLess(len(self.payload), relay.MAX_JSON_BYTES)
        self.assertEqual(self.client.request("GET", "/v1/catalog"), data)

    def test_redirect_is_rejected_without_sending_auth_to_redirect_target(self):
        self.code = 302
        with self.assertRaisesRegex(relay.RelayError, "redirect_rejected"):
            self.client.request("GET", "/v1/status")
        self.assertEqual(len(self.requests), 1)

    def test_local_import_post_redirect_never_forwards_auth_or_launch_to_target(self):
        self.code = 302
        with self.assertRaisesRegex(relay.RelayError, "redirect_rejected"):
            self.client.request("POST", "/v1/library/open", {"id": "a" * 32})
        self.assertEqual(len(self.requests), 1)
        self.assertEqual(self.requests[0][0], "/v1/library/open")

    def test_response_bounds_type_duplicate_keys_and_nonfinite_numbers(self):
        for payload, content_type in ((b"x" * (relay.MAX_JSON_BYTES + 1), "application/json"),
                                     (b'{}', "application/octet-stream"),
                                     (b'{"ok":true,"ok":false}', "application/json"),
                                     (b'{"x":NaN}', "application/json")):
            self.payload, self.content_type = payload, content_type
            with self.assertRaises(relay.RelayError):
                self.client.request("GET", "/v1/status")

    def test_route_cannot_change_origin_or_add_private_download(self):
        for route in ("//evil.example", "https://evil.example", "/v1/status?token=secret", "/a\\b"):
            with self.assertRaises(relay.RelayError):
                self.client.request("GET", route)
        self.assertEqual(self.requests, [])

    def test_lost_http_body_produces_fixed_network_error(self):
        self.length_extra = 20
        with self.assertRaisesRegex(relay.RelayError, "network_unavailable"):
            self.client.request("GET", "/v1/status")

    def test_main_uses_separate_site_credentials_and_logs_only_fixed_errors(self):
        clients = []
        def factory(origin, headers):
            clients.append((origin, headers))
            return FakeSite() if origin == "https://fm1.example" else FakeBridge()
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                "FM1_RELAY_TOKEN": RELAY_TOKEN, "FM1_SITES_SERVICE_TOKEN": SITES_TOKEN,
                "FM1_BRIDGE_TOKEN": BRIDGE_TOKEN}), patch.object(relay, "JsonClient", factory):
            self.assertEqual(relay.main(["--site-url", "https://fm1.example", "--state-dir", folder, "--once"]), 0)
        self.assertEqual(clients, [("https://fm1.example", {"Authorization": "Bearer " + RELAY_TOKEN,
                "OAI-Sites-Authorization": "Bearer " + SITES_TOKEN}),
                ("http://127.0.0.1:9770", {"Authorization": "Bearer " + BRIDGE_TOKEN})])
        output = io.StringIO()
        with patch.object(relay, "load_token", side_effect=relay.RelayError("credential_unavailable")), patch("sys.stderr", output):
            self.assertEqual(relay.main(["--site-url", "https://fm1.example", "--state-dir", "unused"]), 1)
        self.assertEqual(output.getvalue(), "FM1 relay: credential_unavailable\n")

    def test_main_official_update_flag_enables_only_its_heartbeat_capability(self):
        site, bridge = FakeSite(), FakeBridge()
        def factory(origin, headers):
            return site if origin == "https://fm1.example" else bridge
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {
                "FM1_RELAY_TOKEN": RELAY_TOKEN, "FM1_SITES_SERVICE_TOKEN": SITES_TOKEN,
                "FM1_BRIDGE_TOKEN": BRIDGE_TOKEN}), patch.object(relay, "JsonClient", factory):
            self.assertEqual(relay.main(["--site-url", "https://fm1.example", "--state-dir", folder,
                "--allow-official-update", "--once"]), 0)
        self.assertEqual(site.calls[0], ("POST", "/relay/heartbeat", {
            "allow_switch": False, "allow_official_update": True}))
        self.assertEqual(bridge.calls, [])


if __name__ == "__main__":
    unittest.main()
