# Hydra + Ludusavi Integrated

A Windows game launcher based on [Hydra Launcher by Los Broxas](https://github.com/hydralauncher/hydra), with automatic [Ludusavi](https://github.com/mtkennerly/ludusavi) save backups to storage you control.

Hydra with Ludusavi Integrated keeps Hydra's catalogue, library, launch controls, playtime tracking, achievements, themes, and integration code. It adds backup and recovery settings inside the launcher, access to the complete save-tool manager, custom release updates, and a source comparison against official Hydra releases. The project is **Hydra + Ludusavi Integrated**, also described as **Hydra with Ludusavi Integrated**; everyday app screens display **Hydra Ludusavi**.

**Current source:** `4.4.1-rev.2`, based on official Hydra `v4.4.1`. This README describes the source in this repository. Check [Releases](https://github.com/CedricS789/hydra/releases) for available installers; a source update does not automatically create a downloadable release.

## Get started

- [Quick start for installer recipients](docs/START-HERE.txt)
- [Install and configure backups](#install-and-configure-backups)
- [How automatic backups work](#how-automatic-backups-work)
- [Features and limitations](#features-and-limitations)
- [Screenshots](#screenshots)
- [Build from source](#build-from-source)
- [Maintenance and updates](#maintenance-and-updates)
- [Detailed setup, build, and maintenance guide](docs/LOCAL-EDITION.md)
- [Release notes](docs/LOCAL-RELEASE-NOTES.md)

## Install and configure backups

1. Download a custom setup EXE from this repository's [published releases](https://github.com/CedricS789/hydra/releases), if available, or [build from source](#build-from-source).
2. Fully exit other Hydra instances from their system trays before installing and testing. This fork uses separate application data from official Hydra; existing library and account settings are not silently copied.
3. Add games normally or use **Discover saved games** in Save backups settings, then set each game's actual executable before launching or enabling game-exit automation.
4. Open **Settings → Save backups**. Choose a backup folder you control, such as a folder inside OneDrive, a local drive, or a mounted server share. This destination picker accepts filesystem paths; engine-managed remote providers are configured separately under **Advanced rules and full manager**.
5. Choose retention and an exit delay. The initial values are 10 full versions per game and 10 seconds. Run **Preview save detection**, then **Back up now** while the game is stopped. Inspect the backed-up files; a registry-only result does not confirm that game progress was captured.
6. Enable automatic backups and save the settings. Launch a game, make a save, quit the actual game process, and verify the new result and archive after the delay. Keep Hydra Ludusavi running in its tray while playing.
7. If using a sync client, check its upload status separately. After verifying the workflow, optionally enable **Run at startup** and **Start minimized** in General settings.

Automatic backups start disabled. The local-backup feature does not require a Hydra Cloud subscription. Automatic operations never restore live saves. Manual restoration requires a reviewed preview and explicit confirmation.

## How automatic backups work

Hydra remains the launcher. The added integration decides when a backup can run, and the bundled Ludusavi executable detects and backs up save data.

1. **Read the library.** Game titles, store identifiers, and executable paths come from Hydra. Individual games can be excluded; extra save folders and tracking executables can be supplied when needed.
2. **Observe the game processes.** Windows process snapshots track the configured executable and captured child processes within the game's directory. A bootstrap program exiting is insufficient while a captured game process remains active. Handoffs that are too brief to observe may require an additional tracking path.
3. **Wait and recheck.** After the tracked processes exit, the integration waits for the configured delay and checks again before backing up. Failed process enumeration is not treated as proof of exit.
4. **Invoke Ludusavi.** Manifest-based detection, supported standalone rules, discovered common Steam emulator save locations, and configured save folders determine the data to include. Ludusavi writes ZIP or plain-file backups with detected files and, where applicable, registry data. Full and differential version retention are configurable.
5. **Record the result.** A serialized queue and destination lock prevent overlapping backup writers. The panel reports detected paths, counts, and errors; failures can generate Windows notifications. Unchanged saves need not create another backup version.

**Local backup completion and cloud synchronization are separate.** Automatic backups invoke Ludusavi with `--no-cloud-sync`. OneDrive or another sync client handles uploads independently; Hydra Ludusavi does not verify that client's completion. Manual remote transfers have separate results, and no automatic cross-device restoration is enabled.

## Features and limitations

Everyday navigation and game-page buttons use **Save backups**. The settings identify Ludusavi as the bundled engine. The main workflow is integrated into Hydra; **Open full manager** provides the engine's complete graphical interface for specialist controls.

| Feature                | Current behavior                                                                                                                                                                                                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Automatic backups      | Windows process-exit observation, delay, final stop check, and deduplicated queued work.                                                                                                                                                  |
| Formats and retention  | ZIP or plain-file storage, ZIP compression choice, retained full versions, and differential versions per full backup. Compression levels remain available in advanced configuration.                                                      |
| Detection              | Hydra library reuse, manifest lookup and update control, extra save folders, registry rules, and extra tracking executables.                                                                                                              |
| Version browser        | Load saved versions for the selected game, including dates, comments, and protection status; preview their files and registry keys.                                                                                                       |
| Manual recovery        | Preview, acknowledge overwrite consequences, and explicitly restore a version. A single-use confirmation expires after five minutes and becomes invalid if configuration or backup mapping changes. The game must be stopped.             |
| Pre-restore snapshots  | Existing affected saves are backed up separately before a Hydra-managed restore. Validation or snapshot failures stop restoration.                                                                                                        |
| Validation             | Check mapping structure, mapped-file presence, plain-file sizes, and ZIP integrity without extracting into live saves. This does not establish whether a game can load the save.                                                          |
| Advanced configuration | Native-validated YAML for roots, custom file/registry rules, exclusions, redirects, secondary manifests, provider settings, and other engine options. Standalone configuration can be imported.                                           |
| Full manager           | Opens bundled Ludusavi with this integration's configuration, allowing comments, backup locks/removal, detailed exclusions, provider setup, and all other native GUI controls. Close it to save its settings and resume Hydra operations. |
| Remote transfers       | Manual Rclone upload/download previews followed by explicit confirmation. Downloads replace backup archives, not live game saves. Rclone is configured separately.                                                                        |
| Results and cleanup    | Latest 50 results stored, latest 12 displayed. **Clear results and logs** clears history and both bounded log files while preserving saves, archives, and configuration.                                                                  |
| Overlap prevention     | One queue and destination lock for backup, restore, validation, transfers, and the full manager. Settings and log cleanup are blocked during queued/running work.                                                                         |
| Release tools          | Custom installer update controls and source-snapshot comparison against official published releases.                                                                                                                                      |
| Themes                 | Existing theme import, CSS editing, and active-theme loading retained. New panels may require theme adjustments.                                                                                                                          |

### Add detected games to the library

Open **Settings → Save backups → Discover saved games**. **Scan local saves** runs a read-only save preview; **Find backed-up games** lists entries with versions in the selected destination. Results contain actual detected data or archives, not the entire supported-game catalogue. Saves and archives may belong to uninstalled games and do not reliably identify a launch executable.

Choose **Review entry**, then select **New entry in My Games** or an existing library game. A Steam ID reported by the save definitions uses Hydra's normal Steam library identity. Without a verified store ID, choose the real `.exe` to create a custom entry, or link to an existing entry. A Steam entry may be added without an executable for backup management; launching and automatic game-exit backups still require the real executable.

Linking preserves the existing game's shop/ID, title, playtime, achievements, and executable. Duplicate store identities and executable paths are checked before creating entries. A chosen executable fills an empty path but never replaces an existing one through this screen. Normal Steam creation follows Hydra's usual library/account behavior; discovery does not invoke a restore or change the global automatic-backup switch.

The selected canonical save name is stored as an explicit association, so library display names can differ from save definitions and archive names. **Use automatic matching** removes this association after saving settings, without deleting data or the library entry. Scan results expire after 15 minutes and must be refreshed if configuration changes. Review save detection before relying on backups, particularly when only registry settings are found.

### Restore a saved version

In **Settings → Save backups**, select a library game, choose **Load saved versions**, select a version, then **Preview files and restore**. Review the paths, acknowledge what will be overwritten, and choose **Restore this version**. Cancellation and preview do not write live saves. There is no automatic restoration.

Hydra validates the selected version and captures current affected data before restoring. Pre-restore snapshots are kept under `.hydra-restore-safety/<operation-id>/` inside the backup destination when there is existing data to preserve. These snapshots are separate from normal retention and are not automatically pruned; manage their storage deliberately. A partially failed native restore may require manual recovery from that snapshot; restoration is not a filesystem transaction.

**Open full manager** runs the native tool, which has its own manual operations and confirmations. Hydra pauses its queued operations while that window is open. Operations performed directly in that window use the native workflow rather than Hydra's preview tokens or extra pre-restore snapshot. Keep games stopped while using its restore controls.

### Storage and integration boundaries

Automatic launcher backups remain local with implicit engine cloud synchronization disabled. OneDrive and similar folder-sync clients upload independently, and their completion is not verified by Hydra. Manual Rclone transfers have separate completion results; an upload replaces the selected game's remote backup set, and a download replaces its local backup set. Both can remove versions absent from the source. Configure providers in the full manager or advanced configuration before previewing a transfer.

Hydra's destination, retention, format, and compression controls take precedence over matching advanced YAML fields. Other supported rules are preserved, and native-manager changes are read back when it closes. Account credentials are not required for local backups. Hydra Cloud promotion is reduced, and Hydra Points counters and locked score prompts are hidden in desktop and Big Picture screens. Achievement unlock tracking is retained, while paid-service subscription checks remain intact. This fork does not provide Hydra Cloud services; Big Picture has not been comprehensively restyled.

The existing debrid, Steam/Epic, friends, community, playtime, and achievement code is retained. Live account and external-provider compatibility still require verification. Automated tests cover core guards and isolated real backup/restore operations. Remote transfer checks use a local Rclone remote; they do not establish that a particular cloud account or private server is configured correctly.

## Screenshots

These unaltered captures render the actual settings components in an isolated interface test with sample backend data. The game, paths, versions, and status text are examples. They are not screenshots of an installed release or evidence of real cloud synchronization. See [screenshot details](docs/screenshots/README.md).

### Save backup settings

Configure the destination, full/differential retention, format, compression, and game selection. Ludusavi is identified once in the settings description.

![Save backup settings with sample data](docs/screenshots/save-backups.png)

### Detected games and library import

Review a detected save/archive entry and add it to My Games or associate it with an existing game. The image uses synthetic example data, including the displayed Steam ID.

![Discovery results and explicit library add/link controls with sample data](docs/screenshots/discovered-games.png)

### Saved versions and cleanup

Browse versions, preview recovery, validate archives, and access remote transfers, advanced rules, and log cleanup.

![Saved versions and management controls with sample data](docs/screenshots/saved-versions.png)

### Manual restore preview

Review affected paths and explicitly acknowledge the overwrite before confirmation becomes available. This example preview does not perform a real restore.

![Manual restore preview with confirmation disabled until acknowledged](docs/screenshots/restore-preview.png)

### Release source comparison

The historical capture below shows the earlier prototype name. The red/green code is a synthetic display-test example rather than actual official-versus-custom source. Normal operation fetches real snapshots from GitHub.

![Historical prototype source comparison with synthetic example code](docs/screenshots/source-diff-prototype.png)

## Build from source

Use Windows x64, Git, Node.js, and Yarn Classic 1.22.22. The build workflow pins Node.js 22.21.0. A full native build also requires stable Rust with the Windows MSVC toolchain, compatible Visual Studio C++ Build Tools, a Windows SDK, and Visual C++ redistributable components. See the [detailed build guide](docs/LOCAL-EDITION.md#build-on-windows) for prerequisites, tests, and the optional native-component reuse route.

Clone into any suitable working directory and prepare the dependencies in PowerShell:

```powershell
git clone --branch custom/ludusavi-backups https://github.com/CedricS789/hydra.git hydra-ludusavi
Set-Location -LiteralPath .\hydra-ludusavi
npm install --prefix .tmp/tooling --cache .tmp/npm-cache --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
$env:ELECTRON_CACHE = Join-Path (Get-Location).Path '.tmp/electron-cache'
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

Run each command only after the previous one succeeds. The configuration script writes ignored `.env.production` with public service addresses; no account token is required. With the native toolchain ready, build the installer:

```powershell
node scripts/build-local.cjs
```

The helper type-checks and compiles the application, packages it, verifies the package, and copies the final files into `dist/`. It does not install or publish them. Build from a clean, committed revision; source comparison requires that revision to be available in the configured GitHub repository.

For the current version, successful output is:

```text
dist/
  hydra-ludusavi-4.4.1-rev.2-setup.exe
  hydra-ludusavi-4.4.1-rev.2-setup.exe.blockmap
  latest.yml
  START-HERE.txt
```

Keep the EXE, blockmap, and update metadata from the same successful build together. Older files can remain after a failed build, so their presence alone does not prove success. Installers are unsigned unless signing is configured.

| Item                                | Location                                                                       |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| Final installer and update metadata | `dist/` inside the checkout                                                    |
| Packaging staging and build caches  | `.tmp/`, including `.tmp/package/`                                             |
| Custom application data             | `%APPDATA%\hydralauncher-local`                                                |
| Backup logs                         | `%APPDATA%\hydralauncher-local\ludusavi-local\backup.log` and `backup.log.old` |
| Save backup destination             | Folder selected in **Settings → Save backups**                                 |

The internal package name `hydralauncher-local` and app ID `gg.hydralauncher.hydra.local` remain stable for configuration and installer compatibility. Renaming a source checkout does not affect those identifiers.

## Maintenance and updates

Official Hydra releases are the source of app updates. The shared [automatic preparation workflow](https://github.com/CedricS789/hydra/actions/workflows/upstream-release-check.yml) checks for a newer stable release every six hours, subject to GitHub scheduling. It merges the official source into a candidate, preserves this integration and app identity, runs checks, compiles on Windows, and publishes a finished adapted installer only after those steps succeed. The source catalogue is then advanced automatically.

**Every installed user follows the same route:** open **Settings → Releases and changes**, check, download, and install the available update. Neither the project owner nor other recipients need a local clone, Git, Node.js, or routine manual merging/building for compatible official updates. The application downloads the shared finished release rather than compiling on the user's computer. A first installer containing these changes must be built and distributed once; compatible official updates are then prepared and published automatically.

The settings report whether a newer official release is being prepared, preparation failed, or automation is disabled. A source conflict, failed dependency check, failed test, native loading error, or packaging error prevents publication. The working installed version remains available. Arbitrary future upstream changes cannot be guaranteed compatible: an incompatible change can require a targeted repair before preparation resumes. This is an exception path, not a per-release task for installed users.

| Workflow                                                                                                                  | Purpose                                                                                                                                  |
| ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Automatic updates from official Hydra](https://github.com/CedricS789/hydra/actions/workflows/upstream-release-check.yml) | Scheduled detection, source adaptation, checks, full Windows build, verified artifact publication, and source catalogue synchronization. |
| [Build Hydra Ludusavi installer](https://github.com/CedricS789/hydra/actions/workflows/local-release.yml)                 | Optional manual bootstrap or custom-only revision; produces artifacts and an optional draft for review.                                  |

GitHub Actions must remain enabled. GitHub can delay schedules and disables inactive public-repository schedules after 60 days without repository activity; an administrator may need to re-enable one. See [GitHub's scheduling rules](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). Drafts and releases marked prerelease are excluded by the release browser. Installers are unsigned unless signing is configured. The full Windows publication and installed upgrade cycle must be verified with real published builds; isolated automation tests do not substitute for that check.

When maintaining a separate fork, update the repository settings described in the guide before publishing installers, so updates and source comparisons use the intended repository.

## Disable or uninstall

Disable automatic backups in **Settings → Save backups** and save. Disable **Run at startup** in General settings if enabled. Uninstall through Windows Installed apps. This backup feature does not delete the external backup destination when disabled or uninstalled.

## Credits and license

Hydra Launcher is created by **Los Broxas** and its [contributors](https://github.com/hydralauncher/hydra/graphs/contributors). This unofficial fork is not maintained or endorsed by the upstream developers. Hydra uses Electron, React, TypeScript, and Rust, with libtorrent providing the torrent engine.

Hydra retains its [MIT License](LICENSE). Ludusavi and other bundled components retain their own licenses and notices.
