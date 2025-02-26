# Supabase Storage to Cloudflare R2 Migration Tool 🚀

This tool helps you migrate files (MP3s and images) from Supabase Storage to Cloudflare R2 while updating your database references. Perfect for those looking to move their media storage to a more cost-effective solution.

## Prerequisites

- Node.js installed on your system
- Supabase project with stored files (MP3s and images)
- Cloudflare account with R2 enabled
- Access to both Supabase and Cloudflare R2 credentials

## Setup Process

### 1. Supabase Setup
1. Log into your Supabase dashboard
2. Get your project URL and anon/service key from: Project Settings > API
3. Note your storage bucket name where MP3 files are stored
4. Make sure your storage bucket is publicly accessible

### 2. Cloudflare R2 Setup
1. Log into Cloudflare dashboard
2. Navigate to R2
3. Create a new R2 bucket
4. Create R2 API tokens:
   - Go to R2 > Manage R2 API Tokens
   - Create a new API token with read/write permissions
   - Save your Access Key ID and Secret Access Key

### 3. Environment Variables
Create a `.env` file in your project root with the following variables:

```env
SUPABASE_URL=your_supabase_project_url
SUPABASE_KEY=your_supabase_anon_key
SUPABASE_BUCKET=your_supabase_bucket_name
R2_BUCKET=your_r2_bucket_name
R2_ACCESS_KEY=your_r2_access_key_id
R2_SECRET_KEY=your_r2_secret_access_key
R2_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
```

### 4. Installation

```bash
npm install
```

## How It Works

The migration script (`move_files.js`) performs the following steps:

1. **File Discovery**: 
   - Fetches all files from your Supabase storage bucket
   - Supports MP3 files and common image formats (jpg, jpeg, png, gif, webp)

2. **File Migration**:
   For each file:
   - Downloads the file from Supabase Storage
   - Uploads it to Cloudflare R2
   - Updates the database references with new R2 URLs

3. **Database Updates**:
   - Updates your Supabase database tables ('tracks' for audio, 'images' for images)
   - Replaces old Supabase Storage URLs with new R2 URLs

## Running the Migration

```bash
node move_files.js
```

## What Happens Behind the Scenes

### Supabase Storage
- Files in Supabase Storage are stored with public URLs in format:
  `https://<project-ref>.supabase.co/storage/v1/object/public/<bucket>/<filename>`
- The script uses these public URLs to download files

### Cloudflare R2
- R2 uses S3-compatible API
- Files are uploaded using AWS SDK v3
- New URLs follow format:
  `https://<bucket>.<account-id>.r2.cloudflarestorage.com/<filename>`

### Database Updates
- The script maintains your application's functionality by:
  1. Keeping track of file migrations
  2. Updating database references to point to new R2 URLs
  3. Ensuring zero downtime during migration
  4. Handling both audio and image file references appropriately

## Troubleshooting

### Common Issues:
1. **Permission Errors**:
   - Verify Supabase storage bucket is public
   - Check R2 API token permissions

2. **Connection Issues**:
   - Verify environment variables are correct
   - Ensure R2 endpoint URL is properly formatted

3. **File Access Errors**:
   - Confirm files exist in Supabase bucket
   - Check file permissions

## Cost Considerations

- Cloudflare R2: Free for first 10GB/month, then $0.015/GB
- Supabase Storage: Varies by plan
- Consider bandwidth costs for migration

## Security Notes

- Keep your `.env` file secure and never commit it
- Use appropriate API token permissions
- Consider implementing additional access controls for R2

## Support

For issues:
1. Check environment variables
2. Review console logs
3. Verify file permissions
4. Check network connectivity

## License

MIT License - Feel free to modify and use as needed! 