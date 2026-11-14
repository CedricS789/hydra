# Hydra Custom: setup, build, and maintenance

Hydra Custom adds automatic Ludusavi backups and release-source comparison to Hydra Launcher. It retains the upstream launcher and integration code, while keeping the local-backup workflow separate from Hydra Cloud. It does not provide paid cloud services or change subscription checks.

See the [repository README](../README.md) for an overview and screenshots, and [release notes](LOCAL-RELEASE-NOTES.md) for version-specific changes.

## Repository and application identities

- **Repository:** [CedricS789/hydra](https://github.com/CedricS789/hydra).
- **Upstream:** [hydralauncher/hydra](https://github.com/hydralauncher/hydra).
- **Customization branch:** `custom/ludusavi-backups`, currently based on official `v4.4.1`.
- **Application name:** Hydra Custom; full name Hydra Custom by Cédric.
- **Internal identifiers:** package `hydralauncher-local`, app ID `gg.hydralauncher.hydra.local`. Keep these stable for configuration and installer compatibility.
- **Build:** compiles the application and packages its runtime resources into an installer.
- **Release:** a published version with an installer and update metadata. A pushed source commit alone is not an application update.

## Install and configure

1. Fully exit official Hydra and earlier custom versions from their system trays. Avoid two launchers tracking the same game session.
2. Install a custom setup EXE from a published release, or build one using the instructions below. Official Hydra and this fork use separate application data; configuration is not silently copied.
3. Configure the library and each game's actual executable. Use the game process rather than a store client or a bootstrap program that immediately hands off.
4. Open **Settings → Save backups** and choose an absolute filesystem destination using **Browse**. A local drive, a folder managed by OneDrive or another sync client, or a mounted server share can be selected. This panel does not configure remote servers or cloud credentials.
5. Choose retention and the exit delay. Initial values are 10 full versions and 10 seconds.
6. Run **Preview save detection** for a game. Inspect the source paths. If necessary, add its save folders; a registry-only result is insufficient to verify game progress.
7. While the game is stopped, run **Back up now** and inspect the created archive. Verify expected save files and contents before relying on automatic backups.
8. Enable automatic backups and save. Launch the game through Hydra Custom, make a save, quit the actual game, and check that one result and the expected backup appear after the delay.
9. Verify the sync client's upload separately, if applicable. Enable **Run at startup** and **Start minimized** in General settings only after the workflow has been checked.

Keep Hydra Custom running in its tray while playing. Fully quitting it disables observation. Automatic backups start disabled and never trigger restoration.

### Save detection and process tracking

Ludusavi uses its manifest to identify saves. Available standalone roots and custom-game rules are reused where practical. The integration also discovers common Steam emulator save locations by game identifier and supports additional configured folders. It does not mirror every standalone setting.

The observer uses Hydra's library and native Windows process snapshots. It tracks exact executable paths and captured descendants within the game's executable directory. It waits after exit and checks again before backup. Failed process enumeration does not prove exit. If a bootstrap handoff is too brief to observe, configure the actual child executable as an additional tracking path.

A queue serializes and deduplicates backup tasks across games. The destination lock records the owning host, launcher process, and backup child process. A same-host stale lock is removed only when its recorded processes are demonstrably gone. Check logs before manually removing a lock, especially on shared storage.

### Results, log cleanup, and recovery

The panel shows recent results, detected paths, and file/byte/registry counts. **Open logs** opens the backup log directory. Failures generate Windows notifications where permitted; automatic retries are not implemented. Fix the cause, then retry **Back up now**.

Under **Recent backup results**, select **Clear results and logs** and confirm. This clears the entire saved history, including results beyond the 12 displayed, and removes `backup.log` and `backup.log.old`. It preserves live saves, backup archives, settings, and Ludusavi configuration. Clearing is blocked while backups or previews are queued/running and uses the same queue to avoid races. Cleanup errors appear in the panel.

History retains 50 results. Each of the two log files is capped at 2 MiB. Oversized log entries are truncated; oversized logs from older builds are discarded on the next write. This control does not clear Hydra's general application logs.

Full and differential retention are configurable, as are ZIP/plain-file format and ZIP compression. Unchanged saves need not create another version. Automatic operations never restore live saves.

### Restore a saved version

Choose a library game, **Load saved versions**, select a version, and choose **Preview files and restore**. Review the affected files and registry keys, acknowledge the overwrite, and confirm **Restore this version**. A confirmation is single-use, expires after five minutes, and is bound to the current configuration, preview, and backup mapping. Preview and cancel do not write live saves. The configured game must be stopped before confirmation succeeds.

Before restoration, Hydra checks mapped-file presence and ZIP integrity, then snapshots current affected files and registry data separately. A failure in either step stops the restore. Snapshots with existing data are retained under `.hydra-restore-safety/<operation-id>/` in the selected backup destination. They are outside normal retention and are not automatically pruned. If native restoration partially fails, use the snapshot for deliberate recovery; the operation is not transactional.

**Validate selected version** checks mapping structure, declared-file presence, simple-format file sizes, and ZIP integrity through bundled 7-Zip. It does not extract into live saves or prove the save is usable in the game.

### Advanced rules and complete native controls

**Advanced rules and full manager** provides a YAML editor, an import from standalone settings, and **Open full manager**. The native executable validates the edited configuration before it is saved; one previous advanced configuration is kept. Roots, custom file and registry entries, exclusions, redirects, secondary manifests, compression levels, and provider settings remain available. Hydra's destination, full/differential retention, format, and compression controls override the matching YAML fields. Implicit engine cloud synchronization is disabled for launcher operations.

The full manager opens bundled Ludusavi with the shared configuration, including detection rules for the selected library game. It exposes the complete native GUI, including backup comments, locks, removal, exclusions, native validation, and provider setup. Close it to read back settings and resume Hydra's queue. Games must be stopped when opening it; keep them stopped while using native restore controls. Native-window operations use that tool's own workflow and do not use Hydra's approval tokens or extra pre-restore snapshots.

### Manual remote transfers

Install/configure Rclone separately to use engine-managed remote transfers. A normal OneDrive folder destination requires only the OneDrive client and does not need Rclone.

Configure the provider through the full manager, or configure an existing Rclone remote in advanced YAML. For example:

```yaml
apps:
  rclone:
    path: C:/Tools/rclone/rclone.exe
    arguments: ""
cloud:
  remote:
    Custom:
      id: my-private-remote
  path: GameBackups
  synchronize: false
```

Keep provider credentials in Rclone's own configuration, not the repository. Select a library game and use **Preview remote upload** or **Preview remote download**, review the changed archive paths, then explicitly confirm. Upload replaces that game's remote backup set; download replaces its local backup set. Versions missing from the source may be removed. Downloading archives does not restore live saves, and no transfer runs automatically from Hydra. A new preview is required after settings or the current transfer plan changes.

Local backups, manual remote transfers, and an external folder-sync client's uploads have distinct completion states. Successful local Rclone-remote tests do not verify a real account, provider authentication, or server permissions.

### Disable and uninstall

Uncheck automatic backups and save. Turn off **Run at startup** in General settings to disable Windows startup. Uninstall through Windows Installed apps. The external backup destination is not deleted by this feature. Application data is stored separately from backup archives.

## Build on Windows

### Prerequisites

- Windows x64 and Git.
- Node.js and Yarn Classic 1.22.22. The [Windows workflow](../.github/workflows/local-release.yml) pins Node.js 22.21.0 and uses a `windows-2022` runner.
- For a full native build: stable Rust with the Windows MSVC toolchain, compatible Visual Studio C++ Build Tools, a Windows SDK, and Visual C++ redistributable components used during packaging.

Native toolchain availability must be checked on the build machine. Installing Node.js alone is insufficient for a full native build. Full native builds and resulting installers need runtime verification; the workflow definition alone is not proof of a successful release.

Project-local scratch files, logs, downloads, and caches belong under `.tmp/`. Installed dependencies and packaged runtime resources are build inputs rather than temporary files.

### Clone and prepare

Run these commands in PowerShell, proceeding only when each command succeeds:

```powershell
git clone --branch custom/ludusavi-backups https://github.com/CedricS789/hydra.git hydra-custom
Set-Location -LiteralPath .\hydra-custom
npm install --prefix .tmp/tooling --cache .tmp/npm-cache --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
$env:ELECTRON_CACHE = Join-Path (Get-Location).Path '.tmp/electron-cache'
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

For an existing checkout, start from its root and omit cloning. `--ignore-scripts` defers native compilation to the build helper. The configuration script creates ignored `.env.production` containing public service addresses. Account credentials are not required. Review service defaults when changing the official base.

### Check the source

```powershell
node --import ./scripts/register-ts-node.mjs --test src/main/services/ludusavi-local-tracker.test.ts src/main/services/ludusavi-local-queue.test.ts src/main/services/ludusavi-local-log.test.ts src/main/services/ludusavi-local-api.test.ts src/main/services/ludusavi-local-config.test.ts src/main/services/ludusavi-local-validation.test.ts src/main/services/local-release-source.test.ts src/main/services/process-watcher-scan.test.ts src/main/services/game-running-state.test.ts
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.node.json --composite false
node node_modules/typescript/bin/tsc --noEmit -p tsconfig.web.json --composite false
git status --short
```

Run the isolated real-tool checks after dependencies are prepared:

```powershell
node scripts/postinstall.cjs
node scripts/test-save-manager-integration.mjs
```

The checks use synthetic saves and an isolated profile under `.tmp/`, leaving real game saves unchanged. They exercise ZIP, differential and plain-file backups, version listing, previews, validation/corruption handling, restore guards, explicit restoration, and the pre-restore snapshot. Fixtures are retained under `.tmp/` for inspection. An optional local-remote transfer check can use an existing Rclone executable:

```powershell
node scripts/test-save-manager-integration.mjs --rclone C:/Tools/rclone/rclone.exe
```

It uses a temporary filesystem remote and isolated Rclone configuration; it does not connect a cloud account. The graphical manager's provider authentication and real service compatibility require manual testing.

Build distributables from a clean committed revision. The helper embeds `git rev-parse HEAD` for source comparison; uncommitted code cannot be represented by that revision. Publish the commit to the configured source repository before distributing the installer.

### Full source build

With the native toolchain installed:

```powershell
node scripts/build-local.cjs
```

The helper prepares native dependencies, Ludusavi, and the Epic runtime, checks TypeScript, compiles the application, builds a Windows x64 NSIS installer, and verifies the packaged result. It does not install or publish it. Prefer the helper over directly running `yarn build:local`, which skips some preparation and verification.

### Reuse matching installed native components

For application-layer or packaging changes that leave native code unchanged:

```powershell
node scripts/build-local.cjs --reuse-installed-native
```

This route requires official Hydra installed at `%LOCALAPPDATA%\Programs\Hydra` with the exact version specified by `upstreamTag` in `src/shared/local-edition.json`, currently v4.4.1. The helper checks that version and reuses its native addon, LevelDB binding, Ludusavi, and Epic runtime while compiling this fork's TypeScript and renderer.

The version check cannot establish that native source was left unchanged. Do not use this shortcut after native changes or an upstream-base update without separately verifying compatibility.

### Build output

After successful verification, the helper copies these files into `dist/`:

```text
hydra-custom-<version>-setup-customized-by-cédric.exe
hydra-custom-<version>-setup-customized-by-cédric.exe.blockmap
latest.yml
```

Packaging intermediates remain under `.tmp/package`. Keep the installer, blockmap, and metadata from the same build together. Failed builds can leave older files in `dist/`; check the command result rather than assuming files are current.

The verifier checks application identity, required native resources, and exclusion of local scratch/configuration files from the package. The helper restricts the environment passed to build subprocesses. These checks do not replace native loading and runtime tests. Signing is not configured by default.

## Release updates and source comparison

Open the title-bar version or **Settings → Releases and changes**.

- **Check for release updates** checks the configured custom repository, not the official installer's feed.
- **Download** retrieves a rebuilt custom installer. **Install update and restart** is blocked while tracked games or backups are active.
- Select an official published release, choose **See changes (+/−)**, and select a file. Red is the official snapshot; green is the installed custom snapshot. The comparison uses complete source snapshots rather than commit history or a merge-base diff.
- The view retrieves up to 30 releases. Binary files and text above 1 MB have no text preview. Internet access is required, GitHub API limits apply, and the embedded custom source revision must be available in the configured repository.

The browser excludes drafts and releases marked prerelease on GitHub. A custom version string containing `-rev.N` does not require enabling GitHub's prerelease checkbox.

## Maintain a fork

### Repository configuration

A clone of this repository uses `origin` for this fork. If `git remote -v` shows no `upstream` remote, add it once:

```powershell
git remote add upstream https://github.com/hydralauncher/hydra.git
```

When publishing from a separate fork, configure its repository consistently in `package.json`, `src/shared/local-edition.json`, and `electron-builder.yml`. The source-comparison service uses the edition repository; updater settings and published assets must point to the intended fork. Review app identifiers deliberately before making a separately installed derivative.

### Integrate an official release

Start from a clean working tree. Replace `vNEXT` below with an actual published official release tag:

```powershell
git switch custom/ludusavi-backups
git fetch upstream --tags
git switch -c integrate/vNEXT
git merge vNEXT
```

Resolve conflicts while preserving backup-only boundaries, process-exit evidence, queue/lock behavior, custom settings loading, updater repository, and stable application identifiers. `git merge --abort` cancels an unresolved merge; it does not undo a completed merge.

Update the version in `package.json` together with `upstreamTag` and `releaseTag` in `src/shared/local-edition.json`. For example, official `v4.4.2` can become custom `4.4.2-rev.1` with release tag `v4.4.2-rev.1`. Increase the revision for subsequent custom releases of that base. Update release notes, public service defaults, resource packaging, toolchain requirements, and documentation as needed.

Run focused tests and type checks, build, and test native loading, save preview, full/differential and plain-file archives, retention, process-exit behavior, manual restoration and its snapshot, validation, advanced rules, transfers, failures, log cleanup, startup, and disabling. Separately verify account sign-in, debrid, Steam/Epic, friends/community, playtime, achievements, themes, and external upload. A clean merge and compilation do not establish service compatibility. Keep a previous installer available; downgrades do not necessarily reverse data migrations.

Commit the reviewed integration, merge it into `custom/ludusavi-backups`, and push. The scheduled official-release check reads the default branch; an integration branch alone does not advance its recorded base.

### Build and publish

1. Open **Actions → Build Hydra Custom installer → Run workflow**. Select the tested branch and enable draft creation if a release is intended. Use a fresh version/tag; the workflow rejects an existing release tag.
2. Wait for success. Download the `Hydra-Local-Windows` artifact ZIP or review the release draft. The artifact label retains the earlier prototype wording.
3. Test the downloaded installer, source comparison, and update metadata. Confirm the EXE, blockmap, and metadata come from the same build.
4. Publish the tested draft as a normal release. Drafts and GitHub releases marked prerelease are excluded by the application's release browser.
5. Verify the installed update flow. Older Hydra Local prototypes may require manually running the new setup EXE.

The manual workflow builds native components from source; successful installer validation remains necessary. No GitHub account token is embedded in the application. Pushing source alone does not distribute an update.

The official-release check is scheduled every six hours, subject to GitHub scheduling, and reports when integration is needed. It never automatically merges, publishes, or installs an official build. Maintainers can configure GitHub notifications for workflow failures.

## Source map

| Location                                                            | Responsibility                                                                         |
| ------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `src/main/services/ludusavi-local.ts`                               | Settings, Ludusavi invocation, destination locks, results, cleanup, and notifications. |
| `src/main/services/ludusavi-local-tracker.ts`                       | Process lifecycle evidence and exit delay.                                             |
| `src/main/services/ludusavi-local-queue.ts`                         | Serial, deduplicated operations.                                                       |
| `src/main/services/ludusavi-local-log.ts`                           | Bounded log storage and scoped log cleanup.                                            |
| `src/main/services/local-releases.ts` and `local-release-source.ts` | Published release data, source snapshots, and update controls.                         |
| `src/renderer/src/pages/settings/settings-ludusavi.tsx`             | Backup controls and history.                                                           |
| `src/renderer/src/pages/settings/settings-local-releases.tsx`       | Release browser and inline diff.                                                       |
| `src/shared/local-edition.json`                                     | Fork identity, upstream base, and release tag.                                         |
| `scripts/build-local.cjs` and `verify-local-package.cjs`            | Build preparation, packaging, and verification.                                        |

Additional management modules are `ludusavi-local-manager.ts` (version/restore/transfer/native-window operations), `ludusavi-local-config.ts` (managed configuration), `ludusavi-local-lock.ts` (destination ownership), `ludusavi-local-validation.ts` (non-extracting checks), and `ludusavi-local-api.ts` (response handling and expiring confirmations). The added interface is `settings-save-manager.tsx`.

## Themes

Existing theme import, CSS editing, and active-theme loading remain under **Settings → General → Appearance**. Themes can target `.local-edition` selectors to style the added panels. Those selector names are retained for compatibility. Big Picture has a separate upstream interface and has not been comprehensively restyled.
