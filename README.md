# Hydra + Ludusavi Integrated

A Windows game launcher based on [Hydra Launcher by Los Broxas](https://github.com/hydralauncher/hydra), with automatic [Ludusavi](https://github.com/mtkennerly/ludusavi) save backups to a folder you control.

It keeps Hydra's catalogue, library, launcher, playtime tracking, achievements, and themes, while adding integrated save backups, version previews/restores, game discovery, and automatic updates adapted from official Hydra releases. Inside the app, it displays as **Hydra Ludusavi**.

**Current version:** `4.4.1-remix.2` (based on official Hydra `v4.4.1`).

- **Just want to install and use the launcher?** Start at [Quick Start: install from release](#quick-start-install-from-release).
- **Want to compile the installer yourself or maintain the fork?** Jump to [Build from source](#build-from-source).

---

## Quick Start: install from release

### Requirements

- **Windows 10/11 (x64)** — no Git, Node.js, Rust, Visual Studio, or official Hydra installation is needed.

### Install and set up backups

1. **Download and install** `hydra-ludusavi-4.4.1-remix.2-setup.exe` from [Releases](https://github.com/CedricS789/hydra/releases).
   - Exit any running Hydra instance from the system tray before installing.
   - This edition uses its own app data folder (`%APPDATA%\hydralauncher-local`) and does not modify your official Hydra installation.
2. **Add your games** normally or via **Settings → Save backups → Discover saved games**, and set each game's real `.exe` path.
3. **Choose a backup folder** in **Settings → Save backups** (a local drive, a OneDrive/cloud-synced folder, or a mounted network share).
4. **Test a backup first:** keep the default retention (10 full versions) and exit delay (10 seconds) or adjust them, click **Preview save detection**, then click **Back up now** while the game is closed. Check the created archive to confirm actual save files were captured (not only registry keys).
5. **Enable automatic backups** and save. Launch a game, save your progress, quit the game, and verify the new backup appears after the delay. Keep **Hydra Ludusavi** running in the system tray while playing.

> Automatic backups start disabled, never overwrite live saves automatically, and do not require a Hydra Cloud subscription. If you use OneDrive or another sync client, check its upload status separately.

### Updating the installed app

Open **Settings → Releases and changes** inside the app to check for, download, and install new releases. When official Hydra publishes a new stable version, this repository's GitHub Actions workflow adapts and publishes a ready-to-install update automatically—you never need to compile updates yourself.

### Uninstall

1. Disable automatic backups in **Settings → Save backups** (and **Run at startup** in General settings if enabled).
2. Uninstall **Hydra Ludusavi** via Windows **Installed apps**. Your save backup folder is never deleted.

### What's included

- **Automatic save backups:** Watches the configured game `.exe` (and child processes in the game folder), waits for the exit delay, rechecks that the game is closed, and runs bundled Ludusavi `0.29.0` in a serialized queue.
- **Flexible formats & retention:** ZIP or plain-file backups, configurable compression, and full + differential version retention.
- **Save discovery:** **Scan local saves** or **Find backed-up games** to add missing games to **My Games** or link them to existing entries.
- **Version browser & safe restore:** Inspect backed-up files/registry keys, validate ZIP integrity, and manually restore a version after an explicit overwrite confirmation. Hydra saves a safety snapshot under `.hydra-restore-safety/<operation-id>/` before restoring.
- **Advanced YAML & full manager:** Edit Ludusavi YAML rules directly or click **Open full manager** to launch Ludusavi's full GUI with shared settings.
- **Manual remote transfers:** Preview and run manual Rclone uploads/downloads (Rclone must be configured separately).
- **In-app updates & source diff:** Check, download, and install updates in **Settings → Releases and changes**, or compare source changes against official Hydra releases.
- **Clean UI:** Keeps Hydra themes and achievement unlock tracking while hiding Hydra Cloud promotions and Hydra Points counters.

### Screenshots

These captures show the interface rendered with sample data (see [screenshot details](docs/screenshots/README.md)):

#### Save backup settings

![Save backup settings with sample data](docs/screenshots/save-backups.png)

#### Discover saved games

![Discovery results and explicit library add/link controls with sample data](docs/screenshots/discovered-games.png)

#### Saved versions and cleanup

![Saved versions and management controls with sample data](docs/screenshots/saved-versions.png)

#### Manual restore preview

![Manual restore preview with confirmation disabled until acknowledged](docs/screenshots/restore-preview.png)

#### Release source comparison

![Historical prototype source comparison with synthetic example code](docs/screenshots/source-diff-prototype.png)

---

## Build from source

Use this section only if you want to compile the Windows installer yourself or maintain the repository.

### Build requirements

- **Windows 10/11 (x64)**
- **[Git](https://git-scm.com/download/win)**
- **[Node.js](https://nodejs.org/en/download)** (v22 LTS)
- **[Rust](https://www.rust-lang.org/tools/install)** and **[Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)**

### Clone and build the installer

Run these commands one by one in PowerShell (wait for each to finish before running the next):

```powershell
git clone --branch custom/ludusavi-backups https://github.com/CedricS789/hydra.git hydra-ludusavi
Set-Location -LiteralPath .\hydra-ludusavi
npm install --prefix .tmp/tooling --cache .tmp/npm-cache --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
$env:ELECTRON_CACHE = Join-Path (Get-Location).Path '.tmp/electron-cache'
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

Build the installer with the full native toolchain:

```powershell
node scripts/build-local.cjs
```

**Faster shortcut (no Rust/C++ required):** if official Hydra `v4.4.1` is already installed in `%LOCALAPPDATA%\Programs\Hydra` or `%ProgramFiles%\Hydra` and you haven't changed native Rust/C++ code, reuse its native files:

```powershell
node scripts/build-local.cjs --reuse-installed-native
```

When finished, the installer and update metadata are placed in `dist/`:

```text
dist/
  hydra-ludusavi-4.4.1-remix.2-setup.exe
  hydra-ludusavi-4.4.1-remix.2-setup.exe.blockmap
  latest.yml
```

See the [build & architecture guide](docs/LOCAL-EDITION.md#build-on-windows) for tests, internal identifiers, and troubleshooting.

### Maintainer commands and GitHub automation

- [Automatic updates from official Hydra](https://github.com/CedricS789/hydra/actions/workflows/upstream-release-check.yml) runs every 6 hours on GitHub Actions to detect new stable official Hydra releases, merge changes, run tests, compile on Windows, and publish the updated installer.
- **Check update status from your checkout (read-only):**
  ```powershell
  node scripts/update-from-official.mjs --check
  ```
- **Trigger and wait for an official-release update on GitHub** (requires [GitHub CLI](https://cli.github.com/) signed in with `gh auth login`):
  ```powershell
  node scripts/update-from-official.mjs
  ```
- **Build a release from the current branch on GitHub Actions:** run [Build Hydra Ludusavi installer](https://github.com/CedricS789/hydra/actions/workflows/local-release.yml).

---

## Credits and license

Hydra Launcher is created by **Los Broxas** and its [contributors](https://github.com/hydralauncher/hydra/graphs/contributors). This unofficial fork is not maintained or endorsed by the upstream developers.

Hydra retains its [MIT License](LICENSE). Ludusavi and other bundled tools retain their respective licenses.
