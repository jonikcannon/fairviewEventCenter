# Media Migration Skill: Google Drive Upload with Duplicate Detection

## Purpose
Safely migrate media files from local `/storage/uploads` to Google Drive while preventing duplicate uploads and preserving folder structure.

## Key Features

### 1. Duplicate Detection
- **Filename-based detection**: Checks if a file with the same name exists in the target Google Drive folder
- **Folder-aware checking**: Compares files in the same directory structure (e.g., `aerial/photo.jpg` vs `aerial/photo.jpg`)
- **Status**: Returns `skipped-duplicate` if file already exists with same name
- **Report**: Documents which files were skipped and why

### 2. Folder Structure Preservation
- **Recursive scanning**: Lists all files from nested subdirectories in `/storage/uploads`
- **Automatic folder creation**: Creates matching folder hierarchy on Google Drive if needed
- **Folder caching**: Avoids redundant API calls by caching folder IDs during migration
- **Path display**: Shows full relative paths (e.g., `aerial/photos/sunset.jpg`) in console output

### 3. OAuth 2.0 Authentication
- **Out-of-band flow**: Uses localhost redirect URI (`http://localhost:3001`) for local CLI app
- **Token caching**: Saves OAuth token to `.oauth-token.json` for future migrations (no re-auth needed)
- **Browser auto-open**: Attempts to open browser for authorization URL automatically
- **Manual entry fallback**: Supports manual code entry if browser doesn't open

### 4. Progress Tracking & Status Reporting
- **Real-time status**: Shows progress for each file with emoji indicators
  - `⬆️` = Uploading
  - `✅` = Successfully uploaded
  - `⏭️` = Skipped (duplicate)
  - `❌` = Failed with error
  - `📁` = Creating folder structure
- **Summary report**: Counts uploaded, skipped, and failed files
- **Detailed JSON report**: Saved to `storage/uploads/drive-migration-map.json`

### 5. Product Catalog Integration
- **Auto-relink**: Updates product records in `storage/products/products.json`
- **Field mapping**: Updates `driveFileId`, `storageProvider: 'gdrive'`, and `driveFolder` fields
- **Skips flag**: Use `--skip-relink` to skip updating product records

## Usage

### Commands

**Dry run (preview without uploading):**
```bash
npm run migrate:drive-media -- --dry-run
```

**Actual migration:**
```bash
npm run migrate:drive-media
```

**With cleanup (delete local files after successful upload):**
```bash
npm run migrate:drive-media -- --delete-local
```

**Without product relink:**
```bash
npm run migrate:drive-media -- --skip-relink
```

### Configuration

Required environment variables in `.env`:
```
GOOGLE_MEDIA_FOLDER_ID=<drive-folder-id>
GOOGLE_SERVICE_ACCOUNT_JSON=<service-account-json>
```

Or for OAuth:
- Ensure `client_secret_*.json` exists with OAuth 2.0 credentials
- Add `http://localhost:3001` as authorized redirect URI in Google Cloud Console

### Setup in Google Cloud Console

1. Go to **APIs & Services** → **Credentials**
2. Select your OAuth 2.0 Client
3. Click **Edit**
4. Add authorized redirect URI:
   ```
   http://localhost:3001
   ```
5. Save

## Status Codes

| Status | Meaning | Action |
|--------|---------|--------|
| `uploaded` | File successfully uploaded to Drive | ✅ Complete |
| `skipped-duplicate` | File already exists on Drive | ⏭️ Skipped (safe to re-run) |
| `failed` | Upload failed with error | ❌ Check error message |
| `dry-run` | Dry run mode (not actually uploaded) | 🔄 Preview only |

## Report Output

Generated at `storage/uploads/drive-migration-map.json`:
```json
{
  "createdAt": "2026-07-19T10:30:00Z",
  "folderId": "1W9u8eQcRrhV3ger8tTy0oSwJmCxKmVoN",
  "dryRun": false,
  "deleteLocal": false,
  "skipRelink": false,
  "fileCount": 5,
  "successCount": 4,
  "skipCount": 1,
  "failCount": 0,
  "foldersCreated": ["aerial", "beach"],
  "files": [
    {
      "localFile": "aerial/photo.jpg",
      "driveFileId": "1abc123...",
      "status": "uploaded",
      "driveFolder": "aerial"
    },
    {
      "localFile": "beach/sunset.jpg",
      "driveFileId": "1def456...",
      "status": "skipped-duplicate",
      "reason": "File already exists on Drive"
    }
  ],
  "relink": {
    "relinked": 4,
    "skipped": false
  }
}
```

## Idempotency

The migration is **safe to re-run**:
- Duplicate files are detected and skipped
- Folder creation is idempotent (checking before creating)
- Token is cached for future runs
- Failed files can be retried without re-uploading successful ones

## Error Handling

| Error | Cause | Solution |
|-------|-------|----------|
| `Cannot read properties of undefined` | Missing OAuth redirect URI config | Add `http://localhost:3001` to Google Cloud Console |
| `File not found` | Google Drive folder doesn't exist or isn't shared | Share folder with service account email |
| `Service Accounts do not have storage quota` | Using service account for personal Drive | Use OAuth 2.0 or Shared Drive |
| `invalid_grant` | Expired OAuth token | Delete `.oauth-token.json` and re-authorize |

## Implementation Details

### Duplicate Detection Algorithm
1. Extract target folder ID from path
2. Query Google Drive API for files with same name in target folder
3. If found, return duplicate info and skip upload
4. If not found, proceed with upload

### Folder Structure Handling
- Splits local path by OS separator (`\` on Windows, `/` on Unix)
- Recursively creates folders matching local structure
- Caches folder IDs to avoid redundant API calls
- Uploads files to final target folder

### Product Relink Process
1. Read persisted product catalog from `storage/products/products.json`
2. Match products by filename
3. Update matched products with Drive metadata:
   - `driveFileId`: ID of uploaded file
   - `storageProvider`: Set to `'gdrive'`
   - `driveFolder`: Store folder path for reference
4. Write updated catalog back to disk

## Future Enhancements

- [ ] Hash-based duplicate detection (SHA256 comparison)
- [ ] Batch upload API for faster uploads
- [ ] Resume capability for interrupted migrations
- [ ] Archive old versions instead of skipping
- [ ] Shared Drive support with service account
- [ ] Metadata preservation (timestamps, permissions)
- [ ] Sync bidirectional changes (Drive → Local)

## See Also
- [Google Drive API Docs](https://developers.google.com/drive)
- [OAuth 2.0 Web Server Flow](https://developers.google.com/identity/protocols/oauth2/web-server)
- Product persistence: `fairviewApi/server.js` (readProductsFromDisk, writeProductsToDisk)
