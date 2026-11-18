# Hydra + Ludusavi Integrated — 4.4.1-remix.5

Based on official Hydra v4.4.1. This is an unofficial fork; upstream copyright and the MIT license are retained. These notes describe the source version. Installer availability is listed on the repository's published releases page.

## Features

- Direct peer-to-peer torrents are blocked by default on new installations and upgrades without an explicit opt-in. Main-process enforcement covers native initialization, metadata, downloads, queues, automatic resume, and seeding; debrid failures do not trigger direct fallback. Existing torrent jobs are parked without deleting files. Desktop and Big Picture omit the Torrent option while blocked. **Settings → Downloads → Direct torrent protection** requires acknowledgement and `ENABLE DIRECT TORRENTS` to enable access; blocking remains one click. HTTP/Epic and debrid transfers remain available. Synthetic protection checks run in both release workflows.
- Added `node scripts/update-from-official.mjs`: check the online project and official release, reuse an active update or request one, follow progress, and verify both source synchronization and completed public release assets. `--check` is read-only; `--no-wait` returns a progress link. Compilation remains on GitHub.
- Official releases now drive shared automatic preparation: adapt source, test, compile, verify native loading and artifacts, publish a finished update, and catalogue source automatically. The owner and all installed users consume the same update without local developer tools.
- Preparation status distinguishes pending, failed, disabled, and unavailable automation. Conflicts and failed checks block publication while retaining the working installed version. One initial installer containing these changes must still be built and distributed.

- Project renamed **Hydra + Ludusavi Integrated**, displayed as **Hydra Ludusavi** in everyday UI and described as **Hydra with Ludusavi Integrated**.
- Subscription-linked Hydra Points counters, locked placeholders, and score badges are hidden in achievement lists, comparisons, profiles, and Big Picture. Unlock tracking and stored scoring data are preserved.

- Versioned backups created by bundled Ludusavi 0.31.0 after the observed game and captured game-directory child processes exit.
- Discovery reports native scan progress and active titles, followed by metadata-matching progress. Native scan logs created for progress reporting are removed afterward.
- Expanded sections have more space below their headings. New configurations enable automatic backups by default while preserving existing preferences.
- The bundled engine version is checked during build preparation. Native update prompts are disabled; engine binaries are updated through Hydra Ludusavi releases, separately from save manifests.
- Missing remote configuration now shows an actionable setup guide and direct manager button beside the error. Failed operations refresh busy state, and IPC wrapper text is removed from displayed errors.
- Configurable destination, full/differential retention, ZIP/plain-file formats, compression, exit delay, additional save folders, and tracking executables.
- Automatic backup-only operation, a serialized queue, destination lock, results, logs, and failure notifications.
- **Clear results and logs** removes saved history and both backup logs after confirmation, preserving saves, archives, and configuration. Clearing is blocked during queued/running operations. History is limited to 50 results and each of the two log files to 2 MiB.
- Manifest-based save detection plus discovery of common Steam emulator save folders.
- Local backup completion reported separately from unverified external synchronization.
- Reduced Hydra Cloud promotion with paid-service subscription checks retained.
- Published-release browser and source snapshot comparison: official source in red, installed custom source in green.
- Check, download, and install controls for custom releases. The updater uses the configured custom repository.
- Short display name **Hydra Ludusavi**, with the full name in formal installer details. Existing internal identifiers remain stable for settings and installer compatibility.
- Theme import, CSS editing, and active-theme loading retained. Additional panels may require theme CSS adjustments.
- Installer filename `hydra-ludusavi-4.4.1-remix.5-setup.exe`.
- Added a safety-first **Uninstall game** flow for standalone/repack/custom PC games (and Hydra downloads installed to a separate directory) with native Windows uninstaller detection (`unins000.exe` / `uninstall.exe` / Registry `UninstallString`), path and cross-game collision guardrails, Wine prefix isolation checks, and Desktop/Big Picture previews.
- Source website browsing now strips trademark symbols (`™`, `®`, `©`) from initial searches and uses fuzzy title matching for search queries and game pages (supporting shortened queries, omitted editions/subtitles, minor typos, punctuation differences, and Roman/Arabic numeral equivalents while still blocking unrelated games and mismatched sequels).

- Everyday labels use **Save backups**, with Ludusavi credited in settings. The game-page shortcut preselects the library game.
- Version browsing, file/registry restore previews, explicit expiring confirmation, stopped-game checks, selected-version validation, and a separate pre-restore snapshot.
- Native-validated advanced YAML and standalone-rule import; the complete bundled graphical manager is available with shared configuration. Closing it reads back settings and resumes queued operations.
- Manual Rclone upload/download previews and confirmations, with remote completion recorded separately from local backup completion. No automatic download or restoration is enabled.

- **Discover saved games** scans local save data or archives, matches Steam/Hydra catalogue/Epic metadata and artwork, and offers one-click **Add to My Games** or bulk **Add all to My Games**. Store and custom entries can be added without an executable, including uninstalled games. Metadata failures preserve the detected save entry.
- Save backups uses structured cards and a separate advanced view opened through **Open advanced settings**. Its own **Game to configure** selector leaves the main backup/recovery game unchanged. Returning preserves selections, discovery results, and edits. A single toolbar saves settings; the engine's YAML editor retains its own validation/save control.
- Backup actions sit below the main game controls, checkbox/dropdown alignment and wrapping adapt to window width, and **Executable not set** replaces the misleading not-installed badge.
- Linking keeps existing identity, playtime, achievements, title, and executable, while storing the canonical save association for future backups and recovery. Duplicate IDs/paths and stale scan results are checked. No executable is guessed from a save folder, and the global automatic-backup setting is preserved.

## Setup and build

Automatic backups are enabled for new configurations, and existing preferences are preserved. Configure a destination, preview detection, inspect an archive, and verify a real game-exit backup before relying on everyday automation. Keep Hydra Ludusavi running while playing. No automatic restoration is provided.

The build helper supports full native compilation and optional reuse of unchanged native components from an exactly matching official Hydra installation. The GitHub Windows workflow uses the full-source route. See the [setup and build guide](LOCAL-EDITION.md).

The official-release workflow now prepares compatible updates automatically for every installation. Targeted repairs may be needed for incompatible upstream changes; successful tests do not prove all live account services. Installers are unsigned unless signing is configured.

## Known limits

Specialist controls such as backup comments, locks, deletion, provider setup, and the complete engine GUI remain in **Open full manager** rather than being recreated as individual Hydra forms. Native-window operations use their own confirmations and do not add Hydra's extra pre-restore snapshot. Pre-restore snapshots created by Hydra are not automatically pruned. Validation checks metadata, presence, sizes for plain files, and ZIP integrity; it does not establish save usability.

Rclone is configured separately. Isolated local-remote tests do not verify a cloud account or private server. Full live sign-in, debrid downloads, Steam/Epic linking, friends/community behavior, real achievement unlocks, and native provider authentication still need manual verification.

Older Hydra Local prototypes may require a manual upgrade using the new setup EXE. Screenshots use sample backend data; see [screenshot details](screenshots/README.md).
