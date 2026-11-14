# Custom settings screenshots

The PNGs are unaltered captures of actual React settings components rendered in an isolated Electron interface test with sample backend responses. They are panel captures, not screenshots of an installed current release.

| Image                       | Scope                                                                                              |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `save-backups.png`          | Current Save backups settings, engine credit, destination, retention, formats, and game selection. |
| `discovered-games.png`      | Current discovery component and library add/link review using synthetic entries, IDs, and paths.   |
| `saved-versions.png`        | Current version selection, validation/recovery buttons, advanced/remote sections, and log cleanup. |
| `restore-preview.png`       | Current affected-file preview and disabled restore confirmation before acknowledgement.            |
| `source-diff-prototype.png` | Historical source-comparison display test with synthetic example code and earlier branding.        |

Example Game, paths, versions, statuses, and code comparisons are synthetic. They do not establish account access, published release availability, actual game backup success, or completed cloud synchronization. The current settings captures use Hydra Ludusavi source version `4.4.1-rev.2`. The historical source-diff capture retains Hydra Local prototype wording; normal comparison retrieves real source snapshots.

The remaining `*-prototype.png` files are historical captures from earlier interface tests. Controls may extend below each captured viewport. No personal desktop was captured, and no installer was built or installed to create these images.

Real backup/restore and local Rclone-remote behavior are checked separately by isolated integration tests. Update these notes when replacing screenshots, and preserve clear labels for test data.
