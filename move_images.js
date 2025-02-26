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

const SUPABASE_BUCKET = process.env.SUPABASE_IMAGE_BUCKET;
const R2_BUCKET = process.env.R2_IMAGE_BUCKET;

// 🔹 Initialize Clients
const { supabase, s3 } = initializeClients(config);

// Supported image types
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".gif", ".webp"];

async function fileExistsInR2(fileName) {
  try {
    await retry(
      async () =>
        await s3.send(
          new HeadObjectCommand({
            Bucket: R2_BUCKET,
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

async function getContentType(fileName) {
  const ext = fileName.toLowerCase().split(".").pop();
  const contentTypes = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  return contentTypes[ext] || "application/octet-stream";
}

async function moveImages() {
  console.log("🔄 Fetching images from Supabase...");

  const stats = new StatsTracker();
  let allFiles = [];

  try {
    allFiles = await fetchFilesWithPagination(supabase, SUPABASE_BUCKET);
    console.log(`🎯 Total files found: ${allFiles.length}`);
  } catch (error) {
    console.error("❌ Fatal error fetching files:", error);
    return;
  }

  for (const file of allFiles) {
    const isImage = IMAGE_EXTENSIONS.some((ext) =>
      file.name.toLowerCase().endsWith(ext)
    );

    if (!isImage) {
      stats.incrementSkipped();
      continue;
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
        `storage/v1/object/public/${SUPABASE_BUCKET}/${encodeURIComponent(
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
        Bucket: R2_BUCKET,
        Key: file.name,
        Body: buffer,
        ContentType: await getContentType(file.name),
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

moveImages();
