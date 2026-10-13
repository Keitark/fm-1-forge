"""Passive Windows MIDI capabilities and conservative FM-1 update routing.

Only WinMM GetNumDevs/GetDevCaps queries are used: no endpoint is opened and
no serial, disk or SysEx transfer is attempted by this module.
"""
import ctypes
import sys
import re

STOCK_NAMES = frozenset({'FM-1', 'FM-1 Midi'})
OTA_NAMES = frozenset({'ota-FM-1'})


def stock_midi_pair(endpoints):
    """Select only one exact FM1 family pair; generic device names stay closed."""
    candidates = [item for item in endpoints if isinstance(item, dict)
                  and item.get('name') in STOCK_NAMES | OTA_NAMES]
    inputs = [item['name'] for item in candidates if item.get('direction') == 'in']
    outputs = [item['name'] for item in candidates if item.get('direction') == 'out']
    if len(inputs) != 1 or len(outputs) != 1:
        return None
    if (inputs[0] in OTA_NAMES) != (outputs[0] in OTA_NAMES):
        return None
    return {'inputName': inputs[0], 'outputName': outputs[0]}


def validate_stock_pair(pair):
    if (type(pair) is not dict or set(pair) != {'inputName', 'outputName'}
            or any(not isinstance(pair[key], str) or not re.fullmatch(r'(FM-1|FM-1 Midi|ota-FM-1)(?: [0-9]{1,3})?', pair[key])
                   for key in ('inputName', 'outputName'))
            or re.sub(r' [0-9]+$', '', pair['inputName']) != re.sub(r' [0-9]+$', '', pair['outputName'])):
        raise ValueError('Select one exact stock FM1 MIDI pair')
    return dict(pair)


class MIDIINCAPSW(ctypes.Structure):
    _fields_ = [('wMid', ctypes.c_uint16), ('wPid', ctypes.c_uint16),
                ('vDriverVersion', ctypes.c_uint32), ('szPname', ctypes.c_wchar * 32),
                ('dwSupport', ctypes.c_uint32)]


class MIDIOUTCAPSW(ctypes.Structure):
    _fields_ = [('wMid', ctypes.c_uint16), ('wPid', ctypes.c_uint16),
                ('vDriverVersion', ctypes.c_uint32), ('szPname', ctypes.c_wchar * 32),
                ('wTechnology', ctypes.c_uint16), ('wVoices', ctypes.c_uint16),
                ('wNotes', ctypes.c_uint16), ('wChannelMask', ctypes.c_uint16),
                ('dwSupport', ctypes.c_uint32)]


def enumerate_midi_endpoints():
    if sys.platform != 'win32':
        return {'endpoints': [], 'error': 'Passive WinMM inventory requires Windows'}
    try:
        winmm = ctypes.WinDLL('winmm.dll', winmode=0x800)  # LOAD_LIBRARY_SEARCH_SYSTEM32
        endpoints = []
        for direction, prefix, structure in (('in', 'midiIn', MIDIINCAPSW), ('out', 'midiOut', MIDIOUTCAPSW)):
            count = getattr(winmm, prefix + 'GetNumDevs')
            caps = getattr(winmm, prefix + 'GetDevCapsW')
            count.argtypes, count.restype = [], ctypes.c_uint
            caps.argtypes = [ctypes.c_size_t, ctypes.POINTER(structure), ctypes.c_uint]
            caps.restype = ctypes.c_uint
            number = count()
            if number > 256:
                raise ValueError('MIDI endpoint count exceeds passive inventory bound')
            for index in range(number):
                item = structure()
                if caps(index, ctypes.byref(item), ctypes.sizeof(item)) != 0:
                    raise ValueError('MIDI capabilities query failed')
                endpoints.append({'direction': direction, 'name': item.szPname})
        return {'endpoints': endpoints, 'error': None}
    except (OSError, ValueError, AttributeError, ctypes.ArgumentError):
        return {'endpoints': [], 'error': 'Windows MIDI capabilities enumeration failed'}


def classify_update_mode(serial_ports, uboot_disks, midi_endpoints, inventory_error=None):
    def result(mode, reason, entry=None, official=False):
        return {'mode': mode, 'app_entry_method': entry, 'official_available': official, 'reason': reason}
    if inventory_error:
        return result('unknown', 'Passive device inventory failed; resolve it locally')
    if not all(isinstance(items, list) for items in (serial_ports, uboot_disks, midi_endpoints)):
        return result('unknown', 'Passive device inventory is incomplete')
    if not all(isinstance(candidate, dict) for candidate in serial_ports + uboot_disks):
        return result('unknown', 'Passive device candidate metadata is incomplete')
    families = {'stock': {'in': 0, 'out': 0}, 'ota': {'in': 0, 'out': 0}}
    for endpoint in midi_endpoints:
        if not isinstance(endpoint, dict) or endpoint.get('direction') not in ('in', 'out') or not isinstance(endpoint.get('name'), str):
            return result('unknown', 'MIDI endpoint metadata is incomplete')
        name = endpoint['name']
        if name in STOCK_NAMES:
            family = 'stock'
        elif name in OTA_NAMES:
            family = 'ota'
        elif 'fm-1' in name.lower() or 'fm1' in name.lower():
            return result('unknown', 'Unrecognized FM-1 MIDI endpoint; no update route selected')
        else:
            continue
        families[family][endpoint['direction']] += 1
    if len(serial_ports) > 1 or len(uboot_disks) > 1 or any(max(counts.values()) > 1 for counts in families.values()):
        return result('ambiguous', 'Multiple FM-1 candidates; leave exactly one device connected')
    present = [name for name, counts in families.items() if max(counts.values())]
    candidates = bool(serial_ports) + bool(uboot_disks) + len(present)
    if candidates > 1:
        return result('ambiguous', 'Conflicting FM-1 update interfaces; resolve the device mode locally')
    if serial_ports:
        return result('serial', 'One FM-1 CDC interface is available', 'serial')
    if uboot_disks:
        return result('uboot', 'One WL82 UBOOT disk is available', 'already_uboot')
    if present:
        family = present[0]
        if families[family] != {'in': 1, 'out': 1}:
            return result('unknown', 'FM-1 MIDI input/output pair is incomplete')
        return result('sysex' if family == 'stock' else 'ota_sysex',
                      'Recognized official MIDI update mode; use the vendor updater', official=True)
    return result('disconnected', 'No recognized FM-1 update interface is present')
