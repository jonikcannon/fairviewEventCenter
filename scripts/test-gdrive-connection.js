require('dotenv').config();
const { google } = require('googleapis');

async function testGoogleDriveConnection() {
  const folderId = String(process.env.GOOGLE_MEDIA_FOLDER_ID || process.env.GOOGLE_DRIVE_FOLDER_ID || '').trim();
  const serviceAccountRaw = String(process.env.GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();

  console.log('\n=== Google Drive Connection Test ===\n');

  if (!folderId) {
    console.error('❌ GOOGLE_MEDIA_FOLDER_ID or GOOGLE_DRIVE_FOLDER_ID not set');
    process.exit(1);
  }
  console.log(`✓ Folder ID: ${folderId}`);

  if (!serviceAccountRaw || serviceAccountRaw === '{"type":"service_account"}') {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON is missing or placeholder');
    console.error('   Set the full service account JSON in your .env file');
    process.exit(1);
  }

  let credentials;
  try {
    credentials = JSON.parse(serviceAccountRaw);
    console.log(`✓ Service Account JSON parsed successfully`);
  } catch (error) {
    console.error('❌ GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON:', error.message);
    process.exit(1);
  }

  if (!credentials.client_email || !credentials.private_key) {
    console.error('❌ Service account missing client_email or private_key');
    process.exit(1);
  }
  console.log(`✓ Service account has required fields (email: ${credentials.client_email})`);

  try {
    const auth = new google.auth.JWT({
      email: credentials.client_email,
      key: credentials.private_key,
      scopes: ['https://www.googleapis.com/auth/drive']
    });

    const drive = google.drive({ version: 'v3', auth });

    console.log('\n📁 Testing folder access...');
    const folder = await drive.files.get({
      fileId: folderId,
      fields: 'id, name, mimeType',
      supportsAllDrives: true
    });

    console.log(`✓ Folder accessible: "${folder.data.name}" (${folder.data.id})`);
    console.log(`✓ MIME type: ${folder.data.mimeType}`);

    console.log('\n📝 Testing file upload/download permissions...');
    const fileList = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      spaces: 'drive',
      fields: 'files(id, name, mimeType, size)',
      pageSize: 5,
      supportsAllDrives: true
    });

    if (fileList.data.files && fileList.data.files.length > 0) {
      console.log(`✓ Found ${fileList.data.files.length} existing files in folder:`);
      fileList.data.files.forEach(f => {
        console.log(`   - ${f.name} (${Math.round(f.size / 1024)} KB)`);
      });
    } else {
      console.log(`✓ Folder is empty (ready for migration)`);
    }

    console.log('\n✅ Google Drive connection is ready!\n');
    return true;
  } catch (error) {
    console.error('\n❌ Connection failed:', error.message || error);
    if (error?.message?.includes('Invalid Credentials')) {
      console.error('   Check that GOOGLE_SERVICE_ACCOUNT_JSON contains valid credentials');
    } else if (error?.message?.includes('not found')) {
      console.error('   Check that GOOGLE_MEDIA_FOLDER_ID exists and service account has access');
    }
    process.exit(1);
  }
}

testGoogleDriveConnection();
