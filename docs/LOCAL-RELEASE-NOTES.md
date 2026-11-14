# Hydra Local 4.4.1-local.1

Based on official Hydra v4.4.1. Unofficial personal fork; upstream copyright and MIT license are retained.

- Versioned backups created by Ludusavi 0.29.0 after the observed game process and captured game-directory children exit.
- Configurable destination, retention, delay, additional save paths, and tracking executables.
- Backup-only operation, a serialized queue, destination lock, history, logs, and failure notifications.
- Standard Ludusavi save detection plus common local Steam emulator save folders.
- OneDrive upload is explicitly separate from local backup completion.
- Reduced Hydra Cloud promotion; paid-service entitlement checks remain intact.
- Release-only browser and complete source snapshot comparison: official source in red, installed custom source in green.
- Manual check, download, and install controls for custom releases. Official binaries cannot replace the customization through this updater.
- Separate Hydra Local application identity and user data directory.

Backups are disabled initially. Configure and preview them before enabling automation. Hydra Local must remain running while playing.

The first locally built installer reuses unchanged native components from the installed official 4.4.1 build; TypeScript and renderer code are compiled from this fork. The GitHub build workflow compiles the native components from source.

No live account login, debrid download, Steam/Epic linking, or real in-game achievement unlock has been tested in this fork yet. Test these before replacing daily use of official Hydra.

The installer is unsigned unless a signing setup is added. The official release check reports new upstream versions; integration and a tested custom release are still required.
