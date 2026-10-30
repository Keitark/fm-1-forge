# Closed Windows CDC to UBOOT transport

The narrow WL82 SCSI command encoding and pinned RAM helper derive from
Andrey Grigoryev's (kagaimiq) MIT-licensed jl-uboot-tool. The complete license is
included as LICENSE.jl-uboot-tool. This package exposes no general SCSI, memory,
key, chip erase or caller-selected device command.

The bundled wl82loader.bin is 24,064 bytes, already encoded in 512-byte blocks.
SHA256: d41da6126760c9d66660bcc0cac8d27d221806c5e369a8036921efe68dca5376.
It is loaded only after this process's freshly challenged CDC-to-UBOOT transition.

The plugin owns the relay and elevated worker. UAC launches an in-memory script
whose compressed bytes and exact length were frozen before elevation. Code,
application, baseline, candidate, ordered plan and fsynced mutation evidence are
kept in a fresh administrator-owned Program Files session. IPC is restricted to
the requesting Windows SID and exact peer process; it accepts only closed job
operations. Windows' inbox mass-storage driver provides the transport.

Recovery is explicit and restricted to the original live worker and raw handle.
Verified sectors must match the candidate, untouched sectors the baseline; only
the next sector with recorded intent may be uncertain and rewritten from the
original candidate. This includes restoring preserved bytes sharing its erase
sector. A lost session cannot automatically reupload the helper or reset.

Mock tests, native compilation and package closure are separate from physical
qualification. Do not claim hardware erase/program acceptance without that run.
