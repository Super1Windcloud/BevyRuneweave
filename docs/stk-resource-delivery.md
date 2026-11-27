# STK resource delivery

The startup ZIP contains Tux and its wheels, existing UI, Chinese/English fonts,
scripts/configuration, minimaps, item models and essential sound effects. Scenes,
other playable karts, music and large track previews are downloaded separately.

## Production inputs and runtime payloads

`projects/stk-car/modules/stk-car/game/assets/source/` versions the complete local
STK models/items, sound effects, scenery library, GUI, skins, fonts and replay inputs.
Its `source-manifest.json` records SHA-256 provenance. These production inputs are
excluded from both startup and full playable ZIPs. Published runtime models,
music, previews, and map images stay in the local asset directory after
conversion. The repository tracks the startup files, build inputs, and the
catalog with the immutable URLs, file sizes, and hashes of the published packs.

All 18 original karts, original music, all 44 scene directories and the complete
public texture library are preserved as four `stk-source-*.zip` Release assets.
These production source archives contain the inputs for asset conversion. The
runtime catalog contains an independent pack for each of the 44 converted
scenes. The 21 standard race courses use their original drivelines and generated minimaps.
The other 23 scenes, including arenas, soccer fields and internal scenes, can be
downloaded and opened in the 3D viewer. Races use the four existing playable karts.

## Build and publish

```sh
npm --prefix projects/stk-car run import:local-assets -- --source=/absolute/stk-assets --code=/absolute/stk-code
npm exec --prefix projects/stk-car -- tsx projects/stk-car/scripts/prepare-source-packs.ts --source=/absolute/stk-assets
npm --prefix projects/stk-car run prepare:packs
npm --prefix projects/stk-car run package
npm --prefix projects/stk-car run publish:packs
```

Only import/conversion requires an original STK checkout. Ordinary launches and
downloaded gameplay do not. Sources are copied, never deleted or moved. Publication
reads repository-root `.env`, verifies every local artifact before uploading, and
creates a dedicated `stk-content-v1` prerelease if absent. It never replaces or
removes existing assets; existing hash names must match their recorded digest/size.
The content prerelease does not replace the launcher's current stable release.

`prepare:packs` generates `resource-catalog.ts`, `startup-manifest.json` and
`dist/stk-car/packs/publication.json`. URLs pin a release tag and full SHA-256 name.
`package` writes `dist/stk-car/stk-car.zip` directly from the tracked startup
manifest and catalog. `tsx scripts/package.ts --full` uses the local converted
assets to write `stk-car-full.zip` for offline testing.
The shared encrypted publisher also honors the startup manifest, excluding source
libraries and remote payloads from its game ZIP.

## Runtime behavior

The homepage renders locally and queues the selected course and all its default
race's karts, with at most two active requests. Opening a playable course's details
prioritizes its map pack and shows its progress. For a viewer scene, the same
map-pack flow leads to a 3D view with an orbiting camera. Grand Prix previews
link back to the single-race track picker. Starting checks the map and actual
player and AI roster and shows a bilingual preparation screen until the packs are
installed. Returning cancels the start intent; downloads may finish in the
background. Errors allow retry. Music has lower priority and never prevents racing.

Workers stream downloads to temporary files outside the render thread. Installation
checks archive size/SHA-256, an exact file allowlist, per-file size/SHA-256, safe
relative paths, duplicates, symlinks and bounded sizes. Complete packs are atomically
renamed into immutable cache directories. Incomplete staging is discarded; valid old
packs and saves are preserved. Retry restarts incomplete transfers; byte-range resume
is not implemented.

The cache is below the existing native data root at
`resource-packs/<project>/<archive-sha256>/` and survives startup bundle replacement.
Bevy's named file source resolves portable returned roots such as
`cache://stk-car/<hash>/`. Matching bundled development assets verify locally and
return an empty prefix without network. Persisted cache contents are reverified
asynchronously before being reported ready.

## Native API

Both Lua and QuickJS/TypeScript use the same BMS registrations:

- `asset_pack_request(descriptorJson)` returns a script-scoped ID, or zero when busy.
- `asset_pack_poll(id)` returns `pending` with `received,total`, `ready` with `root`,
  `error` with `error`, or `unknown`. Terminal results are consumed.

Descriptors contain `url`, `bytes`, `sha256`, and `files`, whose entries contain
`path`, `bytes`, and `sha256`. Hashes are 64 lowercase hex characters. HTTPS is
required, including redirects. Script detach cancels workers; each attachment keeps
its project namespace during game switches. Errors include `network`, `http`,
`size_mismatch`, `checksum_mismatch`, `invalid_manifest`, `invalid_archive`,
`unexpected_file`, `invalid_url`, `too_large`, `cancelled`, `io`, and `unavailable`.

File sources, workers, ZIP and hash code support Windows, macOS, Linux, Android and
iOS. Platform build and actual interaction acceptance must be reported separately.
Older runtimes leave the homepage usable and show an update message for remote content.
The API requires rebuilding affected native libraries. Android/iOS hosts must also
be rebuilt and reinstalled with the new `.so`/XCFramework; updating the ZIP is insufficient.
