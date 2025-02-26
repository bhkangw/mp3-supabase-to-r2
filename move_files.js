import { createClient } from "@supabase/supabase-js";
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
import fetch from "node-fetch";

dotenv.config();

// 🔹 Load Environment Variables
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const SUPABASE_BUCKET = process.env.SUPABASE_BUCKET;
const R2_BUCKET = process.env.R2_BUCKET;
const R2_ACCESS_KEY = process.env.R2_ACCESS_KEY;
const R2_SECRET_KEY = process.env.R2_SECRET_KEY;
const R2_ENDPOINT = process.env.R2_ENDPOINT;

// 🔹 Initialize Supabase Client
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// 🔹 Initialize Cloudflare R2 (Using AWS SDK v3)
const s3 = new S3Client({
  region: "auto",
  endpoint: R2_ENDPOINT,
  credentials: {
    accessKeyId: R2_ACCESS_KEY,
    secretAccessKey: R2_SECRET_KEY,
  },
});

async function fileExistsInR2(fileName) {
  try {
    await s3.send(
      new HeadObjectCommand({
        Bucket: R2_BUCKET,
        Key: fileName,
      })
    );
    return true;
  } catch (error) {
    if (error.name === "NotFound") {
      return false;
    }
    throw error;
  }
}

async function moveFiles() {
  console.log("🔄 Fetching files from Supabase...");

  let offset = 0;
  const limit = 100; // Supabase's default limit
  let allFiles = [];

  while (true) {
    // 🔹 Get MP3 files from Supabase Storage with pagination
    const { data: files, error } = await supabase.storage
      .from(SUPABASE_BUCKET)
      .list("", {
        limit: limit,
        offset: offset,
        sortBy: { column: "name", order: "asc" },
      });

    if (error) {
      console.error("❌ Error fetching files:", error);
      return;
    }

    if (!files || files.length === 0) {
      break; // No more files to process
    }

    allFiles = [...allFiles, ...files];
    offset += limit;

    console.log(`📑 Fetched ${allFiles.length} files so far...`);
  }

  console.log(`🎯 Total files found: ${allFiles.length}`);

  let processed = 0;
  let skipped = 0;
  let failed = 0;
  let succeeded = 0;

  for (const file of allFiles) {
    if (!file.name.endsWith(".mp3")) {
      skipped++;
      continue; // Skip non-MP3 files
    }

    processed++;
    console.log(`\n[${processed}/${allFiles.length}] Processing: ${file.name}`);

    try {
      // Check if file already exists in R2
      const exists = await fileExistsInR2(file.name);
      if (exists) {
        console.log(`⏭️  Skipping: ${file.name} - Already exists in R2`);
        skipped++;
        continue;
      }

      console.log(`⬆ Moving: ${file.name} → R2`);

      // 🔹 Fetch file from Supabase Storage
      const supabaseUrl = new URL(
        `storage/v1/object/public/${SUPABASE_BUCKET}/${encodeURIComponent(
          file.name
        )}`,
        SUPABASE_URL
      ).toString();
      const response = await fetch(supabaseUrl);

      if (!response.ok) {
        console.error(
          `❌ Failed to fetch ${file.name} - Status: ${response.status} ${response.statusText}`
        );
        continue;
      }

      // 🔹 Convert response body to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 🔹 Upload to Cloudflare R2
      const uploadParams = {
        Bucket: R2_BUCKET,
        Key: file.name,
        Body: buffer, // Correctly formatted file data
        ContentType: "audio/mpeg",
      };

      await s3.send(new PutObjectCommand(uploadParams));
      console.log(`✅ Uploaded: ${file.name} → R2`);

      // 🔹 Update Supabase DB with new URL
      const newUrl = new URL(
        `${R2_BUCKET}/${encodeURIComponent(file.name)}`,
        R2_ENDPOINT
      ).toString();
      await supabase
        .from("tracks")
        .update({ url: newUrl })
        .eq("url", supabaseUrl);
      console.log(`🔄 Updated DB: ${file.name}`);
      succeeded++;
    } catch (error) {
      console.error(`❌ Upload failed for ${file.name}:`, error.message);
      if (error.code) console.error("Error code:", error.code);
      if (error.stack) console.error("Stack trace:", error.stack);
      failed++;
    }
  }

  console.log("\n📊 Summary:");
  console.log(`Total files processed: ${processed}`);
  console.log(`Successfully uploaded: ${succeeded}`);
  console.log(`Skipped (already exists/non-MP3): ${skipped}`);
  console.log(`Failed: ${failed}`);
  console.log("\n🎉 Process completed!");
}

moveFiles();
