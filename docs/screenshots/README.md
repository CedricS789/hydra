# Custom settings screenshots

These PNGs are unaltered captures of the fork's actual React settings components, rendered in an isolated, hidden Electron test window. The capture script is the local development artifact `.tmp/ui-smoke.cjs`; it used an isolated test profile and a local development server with a sample Electron bridge. The installed Hydra application and the user's desktop were not captured.

| Image                            | Original local capture     | What it demonstrates                                                                         |
| -------------------------------- | -------------------------- | -------------------------------------------------------------------------------------------- |
| `ludusavi-backups-prototype.png` | `.tmp/ui-backups.png`      | Destination, retention, delay, Hydra library game selection, and extra save-folder controls. |
| `releases-prototype.png`         | `.tmp/ui-releases.png`     | Custom release controls, official release selection, and the source comparison area.         |
| `source-diff-prototype.png`      | `.tmp/ui-release-diff.png` | The rendered Monaco inline red/green source comparison with synthetic example code.          |

## Scope and limitations

- The captures predate rebranding. They retain the name **Hydra Local** and version **4.4.1-local.1**. Current source uses **Hydra Custom** and **4.4.1-rev.2**.
- Games, settings, release lists, status text, and diff contents were supplied by the interface-test fixture. They do not establish live account access, published release availability, a successful backup, or completed cloud synchronization.
- In particular, the diff is not actual official Hydra source. It tests display behavior only. The normal comparison service retrieves real source snapshots from GitHub.
- The images are settings-panel captures, not full launcher-window screenshots. Lower controls may extend below the captured viewport.
- No installer was built or installed to add these images to the documentation. Replace them with captures from a tested current build when one is available, and update these notes at the same time.

The files were copied without image editing so the original capture remains distinguishable from the current source and its verification status.
