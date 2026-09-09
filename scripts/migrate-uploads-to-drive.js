require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { google } = require('googleapis');
const jwt = require('jsonwebtoken');
const readline = require('readline');
const http = require('http');
const { URL } = require('url');
const crypto = require('crypto');

function getArg(name) {
  const prefixed = `--${name}=`;
  const item = process.argv.find(arg => arg.startsWith(prefixed));
  return item ? item.slice(prefixed.length) : '';
}

const dryRun = process.argv.includes('--dry-run');
const deleteLocal = process.argv.includes('--delete-local');
const skipRelink = process.argv.includes('--skip-relink');
const sourceArg = getArg('source');

// Allow specifying source directory via --source flag
// Defaults to uploads but can also be assets gallery or other paths
let uploadsDir = sourceArg || process.env.UPLOADS_DIR;
if (!uploadsDir) {
  // Try multiple default locations in order
  const possiblePaths = [
    path.resolve(__dirname, '../storage/uploads'),
    path.resolve(__dirname, '../src/assets/gallery'),
    path.resolve(__dirname, '../src/assets')
  ];
  
  // Use the first one that exists
  for (const possiblePath of possiblePaths) {
    if (fs.existsSync(possiblePath)) {
      uploadsDir = possiblePath;
      break;
    }
  }
}

if (!uploadsDir) {
  console.error('No source directory found. Use --source=<path> or set UPLOADS_DIR');
  process.exit(1);
}

uploadsDir = path.resolve(uploadsDir);
const outputPath = path.resolve(__dirname, '../storage/uploads/drive-migration-map.json');
const productsPath = path.resolve(__dirname, '../storage/products/products.json');
const tokenCachePath = path.resolve(__dirname, '../.oauth-token.json');
const oauthCredentialsPath = path.resolve(__dirname, '../client_secret_352038115250-io37tumi7dseohtgklrlg435vpj2qddb.apps.googleusercontent.com.json');
const mediaTokenTtl = String(process.env.GOOGLE_MEDIA_TOKEN_TTL || '12h').trim();
const mediaJwtSecret = String(process.env.JWT_SECRET || '').trim();

const folderId = String(getArg('folder') || process.env.GOOGLE_MEDIA_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();

if (!folderId) {
  console.error('Missing folder id. Set GOOGLE_MEDIA_FOLDER_ID or GOOGLE_DRIVE_FOLDER_ID, or pass --folder=<id>.');
  process.exit(1);
}

if (!fs.existsSync(oauthCredentialsPath)) {
  console.error(`Missing OAuth credentials file: ${oauthCredentialsPath}`);
  process.exit(1);
}

if (!mediaJwtSecret) {
  console.warn('JWT_SECRET is not set. Signed media URLs will not be generated.');
}

let oauthClient;
let drive;

function buildMediaProxyPath(fileId, mimeType) {
  if (!fileId || !mediaJwtSecret) return '';

  const token = jwt.sign({
    provider: 'gdrive',
    fileId,
    mimeType: String(mimeType || '').trim()
  }, mediaJwtSecret, {
    expiresIn: mediaTokenTtl,
    issuer: 'fairviewApi',
    audience: 'fairview-media'
  });

  return `/api/media/${encodeURIComponent(token)}`;
}

async function initializeOAuth() {
  const oauthCredentials = JSON.parse(fs.readFileSync(oauthCredentialsPath, 'utf8'));
  const { client_id, client_secret } = oauthCredentials.web;

  // Use localhost redirect for local CLI app
  oauthClient = new google.auth.OAuth2(client_id, client_secret, 'http://localhost:3001');

  // Try to load cached token
  if (fs.existsSync(tokenCachePath)) {
    const tokens = JSON.parse(fs.readFileSync(tokenCachePath, 'utf8'));
    oauthClient.setCredentials(tokens);
    console.log('✓ Using cached OAuth token');
  } else {
    // Need interactive OAuth flow
    await authenticateOAuth();
  }

  drive = google.drive({ version: 'v3', auth: oauthClient });
}

async function authenticateOAuth() {
  const scopes = ['https://www.googleapis.com/auth/drive'];
  const authUrl = oauthClient.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  console.log('\n🔐 First-time OAuth authentication required\n');
  console.log('Opening authorization URL in browser...\n');
  console.log('If browser does not open, visit this URL:');
  console.log(authUrl);
  console.log('');

  const code = await getAuthorizationCode(authUrl);

  try {
    const { tokens } = await oauthClient.getToken(code);
    oauthClient.setCredentials(tokens);

    // Cache token for future runs
    fs.writeFileSync(tokenCachePath, JSON.stringify(tokens, null, 2));
    console.log('✓ OAuth token saved locally for future migrations\n');
  } catch (error) {
    console.error('Failed to exchange authorization code:', error.message);
    process.exit(1);
  }
}

async function getAuthorizationCode(authUrl) {
  return new Promise((resolve, reject) => {
    // Try to open browser
    try {
      const opener = process.platform === 'win32' ? 'start' : 
                     process.platform === 'darwin' ? 'open' : 'xdg-open';
      require('child_process').exec(`${opener} "${authUrl}"`);
    } catch (e) {
      // Browser open failed, user will visit manually
    }

    console.log('Waiting for authorization on http://localhost:3001...');

    // Start local server to catch redirect
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url, 'http://localhost:3001');
      const authCode = urlObj.searchParams.get('code');

      if (authCode) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h1>Authorization successful!</h1><p>You can close this window and return to the terminal.</p>`);
        server.close();
        resolve(authCode);
      } else {
        res.writeHead(400);
        res.end('Authorization failed');
      }
    });

    server.listen(3001, () => {
      console.log('Local server listening...');
    });

    server.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port busy, prompt for manual entry
        console.log('Port 3001 in use. Please enter code manually.');
        promptForCodeManual(resolve, reject);
      } else {
        reject(err);
      }
    });

    // Fallback: also allow manual code entry after 10 seconds
    setTimeout(() => {
      if (server.listening) {
        console.log('Or paste authorization code manually:');
        promptForCodeManual(resolve, reject, server);
      }
    }, 10000);
  });
}

function promptForCodeManual(resolve, reject, server) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  rl.question('\nEnter authorization code from URL: ', (code) => {
    rl.close();
    if (server && server.listening) server.close();
    resolve(code.trim());
  });
}

function listUploadFiles() {
  if (!fs.existsSync(uploadsDir)) return [];
  
  const files = [];
  
  function walkDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(uploadsDir, fullPath);
      
      if (entry.isFile() && entry.name !== '.gitignore' && entry.name !== 'drive-migration-map.json') {
        files.push(relativePath);
      } else if (entry.isDirectory()) {
        walkDir(fullPath);
      }
    }
  }
  
  walkDir(uploadsDir);
  return files.sort((a, b) => a.localeCompare(b));
}

async function verifyFolder() {
  await drive.files.get({
    fileId: folderId,
    fields: 'id, name',
    supportsAllDrives: true
  });
}

// Cache for folder IDs to avoid redundant API calls
const folderCache = { [folderId]: folderId };

function computeFileHash(filePath) {
  const buffer = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function checkDuplicateOnDrive(targetFolderId, justFileName, fileHash) {
  try {
    // First check by filename
    const existing = await drive.files.list({
      q: `'${targetFolderId}' in parents and name='${justFileName}' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id, name, md5Checksum, webViewLink)',
      pageSize: 10,
      supportsAllDrives: true
    });

    if (!existing.data.files || existing.data.files.length === 0) {
      return null; // No duplicates found
    }

    // Compare MD5 checksums if available
    for (const file of existing.data.files) {
      if (file.md5Checksum) {
        // Google Drive provides MD5, but we computed SHA256
        // For now, just check if file exists with same name
        return {
          exists: true,
          fileId: file.id,
          fileName: file.name,
          driveLink: file.webViewLink,
          reason: 'File with same name already exists'
        };
      }
    }

    // If we found files but no checksum, assume duplicate
    if (existing.data.files.length > 0) {
      const file = existing.data.files[0];
      return {
        exists: true,
        fileId: file.id,
        fileName: file.name,
        driveLink: file.webViewLink,
        reason: 'File with same name already exists'
      };
    }

    return null;
  } catch (error) {
    console.warn(`  ⚠️  Could not check for duplicates: ${error.message}`);
    return null;
  }
}

async function getOrCreateFolder(parentId, folderName) {
  const cacheKey = `${parentId}/${folderName}`;
  
  if (folderCache[cacheKey]) {
    return folderCache[cacheKey];
  }

  try {
    // Check if folder already exists
    const existing = await drive.files.list({
      q: `'${parentId}' in parents and name='${folderName}' and mimeType='application/vnd.google-apps.folder' and trashed=false`,
      spaces: 'drive',
      fields: 'files(id)',
      pageSize: 1,
      supportsAllDrives: true
    });

    if (existing.data.files && existing.data.files.length > 0) {
      folderCache[cacheKey] = existing.data.files[0].id;
      return existing.data.files[0].id;
    }

    // Create folder if it doesn't exist
    const created = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId]
      },
      fields: 'id',
      supportsAllDrives: true
    });

    folderCache[cacheKey] = created.data.id;
    return created.data.id;
  } catch (error) {
    throw new Error(`Failed to create/find folder '${folderName}': ${error.message}`);
  }
}

async function uploadOne(fileName) {
  const absolutePath = path.join(uploadsDir, fileName);
  const mimeType = fileName.toLowerCase().endsWith('.mp4') ? 'video/mp4' : undefined;
  const buffer = fs.readFileSync(absolutePath);
  const fileHash = computeFileHash(absolutePath);
  
  // Extract folder path from fileName (relative path with separators)
  const fileParts = fileName.split(path.sep);
  const justFileName = fileParts[fileParts.length - 1];
  const folderParts = fileParts.slice(0, -1);

  if (dryRun) {
    const displayPath = folderParts.length > 0 ? `${folderParts.join('/')}/${justFileName}` : justFileName;
    console.log(`  ⚪ [DRY RUN] Would upload: ${displayPath}`);
    return {
      localFile: fileName,
      driveFileId: 'dry-run',
      mimeType: mimeType || 'application/octet-stream',
      imageProxyPath: '',
      presignedUrl: '',
      status: 'dry-run',
      driveFolder: folderParts.join('/')
    };
  }

  try {
    // Create folder structure on Drive
    let targetFolderId = folderId;
    const createdFolders = [];
    
    for (const folderName of folderParts) {
      console.log(`  📁 Creating folder: ${folderName}...`);
      targetFolderId = await getOrCreateFolder(targetFolderId, folderName);
      createdFolders.push(folderName);
    }

    // Check for duplicates before uploading
    const duplicate = await checkDuplicateOnDrive(targetFolderId, justFileName, fileHash);
    
    const displayPath = folderParts.length > 0 ? `${folderParts.join('/')}/${justFileName}` : justFileName;
    
    if (duplicate && duplicate.exists) {
      console.log(`  ⏭️  Skipped (duplicate): ${displayPath}`);
      console.log(`     └─ Already exists on Drive: ${duplicate.fileId}`);
      const presignedUrl = buildMediaProxyPath(duplicate.fileId, mimeType || 'application/octet-stream');
      return {
        localFile: fileName,
        driveFileId: duplicate.fileId,
        mimeType: mimeType || 'application/octet-stream',
        imageProxyPath: presignedUrl,
        presignedUrl,
        status: 'skipped-duplicate',
        driveLink: duplicate.driveLink,
        driveFolder: folderParts.join('/'),
        reason: 'File already exists on Drive'
      };
    }

    console.log(`  ⬆️  Uploading: ${displayPath}...`);
    
    const uploaded = await drive.files.create({
      requestBody: {
        name: justFileName,
        parents: [targetFolderId]
      },
      media: {
        mimeType: mimeType || 'application/octet-stream',
        body: Readable.from(buffer)
      },
      fields: 'id, name, mimeType, webViewLink',
      supportsAllDrives: true
    });

    console.log(`  ✅ Uploaded: ${displayPath} → ${uploaded.data.id}`);

    if (deleteLocal) {
      fs.unlinkSync(absolutePath);
      console.log(`  🗑️  Deleted local: ${displayPath}`);
    }

    const presignedUrl = buildMediaProxyPath(uploaded.data.id, uploaded.data.mimeType || mimeType || 'application/octet-stream');

    return {
      localFile: fileName,
      driveFileId: uploaded.data.id,
      mimeType: uploaded.data.mimeType || mimeType || 'application/octet-stream',
      imageProxyPath: presignedUrl,
      presignedUrl,
      status: 'uploaded',
      driveLink: uploaded.data.webViewLink,
      driveFolder: folderParts.join('/'),
      createdFolders
    };
  } catch (error) {
    const displayPath = folderParts.length > 0 ? `${folderParts.join('/')}/${justFileName}` : justFileName;
    console.log(`  ❌ Failed: ${displayPath} - ${error.message}`);
    return {
      localFile: fileName,
      driveFileId: null,
      mimeType: mimeType || 'application/octet-stream',
      status: 'failed',
      error: error.message,
      driveFolder: folderParts.join('/')
    };
  }
}

function readProducts() {
  if (!fs.existsSync(productsPath)) return [];
  try {
    const raw = fs.readFileSync(productsPath, 'utf8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error('Could not read products file for relink:', error.message || error);
    return [];
  }
}

function writeProducts(next) {
  fs.writeFileSync(productsPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
}

function relinkProducts(rows) {
  if (skipRelink) {
    return { relinked: 0, skipped: true, reason: '--skip-relink used' };
  }
  if (!fs.existsSync(productsPath)) {
    return { relinked: 0, skipped: true, reason: 'No persisted products file found' };
  }

  const byFile = new Map(rows.map(row => [row.localFile, row]));
  const current = readProducts();
  let relinked = 0;

  const next = current.map(product => {
    const fileName = String(product?.fileName || '').trim();
    const image = String(product?.image || '').trim();
    
    // Try to match by fileName first, then infer from image path
    let inferredFileName = fileName;
    if (!inferredFileName && image.startsWith('/uploads/')) {
      inferredFileName = image.slice('/uploads/'.length);
    }
    
    const match = byFile.get(inferredFileName);
    if (!match || match.driveFileId === 'dry-run') return product;

    relinked += 1;
    return {
      ...product,
      fileName: inferredFileName,
      storageProvider: 'gdrive',
      driveFileId: match.driveFileId,
      driveMimeType: match.mimeType,
      mediaMimeType: product.mediaMimeType || match.mimeType,
      driveFolder: match.driveFolder || '',
      image: `/uploads/${inferredFileName}`
    };
  });

  writeProducts(next);
  return { relinked, skipped: false };
}

async function main() {
  console.log(`\n📂 Source directory: ${uploadsDir}`);
  console.log(`📁 Target Drive folder: ${folderId}`);
  if (dryRun) console.log('🔄 Dry run: files will NOT be uploaded.\n');

  // Initialize OAuth and get drive client
  await initializeOAuth();

  try {
    await verifyFolder();
    console.log('✅ Folder access verified\n');
  } catch (error) {
    console.error('❌ Cannot access folder:', error.message);
    process.exit(1);
  }

  const files = listUploadFiles();
  if (!files.length) {
    console.log('ℹ️  No media files found in source directory to migrate.\n');
    return;
  }

  console.log(`📋 Found ${files.length} file(s) to migrate:\n`);

  const rows = [];
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;
  const createdFoldersSet = new Set();

  for (let i = 0; i < files.length; i++) {
    const fileName = files[i];
    console.log(`[${i + 1}/${files.length}]`);
    const result = await uploadOne(fileName);
    rows.push(result);
    
    if (result.status === 'uploaded') {
      successCount++;
      if (result.createdFolders) {
        result.createdFolders.forEach(f => createdFoldersSet.add(f));
      }
    }
    if (result.status === 'skipped-duplicate') skipCount++;
    if (result.status === 'failed') failCount++;
  }

  console.log('\n' + '='.repeat(60));
  console.log('📊 Migration Summary');
  console.log('='.repeat(60));
  console.log(`  Source: ${uploadsDir}`);
  console.log(`  Total files processed: ${files.length}`);
  console.log(`  ✅ Uploaded: ${successCount}`);
  if (skipCount > 0) console.log(`  ⏭️  Skipped (duplicates): ${skipCount}`);
  if (failCount > 0) console.log(`  ❌ Failed: ${failCount}`);
  if (dryRun) console.log(`  🔄 Dry run: no files actually uploaded`);
  if (createdFoldersSet.size > 0) {
    console.log(`  📁 Folders created: ${Array.from(createdFoldersSet).sort().join(', ')}`);
  }
  
  const relinkResult = relinkProducts(rows);
  if (!relinkResult.skipped) {
    console.log(`  🔗 Products relinked: ${relinkResult.relinked}`);
  }
  console.log('='.repeat(60) + '\n');

  const report = {
    createdAt: new Date().toISOString(),
    sourceDir: uploadsDir,
    folderId,
    dryRun,
    deleteLocal,
    skipRelink,
    fileCount: rows.length,
    successCount,
    skipCount,
    failCount,
    foldersCreated: Array.from(createdFoldersSet),
    files: rows,
    relink: relinkResult,
    note: 'Products persisted at storage/products/products.json are relinked unless --skip-relink is used. Folder structure from source is preserved on Google Drive. Duplicates are detected by filename and skipped.'
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`📄 Migration report: ${outputPath}\n`);
}

main().catch((error) => {
  console.error('Drive migration failed:', error.message || error);
  process.exit(1);
});
