# Local app sets

In the FM1 Forge panel, scroll to **Apps library** and choose **Add local set**.
The connected laptop opens a local companion importer. Choose a folder, or
select individual exported app bundle `.json` files. Review the package list,
give the set a name, then choose **Add set to library**. Return to Forge; it
refreshes library metadata for five minutes after opening the importer. Use
**Refresh library** later. Select a saved set to filter its app variants.

A set contains one to eight built FM1 app bundles. These are the private
catalog exports produced by `export_remote_catalog.py` in the firmware
repository. Each bundle includes its profile, immutable package ID, display
metadata, a complete 1 MiB firmware image and matching SHA256. Source project
folders, raw `.bin` files, ROMs, songs and arbitrary JSON files cannot be
imported directly. Package those assets in a reviewed build first.

The importer validates every selected bundle before registering any package.
Invalid image sizes, hashes, duplicate IDs and changed content under an
existing ID reject the whole set. A changed variant needs a new package ID.
Adding the same named set again returns its original saved receipt. Imported
packages may still show **Blocked** until they match a protected verified
device baseline. Importing never grants transfer approval or writes to FM1.
Ordinary publication errors roll back new packages. A process crash while
publishing can leave validated standalone packages before the set receipt is
saved; inspect the library before retrying. No transfer starts automatically.

Firmware bytes and file selection remain local. The hosted Site receives only
catalog and set metadata. The companion has a five-minute, import-only session
which allows one successful set import and cannot run device jobs. The token
is removed from the browser address immediately. Existing catalog packages,
firmware project drafts, appearance settings and saved transfer progress are
preserved.

An opening request has a saved request ID. **Check saved importer request**
resumes that exact request after a delayed response; it does not reopen the
browser. After a service crash with an uncertain launch result, inspect the
saved outcome before starting a fresh import session. If the panel reports an
unknown tool, its host connection still has an older tool catalog: reconnect
FM1 Forge and reopen the panel.

The bridge and outbound relay both need the updated local library code.
Update them while idle, retaining their state directories, private credentials,
launcher settings and disabled/enabled transfer flags. This does not require
restarting or elevating the protected firmware helper.
