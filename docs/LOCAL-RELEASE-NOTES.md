# Hydra + Ludusavi Integrated — 4.4.1-rev.2

Based on official Hydra v4.4.1. This is an unofficial fork; upstream copyright and the MIT license are retained. These notes describe the source version. Installer availability is listed on the repository's published releases page.

## Features

- Project renamed **Hydra + Ludusavi Integrated**, displayed as **Hydra Ludusavi** in everyday UI and described as **Hydra with Ludusavi Integrated**.
- Subscription-linked Hydra Points counters, locked placeholders, and score badges are hidden in achievement lists, comparisons, profiles, and Big Picture. Unlock tracking and stored scoring data are preserved.

- Versioned backups created by bundled Ludusavi 0.29.0 after the observed game and captured game-directory child processes exit.
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
- Installer filename `hydra-ludusavi-4.4.1-rev.2-setup.exe`.

- Everyday labels use **Save backups**, with Ludusavi credited in settings. The game-page shortcut preselects the library game.
- Version browsing, file/registry restore previews, explicit expiring confirmation, stopped-game checks, selected-version validation, and a separate pre-restore snapshot.
- Native-validated advanced YAML and standalone-rule import; the complete bundled graphical manager is available with shared configuration. Closing it reads back settings and resumes queued operations.
- Manual Rclone upload/download previews and confirmations, with remote completion recorded separately from local backup completion. No automatic download or restoration is enabled.

- **Discover saved games** scans local save data or existing archives and offers explicit **Add to My Games** / **Link save entry** controls. Verified Steam IDs use the normal Steam identity; other new entries require a chosen executable and use custom-game handling.
- Linking keeps existing identity, playtime, achievements, title, and executable, while storing the canonical save association for future backups and recovery. Duplicate IDs/paths and stale scan results are checked. No executable is guessed from a save folder, and the global automatic-backup setting is preserved.

## Setup and build

Backups start disabled. Configure a destination, preview detection, inspect an archive, and verify a real game-exit backup before enabling everyday automation. Keep Hydra Ludusavi running while playing. No automatic restoration is provided.

The build helper supports full native compilation and optional reuse of unchanged native components from an exactly matching official Hydra installation. The GitHub Windows workflow uses the full-source route. See the [setup and build guide](LOCAL-EDITION.md).

The official-release check reports new upstream versions; integration, testing, and custom release publication remain manual. Installers are unsigned unless signing is configured.

## Known limits

Specialist controls such as backup comments, locks, deletion, provider setup, and the complete engine GUI remain in **Open full manager** rather than being recreated as individual Hydra forms. Native-window operations use their own confirmations and do not add Hydra's extra pre-restore snapshot. Pre-restore snapshots created by Hydra are not automatically pruned. Validation checks metadata, presence, sizes for plain files, and ZIP integrity; it does not establish save usability.

Rclone is configured separately. Isolated local-remote tests do not verify a cloud account or private server. Full live sign-in, debrid downloads, Steam/Epic linking, friends/community behavior, real achievement unlocks, and native provider authentication still need manual verification.

Older Hydra Local prototypes may require a manual upgrade using the new setup EXE. Screenshots use sample backend data; see [screenshot details](screenshots/README.md).
