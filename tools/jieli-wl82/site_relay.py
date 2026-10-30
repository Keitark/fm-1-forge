"""Outbound, metadata-only relay from a private Site to the existing FM1 bridge.

This module has no device imports and never starts or configures the bridge.
Each task is committed locally before a bridge request. An interrupted job
submission is inspected by its original ID; it is never submitted again.
"""
from __future__ import annotations

import argparse
import ipaddress
from http.client import HTTPException
import json
import math
import os
from pathlib import Path
import re
import stat
import sys
import time
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener
import uuid

MAX_JSON_BYTES = 262_144
LEGACY_METADATA_BYTES = 65_536
# Leave room for the relay result and durable journal envelopes beneath the
# Site's 60,000-character clean-result and 64-KiB request limits. json_bytes
# uses ASCII escapes, so this UTF-8 byte bound also covers multibyte metadata.
MAX_METADATA_BYTES = 58_000
ID = re.compile(r"[0-9a-f]{32}\Z")
SHA = re.compile(r"[0-9a-f]{64}\Z")
SLUG = re.compile(r"[a-z0-9][a-z0-9_-]{0,63}\Z")
OPERATIONS = frozenset({"status", "input_snapshot", "catalog", "plan_app", "job", "switch_app", "official_updater", "stock_sysex_update", "open_local_import"})
JOB_OPERATIONS = frozenset({"plan_app", "switch_app", "official_updater", "stock_sysex_update"})
JOB_STATUSES = frozenset({"queued", "running", "succeeded", "failed", "unknown"})
SENSITIVE_KEY = re.compile(
    r"(^|_)(image|firmware|token|secret|credential|password|payload|request|raw|"
    r"path|filename|file|transcript|log|binary|bytes|session_root)(_|$)", re.I)
PRIVATE_PATH = re.compile(r"(?:[a-z]:[\\/]|\\\\|(?:^|\s)/(?:[^\s/]+/)+)", re.I)
BASE64_PAYLOAD = re.compile(r"[A-Za-z0-9+/]{80,}={0,2}\Z")
SAFE_SESSION_KEYS = frozenset({
    "operation", "blocked", "reset_pending", "needs_observation", "failed_operation",
    "error", "baseline_sha256", "loader_running", "stopped", "remote_read_supported",
})
PHYSICAL_IDENTIFIER_KEYS = frozenset({
    "serialnumber", "serialno", "deviceserialnumber", "usbserialnumber",
    "pnpdeviceid", "pnpid", "deviceinstanceid", "hardwareid", "hardwareids",
    "physicaldeviceid", "deviceuniqueid", "deviceuuid",
})
DROP = object()


class RelayError(Exception):
    """Only fixed labels may escape to callers or logs."""

    def __init__(self, label: str, status: int | None = None):
        super().__init__(label)
        self.label = label
        self.status = status


def json_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"),
                      ensure_ascii=True, allow_nan=False).encode("utf-8")


def _object(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("duplicate key")
        result[key] = value
    return result


def _constant(value: str) -> None:
    raise ValueError("nonfinite number")


def parse_json(raw: bytes) -> Any:
    if len(raw) > MAX_JSON_BYTES:
        raise RelayError("response_too_large")
    try:
        return json.loads(raw.decode("utf-8"), object_pairs_hook=_object,
                          parse_constant=_constant)
    except (ValueError, UnicodeError, RecursionError):
        raise RelayError("invalid_json") from None


def validate_token(token: Any) -> str:
    if (not isinstance(token, str) or not 32 <= len(token) <= 4096 or
            any(ord(char) < 33 or ord(char) > 126 for char in token)):
        raise RelayError("invalid_credential")
    return token


def _no_symlinks(path: Path) -> os.stat_result | None:
    # Windows junctions/reparse points are also rejected when Python exposes
    # FILE_ATTRIBUTE_REPARSE_POINT through lstat(). Inspect each path component
    # on every call, reusing only this call's verified leaf metadata.
    leaf_info = None
    for candidate in (path, *path.parents):
        try:
            info = candidate.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise RelayError("unsafe_private_path")
        if candidate == path:
            leaf_info = info
    return leaf_info


def load_token(env_name: str, token_file: Path | None) -> str:
    if token_file is None:
        return validate_token(os.environ.get(env_name))
    _no_symlinks(token_file.absolute())
    try:
        if token_file.stat().st_size > 4096:
            raise RelayError("invalid_credential")
        if os.name != "nt" and token_file.stat().st_mode & 0o077:
            raise RelayError("credential_file_not_private")
        return validate_token(token_file.read_text(encoding="utf-8-sig").strip())
    except (OSError, UnicodeError):
        raise RelayError("credential_unavailable") from None


def normalize_origin(value: Any, *, site: bool) -> str:
    if (not isinstance(value, str) or any(ord(char) <= 32 or ord(char) >= 127
                                          for char in value) or "\\" in value):
        raise RelayError("invalid_origin")
    try:
        parts = urlsplit(value)
        host, port = parts.hostname, parts.port
    except ValueError:
        raise RelayError("invalid_origin") from None
    if (not host or parts.username is not None or parts.password is not None or
            parts.path not in ("", "/") or parts.query or parts.fragment or
            parts.scheme not in {"http", "https"} or (port is not None and port == 0)):
        raise RelayError("invalid_origin")
    if site and parts.scheme != "https":
        raise RelayError("site_requires_https")
    if parts.scheme == "http":
        try:
            loopback = ipaddress.ip_address(host).is_loopback
        except ValueError:
            loopback = False
        if not loopback:
            raise RelayError("bridge_http_requires_loopback")
    elif not site and not host.endswith(".ts.net"):
        # A remote bridge must be explicitly pinned to its HTTPS tailnet origin.
        raise RelayError("bridge_https_requires_tailnet")
    netloc = "[" + host + "]" if ":" in host else host
    if port is not None and port != (443 if parts.scheme == "https" else 80):
        netloc += ":" + str(port)
    return parts.scheme + "://" + netloc


def normalize_task(value: Any) -> dict[str, Any]:
    if (type(value) is not dict or set(value) != {"id", "operation", "arguments"}
            or not isinstance(value["id"], str) or not ID.fullmatch(value["id"])
            or not isinstance(value["operation"], str) or value["operation"] not in OPERATIONS
            or type(value["arguments"]) is not dict):
        raise RelayError("invalid_task")
    operation, args = value["operation"], value["arguments"]
    expected = ({"catalog_id"} if operation == "plan_app" else
                {"catalog_id", "entry_method", "expected_sha256", "approval_expires"}
                if operation == "switch_app" else
                {"expected_sha256", "approval_expires"} if operation == "official_updater" else
                {'expected_sha256', 'expected_stock_pair', 'endpoint_review_id', 'approval_expires'} if operation == 'stock_sysex_update' else
                {"job_id"} if operation == "job" else set())
    if set(args) != expected:
        raise RelayError("invalid_task")
    if "catalog_id" in args and (not isinstance(args["catalog_id"], str) or
                                  not SLUG.fullmatch(args["catalog_id"])):
        raise RelayError("invalid_task")
    if "job_id" in args and (not isinstance(args["job_id"], str) or
                              not ID.fullmatch(args["job_id"])):
        raise RelayError("invalid_task")
    if "entry_method" in args and args["entry_method"] not in ("serial", "already_uboot", "auto"):
        raise RelayError("invalid_task")
    if "expected_sha256" in args and (not isinstance(args["expected_sha256"], str)
                                      or not SHA.fullmatch(args["expected_sha256"])):
        raise RelayError("invalid_task")
    if "approval_expires" in args and (type(args["approval_expires"]) is not int
                                       or not 0 < args["approval_expires"] < 2 ** 53):
        raise RelayError("invalid_task")
    if operation == 'stock_sysex_update':
        from update_mode import validate_stock_pair
        try:
            validate_stock_pair(args['expected_stock_pair'])
        except ValueError:
            raise RelayError('invalid_task') from None
        if args['endpoint_review_id'] != value['id']:
            raise RelayError('invalid_task')
    return {"id": value["id"], "operation": operation, "arguments": dict(args)}


def metadata_only(value: Any, secrets: tuple[str, ...] = (), depth: int = 0,
                  *, max_bytes: int = MAX_METADATA_BYTES) -> Any:
    """Discard private payload fields, paths, binary material and credentials."""
    if depth > 16:
        return DROP
    if type(value) is dict:
        result = {}
        for key, item in list(value.items())[:1024]:
            if (not isinstance(key, str) or len(key) > 80 or
                    any(secret in key for secret in secrets)):
                continue
            compact = re.sub(r"[^a-z0-9]", "", key.lower())
            if key == 'firmware' and item in ('FM1-FORGE/1', 'MOD-EDITOR/1', None):
                # A normalized protocol identity is descriptive metadata. All
                # other firmware/payload fields retain the existing scrubber.
                result[key] = item
                continue
            # Inventory can contain a unit's persistent physical identity even
            # when the value is plain text rather than a detectable local path.
            # Match whole normalized field names so port/model/readiness data
            # remains available, including containers such as serial_ports.
            if compact in PHYSICAL_IDENTIFIER_KEYS:
                continue
            sensitive = SENSITIVE_KEY.search(key) or any(
                marker in compact for marker in ("image", "firmware", "token", "secret", "credential", "password", "payload"))
            if sensitive and not key.endswith("_sha256"):
                continue
            if (key == "sha256" or key.endswith("_sha256")) and (
                    not isinstance(item, str) or not SHA.fullmatch(item)):
                continue
            if "session" in key.lower() and key != "session_configured":
                if key != "session" or type(item) is not dict:
                    continue
                item = {name: field for name, field in item.items() if name in SAFE_SESSION_KEYS}
            safe = metadata_only(item, secrets, depth + 1)
            if safe is not DROP:
                result[key] = safe
        if depth == 0 and len(json_bytes(result)) > max_bytes:
            # Always retain authoritative identity/outcome even when unusual
            # metadata would otherwise prevent committing the durable result.
            compact = {"metadata_truncated": True}
            for key in ("id", "status", "operation", "error", "progress"):
                if key in result and len(json_bytes(result[key])) <= 4096:
                    compact[key] = result[key]
            if type(result.get("engine")) is dict:
                compact["engine"] = {key: field for key, field in result["engine"].items()
                                     if key in {"active", "blocked_unknown", "updater_handoff", "stock_baseline_invalidated", "storage_fault", "jobs"}
                                     and len(json_bytes(field)) <= 4096}
            return compact
        return result
    if type(value) is list:
        return [safe for item in value[:1024]
                if (safe := metadata_only(item, secrets, depth + 1)) is not DROP]
    if value is None or type(value) is bool or type(value) is int:
        return value
    if type(value) is float:
        return value if math.isfinite(value) else DROP
    if type(value) is str:
        if (len(value) > 500 or any(secret in value for secret in secrets) or
                PRIVATE_PATH.search(value) or BASE64_PAYLOAD.fullmatch(value) or
                re.search(r"\.(?:bin|rom|nes|wad|mdx|pdx)(?:\s|$)", value, re.I)):
            return DROP
        return value
    return DROP


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RelayError("redirect_rejected")


class JsonClient:
    def __init__(self, origin: str, headers: dict[str, str], timeout: float = 20):
        self.origin = origin
        self.headers = dict(headers)
        self.timeout = timeout
        # No environment proxies: credentials are sent only to the pinned origin.
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method: str, route: str, body: Any = None) -> Any:
        if not route.startswith("/") or route.startswith("//") or any(char in route for char in "?#\\"):
            raise RelayError("invalid_route")
        headers = {"Accept": "application/json", **self.headers}
        raw = None if body is None else json_bytes(body)
        if raw is not None:
            if len(raw) > MAX_JSON_BYTES:
                raise RelayError("request_too_large")
            headers["Content-Type"] = "application/json"
        request = Request(self.origin + route, data=raw, headers=headers, method=method)
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                if response.geturl() != self.origin + route:
                    raise RelayError("redirect_rejected")
                if response.status not in (200, 201, 202):
                    raise RelayError("http_rejected", response.status)
                if response.headers.get_content_type() != "application/json":
                    raise RelayError("invalid_response_type")
                length = response.headers.get("Content-Length")
                size = None
                if length is not None:
                    try:
                        size = int(length)
                    except ValueError:
                        raise RelayError("invalid_response_length") from None
                    if not 0 <= size <= MAX_JSON_BYTES:
                        raise RelayError("response_too_large")
                payload = response.read(MAX_JSON_BYTES + 1)
                if size is not None and len(payload) != size:
                    raise RelayError("network_unavailable")
                return parse_json(payload)
        except HTTPError as error:
            # The response body and exception text may contain secrets.
            raise RelayError("http_rejected", error.code) from None
        except (URLError, OSError, TimeoutError, HTTPException):
            raise RelayError("network_unavailable") from None


class StateLock:
    def __init__(self, path: Path):
        self.stream = path.open("a+b")
        self.locked = False
        try:
            self.stream.seek(0, os.SEEK_END)
            if not self.stream.tell():
                self.stream.write(b"\0")
                self.stream.flush()
            self.stream.seek(0)
            if os.name == "nt":
                import msvcrt
                msvcrt.locking(self.stream.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl
                fcntl.flock(self.stream.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            self.locked = True
        except OSError:
            self.close()
            raise RelayError("relay_state_already_owned") from None

    def close(self):
        if self.stream.closed:
            return
        try:
            if self.locked:
                self.stream.seek(0)
                if os.name == "nt":
                    import msvcrt
                    msvcrt.locking(self.stream.fileno(), msvcrt.LK_UNLCK, 1)
                else:
                    import fcntl
                    fcntl.flock(self.stream.fileno(), fcntl.LOCK_UN)
        finally:
            self.stream.close()


def atomic_json(path: Path, value: Any) -> None:
    raw = json_bytes(value)
    if len(raw) > MAX_JSON_BYTES:
        raise RelayError("state_too_large")
    temporary = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    try:
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        temporary.unlink(missing_ok=True)


class Relay:
    def __init__(self, state_dir: Path, site: Any, bridge: Any,
                 *, allow_switch: bool = False, allow_official_update: bool = False, allow_stock_update: bool = False,
                 secrets: tuple[str, ...] = ()):
        state_dir = Path(state_dir).absolute()
        _no_symlinks(state_dir)
        if state_dir == state_dir.anchor or state_dir == Path(state_dir.anchor):
            raise RelayError("unsafe_private_path")
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        _no_symlinks(state_dir / "relay.lock")
        self.lock = StateLock(state_dir / "relay.lock")
        self.site, self.bridge = site, bridge
        self.allow_switch, self.secrets = bool(allow_switch), secrets
        self.allow_official_update = bool(allow_official_update)
        self.allow_stock_update = bool(allow_stock_update)
        self.tasks_dir = state_dir / "tasks"
        try:
            _no_symlinks(self.tasks_dir)
            self.tasks_dir.mkdir(mode=0o700, exist_ok=True)
            # Check stored records before accepting work. Corrupt state must not
            # silently reset deduplication or permit a second physical operation.
            for path in self.tasks_dir.iterdir():
                if path.suffix == ".tmp":
                    continue
                if not path.is_file() or not ID.fullmatch(path.stem) or path.suffix != ".json":
                    raise RelayError("invalid_relay_state")
                self._load(path.stem)
        except BaseException:
            self.lock.close()
            raise

    def close(self):
        self.lock.close()

    def _path(self, identifier: str) -> Path:
        return self.tasks_dir / (identifier + ".json")

    def _load(self, identifier: str) -> dict[str, Any] | None:
        path = self._path(identifier)
        info = _no_symlinks(path)
        if info is None:
            return None
        try:
            if info.st_size > MAX_JSON_BYTES:
                raise RelayError("invalid_relay_state")
            record = parse_json(path.read_bytes())
            if (type(record) is not dict or set(record) != {"version", "task", "phase", "result", "reported"}
                    or type(record["version"]) is not int or record["version"] != 1
                    or normalize_task(record["task"])["id"] != identifier
                    or record["phase"] not in {"prepared", "executing", "completed"}
                    or type(record["reported"]) is not bool):
                raise RelayError("invalid_relay_state")
            result = record["result"]
            if record["phase"] == "completed":
                if (type(result) is not dict or result.get("id") != identifier
                        or result.get("status") not in {"succeeded", "failed", "unknown"}
                        or not set(result) <= {"id", "status", "data", "error"}):
                    raise RelayError("invalid_relay_state")
            elif result is not None or record["reported"]:
                raise RelayError("invalid_relay_state")
            return record
        except (OSError, ValueError, TypeError, KeyError, RelayError):
            raise RelayError("invalid_relay_state") from None

    def _bridge_data(self, method: str, route: str, body: Any = None,
                     *, job_id: str | None = None) -> Any:
        envelope = self.bridge.request(method, route, body)
        if (type(envelope) is not dict or envelope.get("ok") is not True
                or "data" not in envelope or type(envelope["data"]) is not dict):
            raise RelayError("invalid_bridge_response")
        data = envelope["data"]
        if job_id is not None and (data.get("id") != job_id or not isinstance(data.get("status"), str)
                                   or data["status"] not in JOB_STATUSES):
            raise RelayError("invalid_bridge_response")
        return metadata_only(data, self.secrets)

    def _local_import_receipt(self, method: str, identifier: str) -> dict[str, Any]:
        route = "/v1/library/open" + ("/" + identifier if method == "GET" else "")
        data = self._bridge_data(method, route, {"id": identifier} if method == "POST" else None)
        # A browser launch receipt cannot grant another operation or expose the
        # local URL. Keep its contract separate from bridge firmware job status.
        if (data.get("id") != identifier or type(data.get("opened")) is not bool
                or data.get("device_io") is not False
                or type(data.get("expires_in")) is not int
                or not 0 <= data["expires_in"] <= 300
                or ("error" in data and (not isinstance(data["error"], str)
                    or not re.fullmatch(r"[a-z_]{1,80}", data["error"])))):
            raise RelayError("invalid_bridge_response")
        return {key: data[key] for key in ("id", "opened", "device_io", "expires_in", "error") if key in data}

    def _execute(self, task: dict[str, Any], *, resumed: bool) -> dict[str, Any]:
        identifier, operation, args = task["id"], task["operation"], task["arguments"]
        result = {"id": identifier, "status": "succeeded"}
        if operation == "switch_app" and not resumed and not self.allow_switch:
            return {"id": identifier, "status": "failed", "error": "switch_disabled"}
        if operation == "official_updater" and not resumed and not self.allow_official_update:
            return {"id": identifier, "status": "failed", "error": "official_update_disabled"}
        if operation == 'stock_sysex_update' and not resumed and not self.allow_stock_update:
            return {'id': identifier, 'status': 'failed', 'error': 'stock_update_disabled'}
        try:
            if operation == "open_local_import":
                if resumed:
                    try:
                        result["data"] = self._local_import_receipt("GET", identifier)
                    except RelayError:
                        return {"id": identifier, "status": "unknown", "error": "local_import_outcome_unknown"}
                else:
                    try:
                        result["data"] = self._local_import_receipt("POST", identifier)
                    except RelayError as error:
                        if error.status is not None and error.status not in {301, 302, 303, 307, 308}:
                            return {"id": identifier, "status": "failed", "error": "bridge_request_rejected"}
                        # A timeout, redirect or malformed reply never justifies
                        # opening another window. Inspect the first launch ID.
                        try:
                            result["data"] = self._local_import_receipt("GET", identifier)
                        except RelayError:
                            return {"id": identifier, "status": "unknown", "error": "local_import_outcome_unknown"}
                if result["data"]["opened"] is not True or "error" in result["data"]:
                    result["status"] = "unknown" if result["data"].get("error") == "local_import_launch_unknown" else "failed"
                return result
            if operation in JOB_OPERATIONS:
                # Once executing is committed, even a crash immediately before
                # POST must be treated as ambiguous. Resume uses GET exclusively.
                if resumed:
                    try:
                        result["data"] = self._bridge_data("GET", "/v1/jobs/" + identifier, job_id=identifier)
                    except RelayError:
                        return {"id": identifier, "status": "unknown", "error": "bridge_outcome_unknown"}
                else:
                    if operation in {"switch_app", "official_updater", "stock_sysex_update"} and time.time() >= args["approval_expires"]:
                        return {"id": identifier, "status": "failed", "error": "approval_expired"}
                    if operation == "switch_app":
                        catalog = self._bridge_data("GET", "/v1/catalog")
                        apps = catalog.get("apps")
                        if type(apps) is not list:
                            return {"id": identifier, "status": "failed", "error": "catalog_metadata_unavailable"}
                        matches = [variant for app in apps if type(app) is dict
                                   and type(app.get("variants")) is list
                                   for variant in app["variants"] if type(variant) is dict
                                   and variant.get("id") == args["catalog_id"]]
                        if len(matches) != 1 or matches[0].get("sha256") != args["expected_sha256"]:
                            return {"id": identifier, "status": "failed", "error": "catalog_digest_mismatch"}
                        if matches[0].get("ready") is not True:
                            return {"id": identifier, "status": "failed", "error": "catalog_not_ready"}
                    body = {"id": identifier, "operation": operation}
                    if operation in {"official_updater", "stock_sysex_update"}:
                        body["expected_sha256"] = args["expected_sha256"]
                    else:
                        body["catalog_id"] = args["catalog_id"]
                    if operation == "switch_app":
                        body["entry_method"] = args["entry_method"]
                    if operation == 'stock_sysex_update':
                        for key in ('expected_stock_pair', 'endpoint_review_id', 'approval_expires'):
                            body[key] = args[key]
                    if operation in {"switch_app", "official_updater", "stock_sysex_update"}:
                        if time.time() >= args["approval_expires"]:
                            return {"id": identifier, "status": "failed", "error": "approval_expired"}
                    try:
                        result["data"] = self._bridge_data("POST", "/v1/jobs", body, job_id=identifier)
                    except RelayError as error:
                        if error.status is not None and error.status not in {301, 302, 303, 307, 308}:
                            return {"id": identifier, "status": "failed", "error": "bridge_request_rejected"}
                        # A lost reply cannot justify retrying the submission.
                        try:
                            result["data"] = self._bridge_data("GET", "/v1/jobs/" + identifier, job_id=identifier)
                        except RelayError:
                            return {"id": identifier, "status": "unknown", "error": "bridge_outcome_unknown"}
            else:
                route = "/v1/jobs/" + args["job_id"] if operation == "job" else "/v1/" + operation
                result["data"] = self._bridge_data("GET", route,
                    job_id=args["job_id"] if operation == "job" else None)
            return result
        except RelayError as error:
            return {"id": identifier, "status": "failed", "error": (
                "bridge_request_rejected" if error.status is not None else "bridge_metadata_unavailable")}

    def _prepare(self, value: Any) -> dict[str, Any]:
        task = normalize_task(value)
        if any(secret in field for field in (task["id"], *task["arguments"].values())
               if isinstance(field, str) for secret in self.secrets):
            raise RelayError("invalid_task")
        record = self._load(task["id"])
        if record is not None and record["task"] != task:
            raise RelayError("task_id_conflict")
        if record is None:
            record = {"version": 1, "task": task, "phase": "prepared", "result": None, "reported": False}
            atomic_json(self._path(task["id"]), record)
        return record

    def handle_task(self, value: Any) -> dict[str, Any]:
        record = self._prepare(value)
        task = record["task"]
        if record["phase"] == "completed":
            # Also sanitize cached state so credentials newly configured on a
            # later invocation cannot escape through an older metadata string.
            # Keep the previous size budget until the Site explicitly rejects
            # it. An older result may already have been saved before an ACK
            # was lost; that result must replay identically after an upgrade.
            cached = dict(record["result"])
            if "data" in cached:
                cached["data"] = metadata_only(cached["data"], self.secrets,
                                               max_bytes=LEGACY_METADATA_BYTES)
            return cached
        resumed = record["phase"] == "executing"
        record["phase"] = "executing"
        atomic_json(self._path(task["id"]), record)
        record["result"] = self._execute(task, resumed=resumed)
        record["phase"] = "completed"
        atomic_json(self._path(task["id"]), record)
        return record["result"]

    def report(self, result: dict[str, Any]) -> None:
        try:
            acknowledgment = self.site.request("POST", "/relay/result", result)
        except RelayError as error:
            # These two failures prove the result was not accepted. Timeout,
            # malformed ACK and immutable-result conflicts remain ambiguous
            # and must never cause us to change the cached receipt.
            if not ((error.label == "http_rejected" and error.status == 413)
                    or (error.label == "request_too_large" and error.status is None)):
                raise
            smaller = dict(result)
            if "data" in smaller:
                smaller["data"] = metadata_only(smaller["data"], self.secrets)
            if smaller == result:
                raise
            record = self._load(result["id"])
            record["result"] = smaller
            record["reported"] = False
            # Commit the exact replacement before any retry so a lost second
            # ACK resumes the same receipt without another bridge submission.
            atomic_json(self._path(result["id"]), record)
            result = smaller
            acknowledgment = self.site.request("POST", "/relay/result", result)
        if type(acknowledgment) is not dict or acknowledgment != {"saved": True}:
            raise RelayError("invalid_result_acknowledgment")
        record = self._load(result["id"])
        record["reported"] = True
        atomic_json(self._path(result["id"]), record)

    def run_once(self) -> int:
        self.site.request("POST", "/relay/heartbeat", {"allow_switch": self.allow_switch,
            "allow_official_update": self.allow_official_update,
            **({'allow_stock_update': True} if self.allow_stock_update else {})})
        # Recover before asking for more work, including a lost Site result ack.
        for path in sorted(self.tasks_dir.glob("*.json")):
            record = self._load(path.stem)
            if not record["reported"]:
                self.report(self.handle_task(record["task"]))
        poll = self.site.request("POST", "/relay/poll", {})
        if (type(poll) is not dict or set(poll) != {"tasks", "connected"}
                or poll["connected"] is not True or type(poll["tasks"]) is not list
                or len(poll["tasks"]) > 32):
            raise RelayError("invalid_poll_response")
        tasks = [normalize_task(task) for task in poll["tasks"]]
        if len({task["id"] for task in tasks}) != len(tasks):
            raise RelayError("duplicate_poll_task")
        for task in tasks:
            self._prepare(task)
        for task in tasks:
            self.report(self.handle_task(task))
        return len(tasks)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site-url", required=True)
    parser.add_argument("--bridge-url", default="http://127.0.0.1:9770")
    parser.add_argument("--state-dir", type=Path, required=True)
    parser.add_argument("--relay-token-file", type=Path)
    parser.add_argument("--sites-token-file", type=Path)
    parser.add_argument("--bridge-token-file", type=Path)
    parser.add_argument("--allow-switch", action="store_true")
    parser.add_argument("--allow-official-update", action="store_true")
    parser.add_argument('--allow-stock-update', action='store_true')
    parser.add_argument("--poll-seconds", type=float, default=3)
    parser.add_argument("--once", action="store_true", help="Run one poll cycle, then exit")
    args = parser.parse_args(argv)
    relay = None
    try:
        site_origin = normalize_origin(args.site_url, site=True)
        bridge_origin = normalize_origin(args.bridge_url, site=False)
        if not 1 <= args.poll_seconds <= 60:
            raise RelayError("invalid_poll_interval")
        relay_token = load_token("FM1_RELAY_TOKEN", args.relay_token_file)
        sites_token = load_token("FM1_SITES_SERVICE_TOKEN", args.sites_token_file)
        bridge_token = load_token("FM1_BRIDGE_TOKEN", args.bridge_token_file)
        site = JsonClient(site_origin, {"Authorization": "Bearer " + relay_token,
            "OAI-Sites-Authorization": "Bearer " + sites_token})
        bridge = JsonClient(bridge_origin, {"Authorization": "Bearer " + bridge_token})
        relay = Relay(args.state_dir, site, bridge, allow_switch=args.allow_switch,
                      allow_official_update=args.allow_official_update,
                      allow_stock_update=args.allow_stock_update,
                      secrets=(relay_token, sites_token, bridge_token))
        while True:
            try:
                relay.run_once()
            except RelayError as error:
                # Only fixed labels; never print URL, token, task, result, body,
                # private path, HTTP exception or backend exception text.
                print("FM1 relay: " + error.label, file=sys.stderr, flush=True)
                if args.once or error.label in {"invalid_relay_state", "task_id_conflict"}:
                    return 1
            if args.once:
                return 0
            time.sleep(args.poll_seconds)
    except RelayError as error:
        print("FM1 relay: " + error.label, file=sys.stderr)
        return 1
    except KeyboardInterrupt:
        return 0
    except Exception:
        print("FM1 relay: local_relay_failure", file=sys.stderr)
        return 1
    finally:
        if relay is not None:
            relay.close()


if __name__ == "__main__":
    raise SystemExit(main())
