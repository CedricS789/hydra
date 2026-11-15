# Custom settings screenshots

The PNGs are unaltered captures of actual React settings components rendered in an isolated Electron interface test with sample backend responses. They are panel captures, not screenshots of an installed current release.

| Image                       | Scope                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `save-backups.png`          | Current cards for automatic backups, discovery, and game management, with the advanced drawer collapsed. |
| `discovered-games.png`      | Current one-click and bulk library imports with synthetic Steam/Epic/custom entries and placeholder artwork. |
| `discovery-progress.png`    | Current native scan progress display using sample titles and completed-step counts. |
| `saved-versions.png`        | Earlier layout showing version selection, validation/recovery, remote controls, and log cleanup. |
| `restore-preview.png`       | Earlier layout showing affected files and disabled restore confirmation before acknowledgement. |
| `source-diff-prototype.png` | Historical source-comparison display test with synthetic example code and earlier branding.        |

Example Game, paths, versions, statuses, and code comparisons are synthetic. They do not establish account access, published release availability, actual game backup success, or completed cloud synchronization. The current settings captures use Hydra Ludusavi source version `4.4.1-remix.2`. The historical source-diff capture retains Hydra Local prototype wording; normal comparison retrieves real source snapshots.

The remaining `*-prototype.png` files are historical captures from earlier interface tests. Controls may extend below each captured viewport. No personal desktop was captured, and no installer was built or installed to create these images.

Real backup/restore and local Rclone-remote behavior are checked separately by isolated integration tests. Update these notes when replacing screenshots, and preserve clear labels for test data.
