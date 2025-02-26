import { createClient } from "@supabase/supabase-js";
import { S3Client } from "@aws-sdk/client-s3";

// Retry configuration
export const MAX_RETRIES = 3;
export const INITIAL_RETRY_DELAY = 1000; // 1 second

// Retry helper function
export async function retry(operation, description) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < MAX_RETRIES) {
        const delay = INITIAL_RETRY_DELAY * Math.pow(2, attempt - 1);
        console.log(
          `⚠️ ${description} failed (attempt ${attempt}/${MAX_RETRIES}). Retrying in ${
            delay / 1000
          }s...`
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// Initialize clients
export function initializeClients(config) {
  const supabase = createClient(config.supabaseUrl, config.supabaseKey);

  const s3 = new S3Client({
    region: "auto",
    endpoint: config.r2Endpoint,
    credentials: {
      accessKeyId: config.r2AccessKey,
      secretAccessKey: config.r2SecretKey,
    },
  });

  return { supabase, s3 };
}

// Common file operations
export async function fetchFilesWithPagination(supabase, bucket, options = {}) {
  let allFiles = [];
  let offset = 0;
  const limit = options.limit || 100;

  while (true) {
    const { data: files, error } = await retry(
      async () =>
        await supabase.storage.from(bucket).list("", {
          limit,
          offset,
          sortBy: { column: "name", order: "asc" },
        }),
      "Fetching files from Supabase"
    );

    if (error) {
      throw error;
    }

    if (!files || files.length === 0) {
      break;
    }

    allFiles = [...allFiles, ...files];
    offset += limit;

    console.log(`📑 Fetched ${allFiles.length} files so far...`);
  }

  return allFiles;
}

// Stats tracking
export class StatsTracker {
  constructor() {
    this.processed = 0;
    this.skipped = 0;
    this.failed = 0;
    this.succeeded = 0;
  }

  incrementProcessed() {
    this.processed++;
  }

  incrementSkipped() {
    this.skipped++;
  }

  incrementFailed() {
    this.failed++;
  }

  incrementSucceeded() {
    this.succeeded++;
  }

  printSummary() {
    console.log("\n📊 Summary:");
    console.log(`Total files processed: ${this.processed}`);
    console.log(`Successfully uploaded: ${this.succeeded}`);
    console.log(`Skipped: ${this.skipped}`);
    console.log(`Failed: ${this.failed}`);
    console.log("\n🎉 Process completed!");
  }
}
