"""Laptop-local adapter. Network callers never choose a command or local path."""
import base64
import hashlib
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import time

from remote_catalog import Catalog, rebase
from job_progress import progress_for_job
from update_mode import classify_update_mode, enumerate_midi_endpoints
from input_telemetry import sample as sample_inputs

SIZE = 0x100000
PS = r'C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
OPERATIONS = {'plan', 'flash', 'retry_flash', 'recover_flash', 'reset', 'observe',
              'enter_uboot', 'read_firmware', 'serial_status', 'environment',
              'switch_app', 'plan_app', 'official_updater'}
IMAGE_OPERATIONS = {'plan', 'flash', 'retry_flash', 'recover_flash'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def private_file(root, relative):
    if not isinstance(relative, str) or Path(relative).is_absolute():
        raise ValueError('Artifact must have a session-relative path')
    path = (root / relative).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError('Artifact outside selected session')
    return path


def verified_bytes(path, expected):
    if not re.fullmatch('[0-9a-f]{64}', expected or ''):
        raise ValueError('Invalid artifact SHA256')
    if path.stat().st_size != SIZE:
        raise ValueError('Firmware must be exactly 1 MiB')
    data = path.read_bytes()
    if len(data) != SIZE or digest(data) != expected:
        raise ValueError('Artifact size or SHA256 mismatch')
    return data


class WindowsBackend:
    def __init__(self, repo, session=None, catalog_dir=None,
                 official_updater=None, official_updater_sha256=None):
        self.repo = Path(repo).resolve()
        self.session = Path(session).resolve() if session else None
        self.client = self.repo / 'tools/jieli-wl82/flash-session-client.ps1'
        self.packages = Catalog(catalog_dir or self.repo / 'tmp/remote-debug/catalog')
        self.updater = Path(official_updater).resolve() if official_updater else None
        self.updater_sha256 = official_updater_sha256
        if not self.client.is_file():
            raise ValueError('FM-1 checkout missing flash-session-client.ps1')
        if self.session:
            config = read_json(self.session / 'session.json')
            if Path(config['root']).resolve() != self.session:
                raise ValueError('Protected session descriptor belongs to another directory')
            read_json(self.session / 'state.json')

    def _input_readiness(self):
        """Persisted state only; reject unknown or reserved device ownership."""
        if not self.session:
            return 'unavailable'
        try:
            state = read_json(self.session / 'state.json')
            if (type(state) is not dict or state.get('operation') != 'idle'
                    or any(state.get(key) is not False for key in
                           ('blocked', 'reset_pending', 'needs_observation', 'loader_running'))
                    or state.get('stopped', False) is not False
                    or (self.session / 'stopped.txt').exists()):
                return 'busy'
        except (OSError, ValueError, TypeError):
            return 'busy'
        return 'ready'

    def input_snapshot(self):
        """Sample fixed read-only input queries while the bridge mutex is held."""
        return sample_inputs(preflight=self._input_readiness)

    def status(self):
        """PnP enumeration and persisted state; no USB/serial handles are opened."""
        started_at = int(time.time())
        serial_ports = []
        inventory_error = None
        try:
            from serial.tools import list_ports
            serial_ports = [dict(port=p.device, vid=p.vid, pid=p.pid,
                                 description=p.description, serial_number=p.serial_number)
                            for p in list_ports.comports()
                            if (p.vid, p.pid) == (0x3654, 0x5155)]
        except (ImportError, OSError):
            inventory_error = 'Serial port enumeration unavailable; check laptop requirements'
        disks = []
        if sys.platform == 'win32':
            script = ("@(Get-CimInstance Win32_DiskDrive | Where-Object "
                      "{$_.Model -eq 'WL82 UBOOT1.00 USB Device'} | "
                      "Select-Object DeviceID,PNPDeviceID,Model) | ConvertTo-Json -Compress")
            try:
                proc = subprocess.run([PS, '-NoProfile', '-NonInteractive', '-Command', script],
                                      capture_output=True, encoding='utf-8', errors='replace',
                                      check=True, timeout=15)
                disks = json.loads(proc.stdout) if proc.stdout.strip() else []
                if isinstance(disks, dict):
                    disks = [disks]
            except (OSError, subprocess.SubprocessError, ValueError):
                inventory_error = 'Windows disk enumeration failed'
        info = dict(platform=sys.platform, serial_ports=serial_ports, uboot_disks=disks,
                    inventory_error=inventory_error, device_io=False,
                    session_configured=bool(self.session))
        info['official_updater_configured'] = bool(self.updater and self.updater_sha256)
        midi = enumerate_midi_endpoints()
        info['midi_endpoints'] = [endpoint for endpoint in midi['endpoints']
                                  if 'fm-1' in endpoint['name'].lower() or 'fm1' in endpoint['name'].lower()]
        info['inventory_error'] = inventory_error or midi['error']
        info['update_mode'] = classify_update_mode(serial_ports, disks, midi['endpoints'], info['inventory_error'])
        info['official_update'] = self.official_update_metadata(info['update_mode'])
        if self.session:
            state = read_json(self.session / 'state.json')
            info['session'] = {key: state.get(key) for key in
                               ('operation', 'blocked', 'reset_pending', 'needs_observation',
                                'failed_operation', 'error', 'baseline_sha256', 'target')}
            info['session']['loader_running'] = state.get('loader_running', False)
            info['session']['stopped'] = (self.session / 'stopped.txt').exists()
            snapshot_worker = self.session / 'tools/jieli-wl82/flash_session_worker.py'
            info['session']['remote_read_supported'] = (
                snapshot_worker.exists() and 'read_firmware' in snapshot_worker.read_text(encoding='utf-8'))
            if (info['session']['operation'] != 'idle' or info['session']['blocked'] or info['session']['reset_pending']
                    or info['session']['needs_observation'] or info['session']['loader_running'] or info['session']['stopped']):
                info['official_update']['available'] = False
        info['observation'] = {'started_at': started_at, 'completed_at': int(time.time())}
        return info

    def official_update_metadata(self, mode):
        configured = bool(self.updater and isinstance(self.updater_sha256, str)
                          and re.fullmatch('[0-9a-f]{64}', self.updater_sha256))
        verified = False
        if configured and sys.platform == 'win32' and self.updater.name.lower() in ('m-upgrade-fm1.exe', 'm-upgrade.exe'):
            try:
                verified = self.updater.is_file() and digest(self.updater.read_bytes()) == self.updater_sha256
            except OSError:
                pass
        return {'configured': configured, 'sha256': self.updater_sha256 if configured else None,
                'available': bool(verified and mode.get('official_available')),
                'package_format': '.fwsc', 'handoff': True}

    def job_progress(self, job, request):
        """Persisted metadata only; never enumerate/open USB or serial devices."""
        return progress_for_job(self.session, self.packages, job, request)

    def catalog(self):
        try:
            baseline = self.baseline() if self.session else None
        except (OSError, ValueError, KeyError):
            baseline = None
        result = self.packages.listing(baseline)
        result['official_updater_configured'] = bool(self.updater and self.updater_sha256)
        return result

    def install_catalog(self, bundle):
        return self.packages.install(bundle)

    def install_library_set(self, name, bundles):
        return self.packages.install_set(name, bundles)

    def execute(self, operation, request=None, loader_state=None, catalog_id=None, entry_method=None, expected_sha256=None):
        if expected_sha256 is not None and operation != 'official_updater':
            raise ValueError('Expected updater SHA256 is only accepted for official_updater')
        if operation == 'plan_app':
            if request is not None or loader_state is not None or entry_method is not None:
                raise ValueError('App plan requires only catalog id')
            if not self.session:
                return {'ok': False, 'error': 'Start a protected session on the laptop first'}
            try:
                bundle = self.packages.get(catalog_id)
                prepared = rebase(bundle, self.baseline())
            except (ValueError, OSError, KeyError):
                return {'ok': False, 'error': 'Package or verified baseline failed local validation; no device I/O'}
            if prepared['sha256'] == prepared['baseline_sha256']:
                return {'ok': True, 'data': {'already_current': True, 'device_io': False, 'sectors': []}}
            return self._pipe('plan', prepared)
        if operation == 'switch_app':
            if request is not None or loader_state is not None or entry_method not in ('auto', 'serial', 'already_uboot'):
                raise ValueError('Choose auto, serial or already_uboot for app switching')
            return self.switch_app(catalog_id, entry_method)
        if operation == 'official_updater':
            if any(x is not None for x in (request, loader_state, catalog_id, entry_method)):
                raise ValueError('Official updater requires only the expected local executable SHA256')
            return self.launch_official_updater(expected_sha256)
        if catalog_id is not None or entry_method is not None:
            raise ValueError('Catalog fields are only accepted for switch_app')
        return self._pipe(operation, request, loader_state)

    def _pipe(self, operation, request=None, loader_state=None):
        if operation not in OPERATIONS:
            raise ValueError('Unsupported operation')
        if not self.session:
            return {'ok': False, 'error': 'No protected session configured on laptop'}
        if operation == 'read_firmware':
            if request is not None or loader_state not in ('cold', 'reuse'):
                raise ValueError('Read requires explicit cold/reuse loader state')
        elif loader_state is not None:
            raise ValueError('Loader state is only accepted for read_firmware')
        if operation in IMAGE_OPERATIONS:
            if not isinstance(request, dict) or set(request) != {'op', 'image', 'sha256', 'baseline_sha256'}:
                raise ValueError('Use a locally prepared plan request')
            if request['op'] != 'plan' or not isinstance(request['image'], str):
                raise ValueError('Use an offline plan request')
            data = base64.b64decode(request['image'], validate=True)
            if len(data) != SIZE or digest(data) != request['sha256']:
                raise ValueError('Candidate size/hash mismatch')
        elif request is not None:
            raise ValueError('This operation does not take an image request')
        args = [PS, '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                '-File', str(self.client), '-SessionRoot', str(self.session), '-Operation', operation]
        if loader_state:
            args += ['-LoaderState', loader_state]
        # The temp request is local data. The elevated broker validates it again;
        # neither executable code nor paths cross the HTTP boundary.
        with tempfile.TemporaryDirectory(prefix='fm1-remote-request-') as folder:
            if request is not None:
                path = Path(folder) / 'request.json'
                path.write_text(json.dumps(request), encoding='utf-8')
                args += ['-RequestFile', str(path)]
            proc = subprocess.run(args, capture_output=True, encoding='utf-8', errors='replace', timeout=1245)
        # The client emits the broker JSON before raising on a known refusal.
        for line in reversed(proc.stdout.splitlines()):
            try:
                result = json.loads(line)
            except ValueError:
                continue
            if isinstance(result, dict) and type(result.get('ok')) is bool:
                return result
        raise RuntimeError('Protected pipe outcome unknown; inspect laptop session state and logs before further device I/O')

    def switch_app(self, catalog_id, entry_method):
        if not self.session:
            return {'ok': False, 'error': 'Start a protected session on the laptop first'}
        state = read_json(self.session / 'state.json')
        if state.get('blocked') or state.get('reset_pending') or state.get('needs_observation') or state.get('operation') != 'idle':
            return {'ok': False, 'error': 'Session needs recovery/reset/observation before switching apps'}
        if state.get('loader_running'):
            return {'ok': False, 'error': 'Readback left a helper running; establish cold UBOOT locally before a flash'}
        try:
            bundle = self.packages.get(catalog_id)
            request = rebase(bundle, self.baseline())
        except (ValueError, OSError, KeyError):
            return {'ok': False, 'error': 'Package or verified baseline failed local validation; no device I/O'}
        if request['sha256'] == state['baseline_sha256']:
            return {'ok': True, 'data': {'already_current': True, 'catalog_id': catalog_id, 'device_io': False}}
        steps = []
        automatic = entry_method == 'auto'
        selected = None
        selected_identity = None
        if automatic:
            first_inventory = self.status()
            selected = first_inventory['update_mode']
            selected_identity = self.update_identity(first_inventory)
            entry_method = selected['app_entry_method']
            if entry_method not in ('serial', 'already_uboot'):
                return {'ok': False, 'error': 'Automatic app switching requires one serial or UBOOT device; official MIDI mode uses the vendor updater'}
        def call(op, image=None):
            result = self._pipe(op, image)
            steps.append({'operation': op, 'response': result})
            return result
        result = call('plan', request)
        if result['ok'] is not True:
            return result
        inventory = self.status()
        mode = inventory.get('update_mode')
        if automatic and (not mode or mode['app_entry_method'] != entry_method or mode['mode'] != selected['mode']
                          or self.update_identity(inventory) != selected_identity):
            return {'ok': False, 'error': 'Device update mode changed during offline planning; inspect the device before another request'}
        if mode and mode['app_entry_method'] not in ('serial', 'already_uboot'):
            return {'ok': False, 'error': 'No unambiguous protected app update route; use the official updater only for recognized MIDI mode'}
        disks = inventory['uboot_disks']
        if len(disks) > 1:
            return {'ok': False, 'error': 'Multiple UBOOT disks; select exactly one device locally'}
        if not disks:
            if entry_method == 'already_uboot':
                return {'ok': False, 'error': 'FM-1 is not enumerated in UBOOT'}
            result = call('enter_uboot')
            if result['ok'] is not True:
                return result
        result = call('flash', request)
        if result['ok'] is not True:
            return result
        # One reset only. A known reset disconnect can be resolved by the
        # broker's observation path; a pipe timeout stops this job entirely.
        reset_result = call('reset')
        result = call('observe')
        if result['ok'] is not True:
            return result
        final = read_json(self.session / 'state.json')
        if final.get('blocked') or final.get('needs_observation') or final.get('reset_pending'):
            return {'ok': False, 'error': 'Write/readback completed but startup remains unverified', 'data': {'steps': steps}}
        live = call('serial_status')
        expected = {'diagnostics': 'FM1-FORGE/1', 'nes': 'NES', 'doom': 'DOOM-FM1/1', 'mdx': 'MDX-KARAOKE/1',
                    'buddha': 'MOD-EDITOR/1', 'protracker': 'MOD-EDITOR/1'}[bundle['profile']]
        profile = live.get('data', {}).get('result', {}).get('profile')
        # Match the actual HELLO identifier, never infer success from an app card.
        if live['ok'] is not True or profile != expected:
            return {'ok': False, 'error': 'Installed profile did not match the selected app', 'data': {'steps': steps}}
        return {'ok': True, 'data': {'catalog_id': catalog_id, 'sha256': request['sha256'],
                                     'profile': profile, 'steps': steps, 'written_readback_verified': True,
                                     'serial_boot_verified': True, 'physical_acceptance': False,
                                     'reset_response_ok': reset_result['ok']}}

    @staticmethod
    def update_identity(inventory):
        """Compare passive identities around the offline plan; never expose them."""
        return ([(item.get('port'), item.get('vid'), item.get('pid'), item.get('serial_number'))
                 for item in inventory.get('serial_ports', [])],
                [(item.get('DeviceID'), item.get('PNPDeviceID'), item.get('Model'))
                 for item in inventory.get('uboot_disks', [])])

    def launch_official_updater(self, expected_sha256):
        """Handoff to the real vendor MIDI/SysEx host, never emulate its writer."""
        if sys.platform != 'win32' or not self.updater or not self.updater_sha256:
            return {'ok': False, 'error': 'Configure the official Windows updater path and SHA256 locally'}
        if not isinstance(expected_sha256, str) or not re.fullmatch('[0-9a-f]{64}', expected_sha256):
            return {'ok': False, 'error': 'Official updater requires the exact reviewed executable SHA256'}
        if expected_sha256 != self.updater_sha256:
            return {'ok': False, 'error': 'Reviewed updater SHA256 does not match local configuration'}
        if self.updater.name.lower() not in ('m-upgrade-fm1.exe', 'm-upgrade.exe'):
            return {'ok': False, 'error': 'Expected the official M-UPGRADE executable'}
        try:
            verified = digest(self.updater.read_bytes()) == self.updater_sha256
        except OSError:
            verified = False
        if not verified:
            return {'ok': False, 'error': 'Official updater executable hash changed'}
        if self.session:
            state = read_json(self.session / 'state.json')
            if state.get('blocked') or state.get('operation') != 'idle' or state.get('reset_pending') or state.get('needs_observation') or state.get('loader_running') or (self.session / 'stopped.txt').exists():
                return {'ok': False, 'error': 'Resolve protected session before handing device to M-UPGRADE'}
        inventory = self.status()
        mode = inventory['update_mode']
        if mode['mode'] not in ('sysex', 'ota_sysex') or mode['official_available'] is not True:
            return {'ok': False, 'error': 'Official updater requires one freshly recognized stock or OTA MIDI input/output pair'}
        # status reads the protected state after passive enumeration, so a
        # locally changed latch during inventory cannot authorize GUI handoff.
        fresh = inventory.get('session')
        if fresh and (fresh.get('operation') != 'idle' or fresh.get('blocked') or fresh.get('reset_pending')
                      or fresh.get('needs_observation') or fresh.get('loader_running') or fresh.get('stopped')):
            return {'ok': False, 'error': 'Resolve protected session before handing device to M-UPGRADE'}
        proc = subprocess.Popen([str(self.updater)], cwd=self.updater.parent)
        return {'ok': True, 'data': {'handoff': True, 'pid': proc.pid, 'written_verified': False, 'sha256': expected_sha256, 'mode': mode['mode'],
                                    'message': 'Complete the official MIDI/SysEx update on the laptop. Start a fresh session with a verified baseline before protected switching resumes.'}}

    def baseline(self):
        if not self.session:
            raise ValueError('No protected session configured')
        state = read_json(self.session / 'state.json')
        return verified_bytes(private_file(self.session, state['baseline_file']), state['baseline_sha256'])

    def firmware(self, response):
        if not self.session or response.get('ok') is not True:
            raise ValueError('No completed verified firmware read')
        result = response['data']['result']
        if result.get('size') != SIZE or result.get('readback_count') != 2:
            raise ValueError('Firmware readback incomplete')
        if not re.fullmatch(r'runs/[0-9a-f]{32}/firmware\.bin', result.get('file', '').replace('\\', '/')):
            raise ValueError('Unexpected firmware artifact')
        return verified_bytes(private_file(self.session, result['file']), result['sha256'])
