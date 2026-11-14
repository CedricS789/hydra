# Hydra Custom by Cédric — 4.4.1-rev.2

Based on official Hydra v4.4.1. This is an unofficial fork; upstream copyright and the MIT license are retained. These notes describe the source version. Installer availability is listed on the repository's published releases page.

## Features

- Versioned backups created by bundled Ludusavi 0.29.0 after the observed game and captured game-directory child processes exit.
- Configurable destination, full-version retention, exit delay, additional save folders, and tracking executables.
- Backup-only operation, a serialized queue, destination lock, results, logs, and failure notifications.
- **Clear results and logs** removes saved history and both backup logs after confirmation, preserving saves, archives, and configuration. Clearing is blocked during queued/running operations. History is limited to 50 results and each of the two log files to 2 MiB.
- Manifest-based save detection plus discovery of common Steam emulator save folders.
- Local backup completion reported separately from unverified external synchronization.
- Reduced Hydra Cloud promotion with paid-service subscription checks retained.
- Published-release browser and source snapshot comparison: official source in red, installed custom source in green.
- Check, download, and install controls for custom releases. The updater uses the configured custom repository.
- Short display name **Hydra Custom**, with the full name in formal installer details. Existing internal identifiers remain stable for settings and installer compatibility.
- Theme import, CSS editing, and active-theme loading retained. Additional panels may require theme CSS adjustments.
- Installer filename `hydra-custom-4.4.1-rev.2-setup-customized-by-cédric.exe`.

## Setup and build

Backups start disabled. Configure a destination, preview detection, inspect an archive, and verify a real game-exit backup before enabling everyday automation. Keep Hydra Custom running while playing. No automatic restoration is provided.

The build helper supports full native compilation and optional reuse of unchanged native components from an exactly matching official Hydra installation. The GitHub Windows workflow uses the full-source route. See the [setup and build guide](LOCAL-EDITION.md).

The official-release check reports new upstream versions; integration, testing, and custom release publication remain manual. Installers are unsigned unless signing is configured.

## Known limits

The interface does not yet include backup-version browsing, manual restoration, backup validation controls, or all advanced Ludusavi settings. Full live account sign-in, debrid downloads, Steam/Epic linking, friends/community behavior, and real achievement unlocks have not been verified in this fork. Check these before replacing an existing installation for daily use.

Older Hydra Local prototypes may require a manual upgrade using the new setup EXE. Prototype screenshots use sample backend data and earlier branding; see [screenshot details](screenshots/README.md).
