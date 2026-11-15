# Hydra + Ludusavi Integrated: setup, build, and maintenance

Hydra Ludusavi adds automatic Ludusavi backups and release-source comparison to Hydra Launcher. It retains the upstream launcher and integration code, while keeping the local-backup workflow separate from Hydra Cloud. It does not provide paid cloud services or change subscription checks.

See the [repository README](../README.md) for an overview and screenshots, and [release notes](LOCAL-RELEASE-NOTES.md) for version-specific changes.

## Repository and application identities

- **Repository:** [CedricS789/hydra](https://github.com/CedricS789/hydra).
- **Upstream:** [hydralauncher/hydra](https://github.com/hydralauncher/hydra).
- **Default branch:** `main`, currently based on official `v4.4.1`.
- **Project name:** Hydra + Ludusavi Integrated.
- **Everyday application name:** Hydra Ludusavi.
- **Descriptive name:** Hydra with Ludusavi Integrated.
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
8. Enable automatic backups and save. Launch the game through Hydra Ludusavi, make a save, quit the actual game, and check that one result and the expected backup appear after the delay.
9. Verify the sync client's upload separately, if applicable. Enable **Run at startup** and **Start minimized** in General settings only after the workflow has been checked.

Keep Hydra Ludusavi running in its tray while playing. Fully quitting it disables observation. Automatic backups start disabled and never trigger restoration.

### Add detected games to the library

Open **Settings → Save backups → Discover saved games**. **Scan local saves** runs a read-only save preview; **Find backed-up games** lists entries with versions in the selected destination. Results contain actual detected data or archives, not the entire supported-game catalogue. Saves and archives may belong to uninstalled games and do not reliably identify a launch executable.

Choose **Review entry**, then select **New entry in My Games** or an existing library game. A Steam ID reported by the save definitions uses Hydra's normal Steam library identity. Without a verified store ID, choose the real `.exe` to create a custom entry, or link to an existing entry. A Steam entry may be added without an executable for backup management; launching and automatic game-exit backups still require the real executable.

Linking preserves the existing game's shop/ID, title, playtime, achievements, and executable. Duplicate store identities and executable paths are checked before creating entries. A chosen executable fills an empty path but never replaces an existing one through this screen. Normal Steam creation follows Hydra's usual library/account behavior; discovery does not invoke a restore or change the global automatic-backup switch.

The selected canonical save name is stored as an explicit association, so library display names can differ from save definitions and archive names. **Use automatic matching** removes this association after saving settings, without deleting data or the library entry. Scan results expire after 15 minutes and must be refreshed if configuration changes. Review save detection before relying on backups, particularly when only registry settings are found.

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
git clone https://github.com/CedricS789/hydra.git hydra-ludusavi
Set-Location -LiteralPath .\hydra-ludusavi
npm install --prefix .tmp/tooling --cache .tmp/npm-cache --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
$env:ELECTRON_CACHE = Join-Path (Get-Location).Path '.tmp/electron-cache'
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

For an existing checkout, start from its root and omit cloning. `--ignore-scripts` defers native compilation to the build helper. The configuration script creates ignored `.env.production` containing public service addresses. Account credentials are not required. Review service defaults when changing the official base.

### Check the source

```powershell
node --import ./scripts/register-ts-node.mjs --test src/main/services/ludusavi-local-tracker.test.ts src/main/services/ludusavi-local-queue.test.ts src/main/services/ludusavi-local-log.test.ts src/main/services/ludusavi-local-api.test.ts src/main/services/ludusavi-local-config.test.ts src/main/services/ludusavi-local-validation.test.ts src/main/services/ludusavi-local-discovery-core.test.ts src/main/services/local-release-source.test.ts src/main/services/process-watcher-scan.test.ts src/main/services/game-running-state.test.ts
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

It uses a temporary filesystem remote and isolated Rclone configuration; it does not connect a cloud account. The checks also exercise save/archive discovery and importing/linking with an isolated in-memory library and fake account adapters. No real library or account is changed. The graphical manager's provider authentication and real service compatibility require manual testing.

Build distributables from a clean committed revision. The helper embeds `git rev-parse HEAD` for source comparison; uncommitted code cannot be represented by that revision. Publish the commit to the configured source repository before distributing the installer.

### Full source build

With the native toolchain installed:

```powershell
node scripts/build-local.cjs
```

The helper prepares native dependencies, Ludusavi, and the Epic runtime, checks TypeScript, compiles the application, builds a Windows x64 NSIS installer, and verifies the packaged result. It does not install or publish it. Prefer the helper over directly running `yarn build:local`, which skips some preparation and verification.

If the native toolchain is missing:
- Without Rust (`cargo`), the build fails with `Error: spawn cargo ENOENT`.
- Without Visual Studio C++ Build Tools, the build fails with `linker 'link.exe' not found` or `Visual C++ redistributable DLLs were not found in Build Tools`.

### Reuse matching installed native components

For application-layer or packaging changes that leave native code unchanged, first download and install the matching official Hydra release from [Official Hydra Releases](https://github.com/hydralauncher/hydra/releases) (matching `upstreamTag` in [`src/shared/local-edition.json`](../src/shared/local-edition.json), currently v4.4.1) into `%LOCALAPPDATA%\Programs\Hydra` or `%ProgramFiles%\Hydra`, then run:

```powershell
node scripts/build-local.cjs --reuse-installed-native
```

The helper checks the installed version and reuses its native addon, LevelDB binding, Ludusavi, and Epic runtime while compiling this fork's TypeScript and renderer.

If the installed official Hydra requirement is not met:
- If official Hydra is not installed in either path, the build fails with `Official Hydra was not found in %LOCALAPPDATA%\Programs\Hydra or %ProgramFiles%\Hydra. Use the full source build otherwise.`
- If the installed version does not match `upstreamTag`, the build fails with `Installed Hydra must match the exact upstream base. Use the full source build otherwise.`

The version check cannot establish that native source was left unchanged. Do not use this shortcut after native changes or an upstream-base update without separately verifying compatibility.

### Build output

After successful verification, the helper copies these files into `dist/`:

```text
hydra-ludusavi-<version>-setup.exe
hydra-ludusavi-<version>-setup.exe.blockmap
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

The browser excludes drafts and releases marked prerelease on GitHub. A version string containing `-remix.N` does not require enabling GitHub's prerelease checkbox.

### Automatic preparation for every installation

The default-branch workflow **Automatic updates from official Hydra** replaces the earlier report-only release check. It polls the latest stable official release every six hours and skips already integrated or older versions. For a new release it prepares a candidate with preserved app identity, Ludusavi hooks, display settings, and controlled workflow definitions. Independent package metadata changes are merged structurally; competing dependency or source edits stop preparation instead of selecting one side silently.

The Windows job has read-only repository permissions and no persisted checkout credentials. It installs dependencies, tests merge/conflict behavior and save guards, exercises real synthetic backup/recovery operations, compiles the application and native dependencies, verifies packaging, and checks that packaged native modules load in the matching Electron runtime. The publisher is a separate job executing the original controller revision with write permission; it validates artifact checksums, installer metadata, candidate ancestry, unchanged controlling workflows, and the expected repository revision before creating a draft, uploading assets, and publishing. Existing public releases are never replaced.

Successful publication offers one finished installer to all installed copies, including the project owner's. No user maintains a private fork or compiles locally to consume it. The workflow archives its source and fast-forwards the default branch automatically. If publication completed but the final source synchronization failed, a later check retries synchronization without replacing the published installer.

One initial installer containing the custom updater is required to bootstrap distribution; it may be distributed directly or through the optional manual release workflow. This code does not make an already distributed older EXE contain newer updater screens. An incompatible upstream change can still require a targeted repair. Failures are visible through workflow logs and the app's preparation status; users keep the working version. Public API/account compatibility is not proven by build success alone.

The schedule runs on the default branch and requires Actions to remain enabled. Public repository schedules may be disabled by GitHub after 60 days without repository activity. See [GitHub scheduling](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule). The settings show a disabled workflow rather than implying that updates are being prepared. Preparation is not instantaneous: scheduling, queues, and compilation add delay.

The tests can be run without building an installer:

```powershell
node --test scripts/automatic-upstream-release.test.mjs
node --import ./scripts/register-ts-node.mjs --test src/main/services/local-update-preparation.test.ts
```

### Run an update on demand

For the repository owner, the single entry point is:

```powershell
node scripts/update-from-official.mjs
```

Install Node.js and [GitHub CLI](https://cli.github.com/), then sign in once with `gh auth login`. The signed-in account needs Actions write access to the project. No local Rust/C++ toolchain, dependency installation, or native compilation is needed for this command. Compilation and public release publication run on GitHub using the existing workflow. Only files already pushed to the online project are used.

The command reads the online default branch and edition settings, then compares its recorded base with the latest stable official release. If already current, it exits without dispatching a build or creating a release. Otherwise it follows an active run or dispatches a new one, prints the progress URL, and waits for completion. Modern dispatch responses identify the run directly; older responses are correlated by a unique request identifier. It verifies both the finished public release's installer/update assets and the updated online project before reporting success. Workflow failures, incomplete publication, and incomplete source synchronization remain errors. Re-running can complete synchronization after publication.

```powershell
node scripts/update-from-official.mjs --check
node scripts/update-from-official.mjs --no-wait
```

`--check` is read-only. `--no-wait` requests or follows the update and prints its progress link without waiting for compilation. The normal command can re-enable an inactivity-disabled workflow, but will not override a deliberate manual disable. Waiting stops after four hours; closing the terminal or stopping the command does not cancel an already dispatched GitHub run. The local checkout is used to locate the project, while online source remains authoritative; it is not automatically pulled into a working tree with personal edits.

The existing six-hour schedule remains available alongside this entry point. Installed users do not run this script, clone the repository, sign into GitHub, or build anything. Every installed copy consumes the same finished releases through the application's update controls.

Test the entry point without dispatching a workflow:

```powershell
node --test scripts/update-from-official.test.mjs
```

## Maintain a fork

### Repository configuration

A clone of this repository uses `origin` for this fork. If `git remote -v` shows no `upstream` remote, add it once:

```powershell
git remote add upstream https://github.com/hydralauncher/hydra.git
```

When publishing from a separate fork, configure its repository consistently in `package.json`, `src/shared/local-edition.json`, and `electron-builder.yml`. The source-comparison service uses the edition repository; updater settings and published assets must point to the intended fork. Review app identifiers deliberately before making a separately installed derivative.

### Repair an adaptation or prepare a custom-only change

Compatible official updates are handled by automation. The following manual procedure is for an exception or a deliberate custom change; it is not required on each release by installed users.

Start from a clean working tree. Replace `vNEXT` below with an actual published official release tag:

```powershell
git switch main
git fetch upstream --tags
git switch -c integrate/vNEXT
git merge vNEXT
```

Resolve conflicts while preserving backup-only boundaries, process-exit evidence, queue/lock behavior, custom settings loading, updater repository, and stable application identifiers. `git merge --abort` cancels an unresolved merge; it does not undo a completed merge.

Update the version in `package.json` together with `upstreamTag` and `releaseTag` in `src/shared/local-edition.json`. For example, official `v4.4.2` can become `4.4.2-remix.1` with release tag `v4.4.2-remix.1`. Increase the remix sequence for later releases based on that same official version. Update release notes, public service defaults, resource packaging, toolchain requirements, and documentation as needed.

Run focused tests and type checks, build, and test native loading, save preview, full/differential and plain-file archives, retention, process-exit behavior, manual restoration and its snapshot, validation, advanced rules, transfers, failures, log cleanup, startup, and disabling. Separately verify account sign-in, debrid, Steam/Epic, friends/community, playtime, achievements, themes, and external upload. A clean merge and compilation do not establish service compatibility. Keep a previous installer available; downgrades do not necessarily reverse data migrations.

Commit the reviewed integration, merge it into `main`, and push. The scheduled official-release check reads the default branch; an integration branch alone does not advance its recorded base.

### Build and publish

1. Open **Actions → Build Hydra Ludusavi installer → Run workflow**. Select the tested branch and enable draft creation if a release is intended. Use a fresh version/tag; the workflow rejects an existing release tag.
2. Wait for success. Download the `Hydra-Ludusavi-Windows` artifact ZIP or review the release draft. The artifact label retains the earlier prototype wording.
3. Test the downloaded installer, source comparison, and update metadata. Confirm the EXE, blockmap, and metadata come from the same build.
4. Publish the tested draft as a normal release. Drafts and GitHub releases marked prerelease are excluded by the application's release browser.
5. Verify the installed update flow. Older Hydra Local prototypes may require manually running the new setup EXE.

The manual workflow builds native components from source; successful installer validation remains necessary. No GitHub account token is embedded in the application. Pushing source alone does not distribute an update.

The official-release workflow is scheduled every six hours, subject to GitHub scheduling, and can also be triggered on demand with `node scripts/update-from-official.mjs`. Maintainers can configure GitHub notifications for workflow failures.

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

The discovery bridge is in `ludusavi-local-discovery.ts`, with data matching in `ludusavi-local-discovery-core.ts` and interface controls in `settings-save-discovery.tsx`. It reuses Hydra's existing standard/custom library creation handlers.

## Themes

Existing theme import, CSS editing, and active-theme loading remain under **Settings → General → Appearance**. Themes can target `.local-edition` selectors to style the added panels. Those selector names are retained for compatibility. Big Picture has a separate upstream interface and has not been comprehensively restyled.
