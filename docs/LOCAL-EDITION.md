# Hydra Custom: setup, development, and updates

This personal fork adds automatic **Ludusavi** backups to Hydra. It retains the upstream launcher and integration code. It does not provide Hydra Cloud services or change subscription checks.

## What a fork, clone, branch, build, and release mean

- **Fork:** `CedricS789/hydra`, your repository on GitHub.
- **Clone:** `C:\Users\sipak\projects\Custom Game Launcher - Hydra by Los Broxas - ChatGPT`, the working directory on this PC.
- **Branch:** `custom/ludusavi-backups`, our changes based on official v4.4.1. `upstream` points to the developer's repository; `origin` points to yours.
- **Build:** compile TypeScript and React into JavaScript, then package it with Electron and its native resources into a Windows installer.
- **Release:** a versioned, published installer. Merely pushing a commit does not create an app update.

## Install and configure

1. Exit official Hydra and any earlier custom build from the system tray, then run the Hydra Custom setup EXE. Its installation identity and user data folder differ from official Hydra. Keep official Hydra available while testing.
2. Open Hydra Custom. Sign in normally if you want account features. Existing accounts and third-party integrations must be tested; configuration is not silently copied from the official app.
3. Add or synchronize your library. For 007 First Light, use `C:\Games\007.First.Light\Retail\007FirstLight.exe` as its actual executable.
4. Open **Settings → Ludusavi backups**. Choose `C:\Cloud\OneDrive\Games Data\ludusavi-backup`. Retain 10 full versions and leave a 10-second exit delay.
5. Select 007 First Light and run **Preview save detection**. Its current local save folder is `C:\Users\Public\Documents\Steam\RUNE\3768760`; the integration auto-discovers that common location. Add it under additional save folders if needed. Verify that profile and slot `data.save` files appear. A registry-only result does not prove that progress is backed up.
6. Click **Back up now** while the game is stopped. Inspect the output and the backup archive before enabling automatic backups. Do not restore anything for this test.
7. Enable automatic backups and save settings. Launch through Hydra Custom, make a save, and quit the actual game. A result should appear after the exit delay. Keep Hydra Custom running in its tray; fully quitting the launcher disables observation.
8. Check the OneDrive client separately. Local backup completion does not mean upload completion.
9. After the live test passes, enable **Run at startup** and **Start minimized** under General settings. This uses Hydra's existing Windows startup integration.

Backups never trigger a restore. The service invokes bundled Ludusavi with `--no-cloud-sync`, ZIP format, the selected destination, and full/differential retention limits. Configuration for this feature is separate from Hydra Cloud and standalone Ludusavi. Standalone root and custom-game rules are reused where practical.

## Processes and games

The observer reuses Hydra's library and native Windows process snapshots. It tracks exact executable paths and captured descendants within a game's executable directory. It waits after their exit and checks again immediately before backup. A failed process scan does not prove an exit. Bootstrap programs that hand off too quickly to observe should have the real child executable entered under additional tracking paths. Store launchers should not be entered as game executables.

The queue admits only one backup writer across games. A lock in the destination also protects against another Hydra Custom process using the same folder. After a crash, a same-PC stale lock can be removed automatically only if its owner process is demonstrably gone. Check the log before removing any lock manually, particularly across multiple PCs.

## Failures, versions, and disabling

Settings shows recent results and source paths; **Open logs** opens the log folder. Failed attempts generate Windows notifications, subject to Windows notification settings. A failure can be retried with Back up now after fixing the cause. Automatic retries are not currently implemented.

Ludusavi retains up to the configured number of changed full backups; unchanged saves do not require another version. To recover a version, inspect it in standalone Ludusavi and perform a deliberate manual restore while the game is stopped. There is no automatic restore path in this feature.

To disable automation, uncheck automatic backups and save. To stop startup, turn off Run at startup in General. Uninstall Hydra Custom through Windows Installed apps. Your external backup destination is not deleted by this feature. Keep its separate user data directory if you want the history and configuration.

## Release updates and source comparison

Click the title-bar version, or open **Settings → Releases and changes**.

- **Check for release updates** checks our custom releases, not the official installer's feed.
- **Download** fetches a rebuilt custom installer. **Install update and restart** refuses while tracked games or backups are active.
- Select an **official published release**, then choose **See changes (+/−)** and a file. Red is the official snapshot; green is the installed custom snapshot. This is a direct file-tree comparison, not a commit history or merge-base diff.
- GitHub provides at most the 30 latest releases in this view. Binary files and text files above 1 MB have no text preview. Source comparison needs Internet access and is subject to GitHub API limits. The installed source revision must have been pushed to the fork.

An official Hydra release is not automatically a compatible customized installer. The scheduled GitHub workflow checks every six hours and fails visibly if integration is needed. It does not blindly merge, publish, or install official builds. A custom release is built and tested separately.

## Rebuild on this PC

The development prerequisites are Node.js and Yarn, with Rust and Windows C++ tools for a full native build. All scratch logs and caches belong in `.tmp/`. Installed dependencies and packaged runtime resources are normal build inputs, not scratch files.

From this repository, install locked dependencies with Yarn 1.22.22. The one-time manual preparation is:

```powershell
npm install --prefix .tmp/tooling --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

Commit the source before building a distributable: source comparison embeds `git rev-parse HEAD`, so a dirty build cannot faithfully represent that published revision.

For the initial build, whose native source is unchanged and whose base exactly matches installed official Hydra 4.4.1:

```powershell
node scripts/build-local.cjs --reuse-installed-native
```

This verifies the installed Hydra version and reuses its native addon, classic-level binding, Ludusavi, and Epic runtime. It still compiles this fork's TypeScript/React. The native addon and LevelDB binding were smoke-tested under the bundled Electron version. Do not use this shortcut after changing native code or updating the official base.

For a complete source build on a correctly provisioned machine:

```powershell
node scripts/build-local.cjs
```

The final EXE appears under `dist/`. Packaging intermediates stay under `.tmp/package` and only the installer and update metadata are copied to `dist/` after verification. The build verifies that the package excludes `.tmp`, local environment files, and TypeScript build metadata before it can be distributed. The build script gives child processes a restricted environment so unrelated credentials are not inherited by verbose build tools. The initial artifact is unsigned; add a deliberate signing configuration before distributing widely.

## Integrate a new official release

```powershell
git switch custom/ludusavi-backups
git fetch upstream --tags
git switch -c integrate/vNEXT
git merge vNEXT
```

Replace `vNEXT` with an actual published release tag. Resolve source conflicts deliberately. Preserve the local edition identity, updater repository, local UI loading, and backup-only boundaries. Update `src/shared/local-edition.json` and `package.json` together: for example official v4.4.2 becomes custom `4.4.2-rev.1` and tag `v4.4.2-rev.1`. Custom versions use a prerelease number so repeated customized releases of the same official base can be ordered.

Run type checks, targeted tests, native smoke tests, a backup preview/content check, and the live game-exit test. Test account login, debrid, Steam/Epic, friends, playtime, and achievements before switching daily use. A clean merge and a successful compilation do not prove service compatibility.

Push the tested source, then run **Build Hydra Custom installer** from GitHub Actions. That workflow builds Windows native code and creates a reviewable release draft. Check its installer and release notes, then publish it. The app updater sees published releases, not drafts. The first release must be published before the update feed can serve installers. No GitHub account token is embedded in the application.

## Main source locations

- `src/main/services/ludusavi-local.ts`: settings, Ludusavi invocation, locks, results, and failure reporting.
- `src/main/services/ludusavi-local-tracker.ts`: process lifecycle evidence and exit delay.
- `src/main/services/ludusavi-local-queue.ts`: serialized, deduplicated tasks.
- `src/main/services/local-releases.ts`: published releases, source blobs, and custom update controls.
- `src/main/services/local-release-source.ts`: direct source-tree comparison.
- `src/renderer/src/pages/settings/settings-ludusavi.tsx`: backup controls.
- `src/renderer/src/pages/settings/settings-local-releases.tsx`: release browser and inline red/green source diff.
- `src/shared/local-edition.json`: upstream base and fork identity.

Hydra Cloud promotion is suppressed in common desktop entry points; backend subscription checks remain intact. Big Picture has its own upstream interface and has not been comprehensively restyled in this first version.

## Themes and naming

The full edition name is **Hydra Custom by Cédric**. Normal application UI uses **Hydra Custom**; the full name appears in formal installer details and the version tooltip. Internal identifiers remain stable to preserve prototype configuration.

Theme management is under Settings → General → Appearance. Importing themes, editing CSS, saving themes, and loading an active theme are retained. Custom themes can target the new `.local-edition` selectors to style the additional panels. These internal selector names are kept stable for theme compatibility.
