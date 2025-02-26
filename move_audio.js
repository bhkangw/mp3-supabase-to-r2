import { HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import * as dotenv from "dotenv";
import fetch from "node-fetch";
import {
  initializeClients,
  retry,
  fetchFilesWithPagination,
  StatsTracker,
} from "./utils.js";

dotenv.config();

// 🔹 Load Environment Variables
const config = {
  supabaseUrl: process.env.SUPABASE_URL,
  supabaseKey: process.env.SUPABASE_KEY,
  r2Endpoint: process.env.R2_ENDPOINT,
  r2AccessKey: process.env.R2_ACCESS_KEY,
  r2SecretKey: process.env.R2_SECRET_KEY,
};

const SUPABASE_AUDIO_BUCKET = process.env.SUPABASE_AUDIO_BUCKET;
const R2_AUDIO_BUCKET = process.env.R2_AUDIO_BUCKET;

// 🔹 Initialize Clients
const { supabase, s3 } = initializeClients(config);

async function fileExistsInR2(fileName) {
  try {
    await retry(
      async () =>
        await s3.send(
          new HeadObjectCommand({
            Bucket: R2_AUDIO_BUCKET,
            Key: fileName,
          })
        ),
      `Checking if ${fileName} exists in R2`
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

  const stats = new StatsTracker();
  let allFiles = [];

  try {
    allFiles = await fetchFilesWithPagination(supabase, SUPABASE_AUDIO_BUCKET);
    console.log(`🎯 Total files found: ${allFiles.length}`);
  } catch (error) {
    console.error("❌ Fatal error fetching files:", error);
    return;
  }

  for (const file of allFiles) {
    if (!file.name.endsWith(".mp3")) {
      stats.incrementSkipped();
      continue; // Skip non-MP3 files
    }

    stats.incrementProcessed();
    console.log(
      `\n[${stats.processed}/${allFiles.length}] Processing: ${file.name}`
    );

    try {
      // Check if file already exists in R2
      const exists = await fileExistsInR2(file.name);
      if (exists) {
        console.log(`⏭️  Skipping: ${file.name} - Already exists in R2`);
        stats.incrementSkipped();
        continue;
      }

      console.log(`⬆ Moving: ${file.name} → R2`);

      // 🔹 Fetch file from Supabase Storage
      const supabaseUrl = new URL(
        `storage/v1/object/public/${SUPABASE_AUDIO_BUCKET}/${encodeURIComponent(
          file.name
        )}`,
        SUPABASE_URL
      ).toString();

      const response = await retry(async () => {
        const res = await fetch(supabaseUrl);
        if (!res.ok) {
          throw new Error(
            `Failed to fetch with status: ${res.status} ${res.statusText}`
          );
        }
        return res;
      }, `Fetching ${file.name} from Supabase`);

      // 🔹 Convert response body to Buffer
      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      // 🔹 Upload to Cloudflare R2
      const uploadParams = {
        Bucket: R2_AUDIO_BUCKET,
        Key: file.name,
        Body: buffer,
        ContentType: "audio/mpeg",
      };

      await retry(
        async () => await s3.send(new PutObjectCommand(uploadParams)),
        `Uploading ${file.name} to R2`
      );
      console.log(`✅ Uploaded: ${file.name} → R2`);

      stats.incrementSucceeded();
    } catch (error) {
      console.error(`❌ Upload failed for ${file.name}:`, error.message);
      if (error.code) console.error("Error code:", error.code);
      if (error.stack) console.error("Stack trace:", error.stack);
      stats.incrementFailed();
    }
  }

  stats.printSummary();
}

moveFiles();
