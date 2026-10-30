# Updating an installed tracker in Forge Windows

The CDC/UBOOT route is for an FM-1 already running the tracker. The first install
from stock V15 still uses **Custom firmware update · SysEx**. These are separate
reviewed routes with shared ownership and recovery guards.

1. Open the native **FM-1 Forge Windows** panel and click **Connect USB serial**.
   Forge checks a fresh tracker identity/build challenge. This does not stop
   playback, enter UBOOT or program flash.
2. In **Tracker update · USB serial**, select the generated `firmware.json` and
   its matching `firmware.fwsc`, then click **Review tracker update**. Check the
   source build, target build and both file digests.
3. Confirm **Prepare recovery and read flash**. Windows first requests
   administrator access for Forge's protected worker. After elevation, playback
   stops and FM-1 enters UBOOT.
   The inbox USB mass-storage driver is used; no replacement USB driver or
   separately launched helper is needed. Keep USB connected. The worker uploads
   its pinned RAM helper and reads the entire current 1 MiB flash twice. Helper
   initialization can change flash status/protection; array erase/program has
   not started.
4. Click **Review application sector plan**. Check the original job, live
   baseline/candidate hashes and ordered application sectors. Confirm
   **Install reviewed application sectors** to authorize this plan. Boot,
   configuration, unused application tail and reserved flash are preserved. The
   application-directory sector is written last. If there are no changed
   sectors, **Return to verified tracker** performs final verification and
   returns to the same application without erase/program.
5. Keep USB connected until Forge reports complete application readback and the
   exact target tracker boot build. Screen, audio and controls still need a
   physical check.

Closing the panel does not cancel the native job. Reopen it or use **Refresh** to
read the original status. If an operation becomes uncertain, another update is
blocked. **Review original CDC recovery** can use only the same saved package,
candidate and protected worker session; it does not retry automatically. If the
worker session is lost, preserve the original receipt and follow the reported
recovery handoff. Do not clear records or power-cycle to bypass the guard.

If final readback completed but the tracker boot challenge timed out, use
**Verify original tracker boot**. This checks the original target build over CDC
without rewriting it.

The package and simulated fault tests establish host implementation evidence.
Successful packaging or a zero-change hardware exercise alone does not qualify
physical erase/program acceptance. The Windows edition contains this route;
the macOS edition continues to expose its reviewed MIDI update routes.
