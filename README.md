# Hydra Ludusavi

**Hydra Ludusavi** is a custom Windows edition of [Hydra Launcher](https://github.com/hydralauncher/hydra) with built-in [Ludusavi](https://github.com/mtkennerly/ludusavi) game save backups.

It keeps all of Hydra's launcher features—game catalogue, library management, playtime tracking, achievements, and custom themes—while adding automatic local save backups to any folder you choose (such as OneDrive, a second drive, or a NAS) without needing a subscription.

- **Want to use the app?** Follow [1. Quick Start (Install from Release)](#1-quick-start-install-from-release)
- **Want to compile it yourself?** Jump to [2. Build from Source](#2-build-from-source)

---

## 1. Quick Start (Install from Release)

### Requirements

- **Windows 10 or 11 (x64)** — nothing else to install.

### Step 1: Install the app

1. Close any running copy of Hydra from the Windows system tray.
2. Download the latest `hydra-ludusavi-*-setup.exe` from [Releases](https://github.com/CedricS789/hydra/releases) and run the installer.

> **Note:** Hydra Ludusavi uses its own data folder (`%APPDATA%\hydralauncher-local`), so it won't overwrite or interfere with an existing official Hydra installation.

### Step 2: Set up automatic save backups

1. **Add your games:** Add games to your library as usual—or open **Settings → Save backups → Discover saved games** to scan your PC for existing game saves—and make sure each game has its `.exe` path set.
2. **Pick a backup folder:** Go to **Settings → Save backups** and choose where your backups should be stored (for example, a folder inside OneDrive or on another drive).
3. **Run a quick test:** With your game closed, click **Preview save detection** and then **Back up now** to confirm your save files are detected properly.
4. **Turn on automatic backups:** Check **Enable automatic backups** and click **Save**.

From now on, whenever you close a game, Hydra Ludusavi waits a few seconds for the game process to finish and automatically backs up your saves in the background. Keep the app running in your system tray while playing.

### Updating the app

When a new official version of Hydra comes out, this repository automatically adapts and builds a matching update on GitHub. To update your installed app:

1. Open **Settings → Releases and changes**.
2. Click **Check for release updates**, then **Download** and **Install update and restart**.

### Features at a glance

- **Automatic backups on game exit:** Tracks the game `.exe` (and child processes in the game folder) and backs up saves automatically once the game closes.
- **Version history & safe restores:** Browse past save backups, inspect their files, and restore any version with a confirmation preview. Current saves are snapshotted to `.hydra-restore-safety/` before a restore runs.
- **Save discovery:** Scan your PC or existing backup folder to quickly add or link games to your Hydra library.
- **ZIP or plain-file backups:** Choose your archive format, compression, and how many full and differential versions to keep per game.
- **Full Ludusavi GUI access:** Click **Open full manager** anytime to open Ludusavi's complete native interface with your shared settings, or edit custom YAML rules directly.
- **Optional Rclone transfers:** Preview and run manual uploads/downloads to Rclone remotes if you use Rclone alongside local backups.
- **Release diff viewer:** Compare any official Hydra release against this edition directly inside **Settings → Releases and changes**.
- **Distraction-free UI:** Hides Hydra Cloud upsells and Hydra Points badges while keeping achievement unlock tracking and custom themes.

### Screenshots

![Save backup settings](docs/screenshots/save-backups.png)

![Discover saved games](docs/screenshots/discovered-games.png)

![Saved versions and management controls](docs/screenshots/saved-versions.png)

![Manual restore preview](docs/screenshots/restore-preview.png)

![Release source comparison](docs/screenshots/source-diff-prototype.png)

_(Screenshots are rendered from the settings UI using sample data; see [screenshot details](docs/screenshots/README.md).)_

### Uninstalling

Turn off automatic backups in **Settings → Save backups** (and **Run at startup** in **Settings → General**, if enabled), then uninstall **Hydra Ludusavi** from Windows **Installed apps**. Your save backup folder is never deleted when you uninstall.

---

## 2. Build from Source

You only need this section if you want to build the Windows `.exe` installer yourself or maintain the fork.

### Requirements

- **Windows 10/11 (x64)**
- **[Git](https://git-scm.com/download/win)**
- **[Node.js](https://nodejs.org/en/download)** (v22 LTS)
- **[Rust](https://www.rust-lang.org/tools/install)** and **[Visual Studio C++ Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/)**

### Step 1: Clone and install dependencies

Run these commands one at a time in PowerShell:

```powershell
git clone --branch custom/ludusavi-backups https://github.com/CedricS789/hydra.git hydra-ludusavi
Set-Location -LiteralPath .\hydra-ludusavi
npm install --prefix .tmp/tooling --cache .tmp/npm-cache --no-audit --no-fund yarn@1.22.22
node .tmp/tooling/node_modules/yarn/bin/yarn.js install --frozen-lockfile --ignore-scripts --non-interactive --cache-folder .tmp/yarn-cache
$env:ELECTRON_CACHE = Join-Path (Get-Location).Path '.tmp/electron-cache'
node node_modules/electron/install.js
node scripts/write-local-build-config.cjs
```

### Step 2: Build the installer

**Option A — Full build (compiles Rust & C++ native code):**

```powershell
node scripts/build-local.cjs
```

**Option B — Fast build without Rust/C++ (reuses official Hydra's native binaries):**

If you have the matching official Hydra version (`upstreamTag` in `src/shared/local-edition.json`) installed in `%LOCALAPPDATA%\Programs\Hydra` or `%ProgramFiles%\Hydra` and haven't modified native Rust/C++ files:

```powershell
node scripts/build-local.cjs --reuse-installed-native
```

Once the build finishes, your installer files will be in `dist/`:

```text
dist/
  hydra-ludusavi-<version>-setup.exe
  hydra-ludusavi-<version>-setup.exe.blockmap
  latest.yml
```

For testing commands and internal architecture details, see the [detailed build guide](docs/LOCAL-EDITION.md#build-on-windows).

### Maintainer tools (GitHub updates)

- **Automatic workflow:** [Automatic updates from official Hydra](https://github.com/CedricS789/hydra/actions/workflows/upstream-release-check.yml) checks for new stable official Hydra releases every 6 hours, merges them, runs the test suite, builds the Windows installer on GitHub, and publishes the new release.
- **Check for new official releases manually (read-only):**
  ```powershell
  node scripts/update-from-official.mjs --check
  ```
- **Trigger an update build on GitHub and wait for publication** (requires [GitHub CLI](https://cli.github.com/) signed in with `gh auth login`):
  ```powershell
  node scripts/update-from-official.mjs
  ```
- **Build a custom release on GitHub Actions:** run the [Build Hydra Ludusavi installer](https://github.com/CedricS789/hydra/actions/workflows/local-release.yml) workflow.

---

## Credits & License

Hydra Launcher is developed by **Los Broxas** and its [contributors](https://github.com/hydralauncher/hydra/graphs/contributors). This is an unofficial personal fork and is not affiliated with or endorsed by the upstream team.

Released under the [MIT License](LICENSE). Bundled tools such as [Ludusavi](https://github.com/mtkennerly/ludusavi) retain their own licenses.
