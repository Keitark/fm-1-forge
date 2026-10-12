"""Bounded, observational CDC input samples; no firmware or port from callers.

Only HELLO, FORGE INPUT and MOD VOL can be sent. The bridge's operation mutex
must remain held while this module enumerates and samples the device.
"""
from __future__ import annotations

import re
import time


MAX_SECONDS = 3.0
SETTLE_SECONDS = 0.15
READ_TIMEOUT = 0.04
WRITE_TIMEOUT = 0.1
MAX_BYTES = 16_384
MAX_LINE = 1024
UINT32 = 2 ** 32 - 1
ENCODER_NAMES = ('SELECT', 'ALGORITHM', 'KNOB1', 'KNOB2', 'KNOB3', 'KNOB4', 'PRESETS')
FORGE_HELLO = 'FM1DIAG/1 FM1-FORGE/1 UBOOT=SERIAL COMMIT=BLOCKED'
MOD_HELLO = 'FM1DIAG/1 MOD-EDITOR/1 RAM-TRANSFER UBOOT=SERIAL COMMIT=BLOCKED'
MESSAGES = {
    'available': 'Sampled keys, encoders and volume.',
    'mod': 'This firmware exposes volume only; keys and encoders require Forge diagnostics.',
    'unsupported': 'The running firmware does not expose supported input telemetry.',
    'unavailable': 'Input telemetry is unavailable; check the local connection.',
    'busy': 'Input monitoring is paused while the local device is reserved.',
}


def snapshot(state='unavailable', *, started_at=None, firmware=None, port=None,
             keys=None, encoders=None, volume=None):
    started_at = int(time.time()) if started_at is None else started_at
    return {'state': state, 'firmware': firmware, 'port': port,
            'capabilities': {'keys': keys is not None, 'encoders': encoders is not None,
                             'volume': volume is not None},
            'keys': keys, 'encoders': encoders, 'volume': volume,
            'observation': {'started_at': started_at, 'completed_at': int(time.time())},
            'message': MESSAGES['mod' if firmware == 'MOD-EDITOR/1' and volume is not None else state]}


def _number(value, lower=0, upper=UINT32):
    if not isinstance(value, str) or re.fullmatch(r'-?(0|[1-9][0-9]{0,9})', value) is None:
        raise ValueError('Invalid input counter')
    result = int(value)
    if not lower <= result <= upper:
        raise ValueError('Input counter outside range')
    return result


def _fields(line, prefix, expected):
    if not line.startswith(prefix):
        raise ValueError('Unexpected input row')
    fields = {}
    for word in line[len(prefix):].split(' '):
        parts = word.split('=')
        if len(parts) != 2 or parts[0] in fields:
            raise ValueError('Invalid input fields')
        fields[parts[0]] = parts[1]
    if set(fields) != set(expected):
        raise ValueError('Missing or unexpected input fields')
    return fields


def parse_forge(rows):
    if len(rows) != 8:
        raise ValueError('Expected complete input and encoder rows')
    inputs = [row for row in rows if row.startswith('FORGE INPUT ')]
    knobs = [row for row in rows if row.startswith('FORGE KNOB ')]
    if len(inputs) != 1 or len(knobs) != 7:
        raise ValueError('Expected one input and seven encoder rows')
    fields = _fields(inputs[0], 'FORGE INPUT ', ('keys', 'seen', 'scans', 'errors',
        'volume', 'gain', 'valid', 'min', 'max', 'adc_samples', 'adc_errors'))
    for key in ('keys', 'seen'):
        if (re.fullmatch('[0-9a-f]{16}', fields[key]) is None
                or int(fields[key], 16) >= 2 ** 41):
            raise ValueError('Invalid key bitmap')
    keys = {'pressed': fields['keys'], 'seen': fields['seen'],
            'scans': _number(fields['scans']), 'errors': _number(fields['errors'])}
    volume = {'value': _number(fields['volume'], upper=1023),
              'gain': _number(fields['gain'], upper=127),
              'valid': bool(_number(fields['valid'], upper=1)),
              'samples': _number(fields['adc_samples']), 'errors': _number(fields['adc_errors'])}
    minimum = _number(fields['min'], upper=1023)
    maximum = _number(fields['max'], upper=1023)
    if volume['valid'] and minimum > maximum:
        raise ValueError('Invalid volume extrema')
    encoders = {}
    for row in knobs:
        fields = _fields(row, 'FORGE KNOB ', ('id', 'name', 'edges', 'invalid', 'seen'))
        identifier = _number(fields['id'], upper=6)
        if identifier in encoders or fields['name'] != ENCODER_NAMES[identifier]:
            raise ValueError('Invalid encoder identity')
        encoders[identifier] = {'id': identifier, 'name': fields['name'],
            'edges': _number(fields['edges'], -(2 ** 31), 2 ** 31 - 1),
            'invalid': _number(fields['invalid']), 'seen': bool(_number(fields['seen'], upper=1))}
    return keys, [encoders[i] for i in range(7)], volume


def parse_mod(row):
    fields = _fields(row, 'MOD vol ', ('valid', 'target', 'raw', 'samples', 'errors', 'running', 'audio'))
    volume = {'value': _number(fields['raw'], upper=1023),
              'gain': _number(fields['target'], upper=127),
              'valid': bool(_number(fields['valid'], upper=1)),
              'samples': _number(fields['samples']), 'errors': _number(fields['errors'])}
    _number(fields['running'], upper=1)
    _number(fields['audio'], -(2 ** 31), 2 ** 31 - 1)
    return volume


class _Reader:
    def __init__(self, port, deadline, monotonic):
        self.port, self.deadline, self.monotonic = port, deadline, monotonic
        self.buffer = bytearray()
        self.total = 0

    def line(self, until=None):
        deadline = self.deadline if until is None else min(self.deadline, until)
        while self.monotonic() < deadline:
            if b'\n' in self.buffer:
                line, _, remainder = self.buffer.partition(b'\n')
                self.buffer = bytearray(remainder)
                if len(line) > MAX_LINE:
                    raise ValueError('Input row too long')
                return line.decode('ascii').rstrip('\r')
            if len(self.buffer) > MAX_LINE:
                raise ValueError('Input row too long')
            # On Windows even a timeout-property assignment reapplies the
            # complete DCB/CDC configuration. Keep settings fixed while open;
            # reserve a full finite read interval before starting each read.
            if deadline - self.monotonic() < READ_TIMEOUT:
                raise TimeoutError('Input read deadline')
            chunk = self.port.read(128)
            self.total += len(chunk)
            if self.total > MAX_BYTES:
                raise ValueError('Input response too large')
            self.buffer.extend(chunk)
        raise TimeoutError('Input sample deadline')

    def send(self, command):
        if self.deadline - self.monotonic() < WRITE_TIMEOUT:
            raise TimeoutError('Input sample deadline')
        data = (command + '\n').encode('ascii')
        if self.port.write(data) != len(data):
            raise ValueError('Incomplete input query')


def sample(*, preflight, comports=None, serial_factory=None, monotonic=time.monotonic,
           sleep=time.sleep):
    """Fixed queries against exactly one matching CDC, with an always-closed port.

    Injection hooks are local test dependencies only; no network request can
    choose them. ``preflight`` rereads persisted protected-session state.
    """
    started_at = int(time.time())
    # Reserve a little time for close and final normalization inside the wall
    # budget; no flush, reset or unbounded line read is permitted. Only the
    # read-only HELLO probe has a bounded retry below.
    deadline = monotonic() + MAX_SECONDS - 0.1
    port = None
    selected = None
    firmware = None
    def settle():
        # CDC tasks need a short bounded turn after open and a reply before the
        # next query. This interval belongs to the existing wall-clock budget.
        if deadline - monotonic() < SETTLE_SECONDS:
            raise TimeoutError('Input handshake deadline')
        sleep(SETTLE_SECONDS)
        if monotonic() >= deadline:
            raise TimeoutError('Input sample deadline')
    try:
        readiness = preflight()
        if readiness != 'ready':
            return snapshot(readiness, started_at=started_at)
        if comports is None:
            from serial.tools.list_ports import comports
        matches = [item for item in comports() if (item.vid, item.pid) == (0x3654, 0x5155)]
        if len(matches) != 1:
            return snapshot(started_at=started_at)
        selected = matches[0].device
        if not isinstance(selected, str) or re.fullmatch(r'COM[1-9][0-9]{0,3}', selected) is None:
            return snapshot(started_at=started_at)
        readiness = preflight()
        if readiness != 'ready':
            return snapshot(readiness, started_at=started_at)
        if monotonic() >= deadline:
            return snapshot(started_at=started_at)
        if serial_factory is None:
            from serial import Serial as serial_factory
        try:
            port = serial_factory(port=None, baudrate=115200, timeout=READ_TIMEOUT,
                                  write_timeout=WRITE_TIMEOUT, exclusive=True)
        except TypeError:
            # Unsupported exclusivity is discovered before opening a handle.
            port = serial_factory(port=None, baudrate=115200, timeout=READ_TIMEOUT,
                                  write_timeout=WRITE_TIMEOUT)
        # The supported firmware requires asserted DTR for CDC readiness and
        # both RX processing and TX. This is a protocol-session handshake, not
        # a hardware reset. Forge keeps its hardware running on DTR changes;
        # MOD drops any in-progress RAM import/export session while preserving
        # playback and the loaded document. Exclusivity and bridge ownership
        # prevent sampling alongside a held local upload/transfer port.
        port.dtr = True
        port.rts = False
        port.port = selected
        port.open()
        settle()
        reader = _Reader(port, deadline, monotonic)
        # The first CDC command immediately after open can be lost. Only the
        # observational HELLO may be retried, twice at most. Keep >=1.5 seconds
        # of the overall budget for the one subsequent input query, following
        # its own required CDC task settle interval.
        identity = None
        identity_deadline = deadline - 1.5 - SETTLE_SECONDS
        for attempt in range(2):
            current = monotonic()
            if current >= identity_deadline:
                raise TimeoutError('Input identity deadline')
            attempt_deadline = current + (identity_deadline - current) / (2 - attempt)
            reader.send('HELLO')
            try:
                while True:
                    line = reader.line(attempt_deadline)
                    if line.startswith(('ERR ', 'ERROR ')):
                        raise ValueError('Input identity rejected')
                    if line.startswith('FM1DIAG/1 '):
                        identity = line
                        break
                break
            except TimeoutError:
                if attempt == 1:
                    raise
        if identity == FORGE_HELLO:
            firmware = 'FM1-FORGE/1'
            settle()
            reader.send('FORGE INPUT')
            rows = []
            while len(rows) < 8:
                line = reader.line()
                if line.startswith(('ERR ', 'ERROR ')):
                    raise ValueError('Input query rejected')
                if line.startswith(('FORGE INPUT ', 'FORGE KNOB ')):
                    rows.append(line)
            keys, encoders, volume = parse_forge(rows)
            return snapshot('available', started_at=started_at, firmware=firmware,
                            port=selected, keys=keys, encoders=encoders, volume=volume)
        if identity == MOD_HELLO:
            firmware = 'MOD-EDITOR/1'
            settle()
            reader.send('MOD VOL')
            while True:
                line = reader.line()
                if line.startswith(('ERR ', 'ERROR ')):
                    raise ValueError('Input query rejected')
                if line.startswith('MOD vol '):
                    return snapshot('unsupported', started_at=started_at, firmware=firmware,
                                    port=selected, volume=parse_mod(line))
        return snapshot('unsupported', started_at=started_at, port=selected)
    except Exception:
        # Read-only communication uncertainty never becomes a firmware-job latch.
        return snapshot(started_at=started_at, firmware=firmware, port=selected)
    finally:
        if port is not None:
            try:
                port.close()
            except Exception:
                pass
