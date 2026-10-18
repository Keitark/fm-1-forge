<!-- SPDX-License-Identifier: Apache-2.0 -->
# Common updater source in the native Forge panel

Prepared 2026-10-18. These six modules are copied byte-for-byte from the
independently authored `firmware/usb-midi/web/` common updater implementation.
The native panel uses `fm1-browser-common-ui.mjs` as its separate UI adapter;
no standalone HTML page or external browser is required by this integration.

See `LICENSE` and `NOTICE` for Apache-2.0 terms, attribution and factual
interoperability references. No vendor firmware, OTA resource or device image
is included. The separate exact manufacturer V15 stock updater retains its
own package policy and journal.

| File | Source SHA-256 |
| --- | --- |
| index.mjs | `fbd0449251a8f63642a4aea0f3b4a28a44519af1fd251e7b2b8b477e0a698202` |
| journal.mjs | `858dc91e5ccfccd53b513abc4dc7d7a97e2cd5f04e4df20e492e824e6b617a5b` |
| package.mjs | `1f8f951524c740da7b1029276719ac1f0ac8f34c7ec64fcc81863f7b769d23f1` |
| protocol.mjs | `2214ed6301c9dc289f56c93381fe0baf7d7f3524fe33da6c7be28f7c68be0d64` |
| updater.mjs | `9146b3d3f0ee6fc72fb93190712415d39f443c8cfce021908a96203f275b6e35` |
| web-midi.mjs | `84d60040c59b8e297d8d7c34166000df21d48b98a9973b7ab9b99f0ada244eed` |

Device access runs in the native panel through its actual browser APIs.
A secure origin, Web MIDI SysEx permission, strict IndexedDB durability and
same-origin Web Locks are required. Constructor/storage initialization does
not request permission or open a device. Source install compatibility stays
disabled until loader/preservation qualification. Host tests establish neither
native permission nor Windows, macOS or Linux hardware acceptance.
