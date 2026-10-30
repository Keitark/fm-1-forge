"""Offline sampled-input contract tests; fake ports only, no physical I/O."""
from types import SimpleNamespace
import unittest

import input_telemetry as inputs


def forge_rows():
    return ['FORGE INPUT keys=0000000000000002 seen=0000000000000003 scans=100 errors=0 '
            'volume=500 gain=63 valid=1 min=4 max=1023 adc_samples=50 adc_errors=0'] + [
        f'FORGE KNOB id={i} name={name} edges={i - 3} invalid={i} seen={i % 2}'
        for i, name in enumerate(inputs.ENCODER_NAMES)]


MOD_ROW = 'MOD vol valid=1 target=42 raw=321 samples=55 errors=0 running=1 audio=0'


class Clock:
    def __init__(self):
        self.now = 0.0

    def __call__(self):
        return self.now

    def sleep(self, interval):
        self.now += interval


class Port:
    def __init__(self, clock, hello=inputs.FORGE_HELLO, rows=None, fail=None, **settings):
        self.clock, self.hello, self.rows, self.fail = clock, hello, rows, fail
        self.settings = settings
        self.received = bytearray()
        self.writes = []
        self.closed = 0
        self.opened = 0
        self.timeout_sets = 0
        self.write_timeout_sets = 0
        self.timeout = settings['timeout']
        self.write_timeout = settings['write_timeout']
        self.opened_at = None
        self.identity_read_at = None
        self.identity_remaining = 0

    @property
    def timeout(self):
        return self._timeout

    @timeout.setter
    def timeout(self, value):
        if self.opened:
            raise AssertionError('No CDC reconfiguration after opening')
        self.timeout_sets += 1
        self._timeout = value

    @property
    def write_timeout(self):
        return self._write_timeout

    @write_timeout.setter
    def write_timeout(self, value):
        if self.opened:
            raise AssertionError('No CDC reconfiguration after opening')
        self.write_timeout_sets += 1
        self._write_timeout = value

    def open(self):
        if self.dtr is not True or self.rts is not False:
            raise AssertionError('DTR must be asserted and RTS disabled before opening')
        self.opened += 1
        self.opened_at = self.clock.now
        if self.fail == 'open':
            raise OSError('private local device detail')

    def close(self):
        self.closed += 1

    def write(self, data):
        if self.clock.now - self.opened_at < inputs.SETTLE_SECONDS - 1e-9:
            raise AssertionError('CDC needs a bounded settle after open')
        if data in (b'FORGE INPUT\n', b'MOD VOL\n') and (
                self.identity_read_at is None or
                self.clock.now - self.identity_read_at < inputs.SETTLE_SECONDS - 1e-9):
            raise AssertionError('CDC needs a bounded settle after the identity reply')
        self.writes.append(data)
        if self.fail == 'write':
            raise OSError('private local device detail')
        if data == b'HELLO\n':
            text = '' if self.hello is None or (self.fail == 'first_hello' and len(self.writes) == 1) else self.hello + '\n'
            self.identity_remaining = len(text)
        elif data in (b'FORGE INPUT\n', b'MOD VOL\n'):
            text = '\n'.join(self.rows or []) + '\n'
        else:
            raise AssertionError('No mutable or caller-selected commands')
        self.received.extend(text.encode('ascii'))
        return len(data)

    def read(self, count):
        self.clock.now += self.timeout
        if self.fail == 'read':
            raise OSError('private local device detail')
        chunk = bytes(self.received[:count])
        del self.received[:count]
        if self.identity_remaining:
            self.identity_remaining -= len(chunk)
            if self.identity_remaining <= 0:
                self.identity_read_at = self.clock.now
        return chunk


class InputTests(unittest.TestCase):
    def sample(self, hello=inputs.FORGE_HELLO, rows=None, readiness=lambda: 'ready',
               fail=None, ports=None, supports_exclusive=True):
        self.clock = Clock()
        self.handles = []
        self.factory_calls = []
        def factory(**settings):
            self.factory_calls.append(settings)
            if not supports_exclusive and 'exclusive' in settings:
                raise TypeError('exclusive unsupported before handle open')
            port = Port(self.clock, hello=hello, rows=rows or forge_rows(), fail=fail, **settings)
            self.handles.append(port)
            return port
        ports = ports if ports is not None else [SimpleNamespace(device='COM4', vid=0x3654, pid=0x5155)]
        return inputs.sample(preflight=readiness, comports=lambda: ports,
                             serial_factory=factory, monotonic=self.clock, sleep=self.clock.sleep)

    def test_forge_samples_all_inputs_and_closes_with_fixed_queries(self):
        result = self.sample()
        self.assertEqual(result['state'], 'available')
        self.assertEqual(result['firmware'], 'FM1-FORGE/1')
        self.assertEqual(result['port'], 'COM4')
        self.assertEqual(result['capabilities'], {'keys': True, 'encoders': True, 'volume': True})
        self.assertEqual(result['keys']['pressed'], '0000000000000002')
        self.assertEqual(result['encoders'][0]['edges'], -3)
        self.assertEqual(result['volume']['value'], 500)
        self.assertEqual(self.handles[0].writes, [b'HELLO\n', b'FORGE INPUT\n'])
        self.assertEqual(self.handles[0].closed, 1)
        self.assertIsNone(self.factory_calls[0]['port'])
        self.assertTrue(self.factory_calls[0]['exclusive'])
        self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)

    def test_cdc_settle_is_required_after_open_and_before_single_input_query(self):
        for hello, rows in ((inputs.FORGE_HELLO, forge_rows()), (inputs.MOD_HELLO, [MOD_ROW])):
            with self.subTest(hello=hello):
                result = self.sample(hello=hello, rows=rows)
                self.assertIn(result['state'], ('available', 'unsupported'))
                self.assertIsNotNone(result['volume'])
                self.assertGreaterEqual(self.clock.now - self.handles[0].opened_at,
                                        inputs.SETTLE_SECONDS * 2)
                self.assertEqual(self.handles[0].closed, 1)
                self.assertEqual(len(self.handles[0].writes), 2)
                self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)

    def test_serial_configuration_is_fixed_before_open_through_all_reads_and_writes(self):
        for fields in ({}, {'fail': 'first_hello'}, {'rows': forge_rows()[:7]},
                       {'hello': inputs.MOD_HELLO, 'rows': [MOD_ROW]}):
            with self.subTest(fields=fields):
                result = self.sample(**fields)
                handle = self.handles[0]
                self.assertEqual(handle.timeout_sets, 1)
                self.assertEqual(handle.write_timeout_sets, 1)
                self.assertEqual(handle.timeout, inputs.READ_TIMEOUT)
                self.assertEqual(handle.write_timeout, inputs.WRITE_TIMEOUT)
                self.assertEqual(handle.closed, 1)
                self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)
                if fields.get('rows') != forge_rows()[:7]:
                    self.assertIsNotNone(result['volume'])

    def test_mod_exposes_volume_without_fabricating_keys_or_encoders(self):
        result = self.sample(hello=inputs.MOD_HELLO, rows=[MOD_ROW])
        self.assertEqual(result['state'], 'unsupported')
        self.assertEqual(result['firmware'], 'MOD-EDITOR/1')
        self.assertEqual(result['capabilities'], {'keys': False, 'encoders': False, 'volume': True})
        self.assertIsNone(result['keys'])
        self.assertIsNone(result['encoders'])
        self.assertEqual(result['volume'], {'value': 321, 'gain': 42, 'valid': True, 'samples': 55, 'errors': 0})
        self.assertEqual(self.handles[0].writes, [b'HELLO\n', b'MOD VOL\n'])

    def test_other_firmware_receives_hello_only_without_leaking_identity(self):
        result = self.sample(hello='FM1DIAG/1 PRIVATE-FIRMWARE/1 secret=private')
        self.assertEqual(result['state'], 'unsupported')
        self.assertIsNone(result['firmware'])
        self.assertIsNone(result['keys'])
        self.assertEqual(self.handles[0].writes, [b'HELLO\n'])
        self.assertNotIn('secret', repr(result))

    def test_reserved_session_never_enumerates_or_opens(self):
        for state in ('busy', 'unavailable'):
            with self.subTest(state=state):
                result = inputs.sample(preflight=lambda: state,
                    comports=lambda: self.fail('Must not enumerate'),
                    serial_factory=lambda **kw: self.fail('Must not open'))
                self.assertEqual(result['state'], state)

    def test_second_preflight_reserves_after_enumeration_without_open(self):
        states = iter(('ready', 'busy'))
        result = self.sample(readiness=lambda: next(states))
        self.assertEqual(result['state'], 'busy')
        self.assertEqual(self.handles, [])

    def test_zero_multiple_wrong_vid_or_invalid_local_ports_never_open(self):
        unit = SimpleNamespace(device='COM4', vid=0x3654, pid=0x5155)
        for ports in ([], [unit, unit], [SimpleNamespace(device='COM4', vid=1, pid=2)],
                      [SimpleNamespace(device='arbitrary-path', vid=0x3654, pid=0x5155)]):
            with self.subTest(ports=ports):
                self.assertEqual(self.sample(ports=ports)['state'], 'unavailable')
                self.assertEqual(self.handles, [])

    def test_missing_hello_and_partial_rows_are_bounded_and_always_close(self):
        for hello, rows in ((None, forge_rows()), (inputs.FORGE_HELLO, forge_rows()[:7])):
            with self.subTest(hello=hello):
                result = self.sample(hello=hello, rows=rows)
                self.assertEqual(result['state'], 'unavailable')
                self.assertIsNone(result['keys'])
                self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)
                self.assertEqual(self.handles[0].closed, 1)

    def test_only_hello_is_retried_after_first_open_probe_is_lost(self):
        result = self.sample(fail='first_hello')
        self.assertEqual(result['state'], 'available')
        self.assertEqual(self.handles[0].writes, [b'HELLO\n', b'HELLO\n', b'FORGE INPUT\n'])
        self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)
        self.assertEqual(self.handles[0].closed, 1)
        result = self.sample(rows=forge_rows()[:7])
        self.assertEqual(result['state'], 'unavailable')
        self.assertEqual(self.handles[0].writes, [b'HELLO\n', b'FORGE INPUT\n'])

    def test_io_errors_are_fixed_unavailable_without_private_detail_or_retry(self):
        for failure in ('open', 'write', 'read'):
            with self.subTest(failure=failure):
                result = self.sample(fail=failure)
                self.assertEqual(result['state'], 'unavailable')
                self.assertNotIn('private', repr(result))
                self.assertEqual(self.handles[0].closed, 1)
                self.assertLessEqual(len(self.handles[0].writes), 1)

    def test_exclusive_fallback_happens_before_any_open(self):
        result = self.sample(supports_exclusive=False)
        self.assertEqual(result['state'], 'available')
        self.assertEqual(len(self.factory_calls), 2)
        self.assertEqual(len(self.handles), 1)
        self.assertEqual(self.handles[0].opened, 1)

    def test_malformed_duplicate_or_out_of_range_rows_reject_entire_sample(self):
        changes = [(0, 'keys=0000000000000002', 'keys=0000020000000000'),
                   (0, 'gain=63', 'gain=128'), (0, 'volume=500', 'volume=1024'),
                   (0, 'valid=1', 'valid=2'), (0, 'scans=100', 'scans=4294967296'),
                   (1, 'name=SELECT', 'name=UNTRUSTED'), (1, 'id=0', 'id=1'),
                   (1, 'edges=-3', 'edges=-2147483649'), (1, 'invalid=0', 'invalid=-1'),
                   (1, 'seen=0', 'seen=2'), (0, 'errors=0', 'errors=0 errors=0'),
                   (0, 'keys=0000000000000002', 'keys=000000000000000A')]
        for index, before, after in changes:
            rows = forge_rows()
            rows[index] = rows[index].replace(before, after)
            with self.subTest(after=after):
                result = self.sample(rows=rows)
                self.assertEqual(result['state'], 'unavailable')
                self.assertIsNone(result['keys'])
                self.assertIsNone(result['encoders'])
                self.assertEqual(self.handles[0].closed, 1)

    def test_oversized_lines_and_total_bytes_are_bounded(self):
        for rows in (['x' * (inputs.MAX_LINE + 1)], ['unrelated telemetry'] * 1000):
            with self.subTest(length=len(rows)):
                result = self.sample(rows=rows)
                self.assertEqual(result['state'], 'unavailable')
                self.assertEqual(self.handles[0].closed, 1)
                self.assertLessEqual(self.clock.now, inputs.MAX_SECONDS)

    def test_mod_validates_all_rows_and_does_not_accept_missing_fields(self):
        for row in (MOD_ROW.replace(' raw=321', ''), MOD_ROW.replace('audio=0', 'audio=nan'),
                    MOD_ROW.replace('running=1', 'running=2'), MOD_ROW + ' private=secret'):
            with self.subTest(row=row):
                result = self.sample(hello=inputs.MOD_HELLO, rows=[row])
                self.assertEqual(result['state'], 'unavailable')
                self.assertIsNone(result['volume'])


if __name__ == '__main__':
    unittest.main()
