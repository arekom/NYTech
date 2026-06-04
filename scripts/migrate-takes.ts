/**
 * One-off migration: split each existing concatenated WebM recording into
 * its 5 component takes, upload each as its own Blob, and update the
 * corresponding sessions row with the per-take pathnames.
 *
 * Why this exists: the original /api/analyze byte-concatenated all takes
 * into a single .webm file. Browsers only play the FIRST take of such a
 * file because each segment has its own EBML header at a different offset
 * and `<audio>` elements stop at the first segment's end. The audio data
 * is all there — it just isn't reachable.
 *
 * What this does, per session:
 *   1. Download the file at sessions.audio_pathname from Vercel Blob.
 *   2. Find every EBML header (4-byte magic 1A 45 DF A3).
 *   3. Slice the file at those offsets. Each slice is a self-contained
 *      WebM with its own EBML+Segment header — i.e. a playable file.
 *   4. Upload each slice to recordings/<original-basename>/qN.webm.
 *   5. Build the signal_data.takes array and write it back to the row,
 *      pointing audio_pathname at the first slice (so legacy readers
 *      still get a playable URL).
 *   6. Delete the original concatenated blob.
 *
 * Defaults to dry-run. Pass `--apply` to actually mutate.
 *
 *   npm run blobs:migrate-takes              # dry-run
 *   npm run blobs:migrate-takes -- --apply   # for real
 *
 * Idempotent: rows that already have signal_data.takes populated are
 * skipped. Safe to re-run if it errors midway.
 */
import { del, put } from "@vercel/blob";
import postgres from "postgres";
import type { SignalData, TakeAudio } from "../lib/signals";

// EBML magic — every WebM file starts with these 4 bytes. A
// byte-concatenated file from /api/analyze's old `concatBlobs` has one
// occurrence per take.
const EBML_MAGIC = Buffer.from([0x1a, 0x45, 0xdf, 0xa3]);

type Row = {
  id: string;
  audio_pathname: string | null;
  audio_url: string | null;
  signal_data: SignalData | null;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }

  const sql = postgres(url, { ssl: "require", prepare: false });

  // Candidates: rows with a stored audio file but no per-take array yet.
  // The jsonb predicate filters out new-schema rows automatically.
  const rows = await sql<Row[]>`
    select id, audio_pathname, audio_url, signal_data
    from sessions
    where audio_pathname is not null
      and (signal_data->'takes' is null or jsonb_array_length(signal_data->'takes') = 0)
  `;

  console.log(`Found ${rows.length} session${rows.length === 1 ? "" : "s"} to migrate.`);
  if (rows.length === 0) {
    await sql.end();
    return;
  }

  let migrated = 0;
  let skipped = 0;
  let failed = 0;
  let bytesProcessed = 0;

  for (const row of rows) {
    if (!row.audio_pathname || !row.audio_url) {
      skipped++;
      continue;
    }

    try {
      // Pull the bytes. blob.url stored in the DB is the raw store URL,
      // which for a private store requires a signed token — but we can
      // also fetch via the @vercel/blob client. Simplest: read the raw
      // file via the Vercel Blob HEAD/GET API by minting a fresh signed
      // URL inline. For one-off migration we re-use the same helper as
      // /api/analyze.
      const file = await fetchBlobBytes(row.audio_pathname);
      bytesProcessed += file.length;

      const headerOffsets = findEbmlHeaders(file);
      if (headerOffsets.length === 0) {
        console.warn(`  ${row.id}  no EBML header found; skipping`);
        skipped++;
        continue;
      }
      if (headerOffsets.length === 1) {
        // Already a single-take file (or properly muxed). Nothing to split.
        console.log(`  ${row.id}  single-segment file; recording as Q1 only`);
      } else {
        console.log(`  ${row.id}  found ${headerOffsets.length} segments`);
      }

      // Slice at header boundaries. Each chunk starts at an EBML header
      // and ends just before the next one (or EOF for the last).
      const chunks: Buffer[] = [];
      for (let i = 0; i < headerOffsets.length; i++) {
        const start = headerOffsets[i];
        const end = i + 1 < headerOffsets.length ? headerOffsets[i + 1] : file.length;
        chunks.push(file.subarray(start, end));
      }

      // Derive the new folder name from the original blob's filename so
      // it's obviously tied back to the legacy file.
      // legacy:  recordings/<basename>.webm
      // new:     recordings/<basename>/q1.webm, q2.webm, ...
      const oldPath = row.audio_pathname;
      const ext = pickExt(oldPath);
      const basename = stripExt(oldPath.replace(/^recordings\//, ""));
      const folder = `recordings/${basename}`;

      if (!apply) {
        console.log(
          `    would split into ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}: ` +
            chunks.map((c, i) => `q${i + 1}=${formatBytes(c.length)}`).join(", ")
        );
        continue;
      }

      // Upload each chunk and build the TakeAudio array.
      const takes: TakeAudio[] = [];
      let firstUploaded: { pathname: string; url: string } | null = null;
      for (let i = 0; i < chunks.length; i++) {
        const questionIndex = i + 1;
        const key = `${folder}/q${questionIndex}${ext}`;
        const uploaded = await put(key, chunks[i], {
          access: "private",
          contentType: "audio/webm",
          addRandomSuffix: false,
        });
        takes.push({
          question_index: questionIndex,
          pathname: uploaded.pathname,
          // No reliable per-take duration is available from the bytes
          // alone without ffprobe — leave as 0. The browser audio element
          // will fill in actual duration on load.
          duration_seconds: 0,
        });
        if (i === 0) firstUploaded = { pathname: uploaded.pathname, url: uploaded.url };
      }
      if (!firstUploaded) throw new Error("upload produced no chunks");

      // Update signal_data.takes, repoint audio_* at the first new chunk.
      const newSignals: SignalData = {
        ...(row.signal_data as SignalData),
        takes,
      };
      await sql`
        update sessions
        set signal_data = ${sql.json(newSignals as unknown as Parameters<typeof sql.json>[0])},
            audio_pathname = ${firstUploaded.pathname},
            audio_url = ${firstUploaded.url}
        where id = ${row.id}
      `;

      // Delete the original concatenated file — the data lives in the
      // per-take chunks now, and the old file is unreachable for Q2-Q5.
      await del(oldPath);

      migrated++;
      console.log(`    migrated ${chunks.length} chunk${chunks.length === 1 ? "" : "s"}`);
    } catch (err) {
      failed++;
      const message = err instanceof Error ? err.message : String(err);
      console.error(`  ${row.id}  FAILED: ${message}`);
    }
  }

  console.log("");
  console.log(`Processed: ${formatBytes(bytesProcessed)}`);
  console.log(`Migrated:  ${migrated}`);
  console.log(`Skipped:   ${skipped}`);
  console.log(`Failed:    ${failed}`);

  if (!apply) {
    console.log("");
    console.log("Dry-run only. Re-run with `-- --apply` to mutate.");
  }

  await sql.end();
}

/** Find every offset where the WebM EBML magic appears. */
function findEbmlHeaders(buf: Buffer): number[] {
  const offsets: number[] = [];
  let start = 0;
  while (true) {
    const idx = buf.indexOf(EBML_MAGIC, start);
    if (idx < 0) break;
    offsets.push(idx);
    start = idx + 1;
  }
  return offsets;
}

/** Fetch raw bytes for a private-store blob pathname via a signed GET URL. */
async function fetchBlobBytes(pathname: string): Promise<Buffer> {
  const { issueSignedToken, presignUrl } = await import("@vercel/blob");
  const validUntil = Date.now() + 5 * 60 * 1000; // 5 min — only used right here
  const token = await issueSignedToken({
    pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(
    {
      clientSigningToken: token.clientSigningToken,
      delegationToken: token.delegationToken,
    },
    { operation: "get", pathname, access: "private" }
  );
  const res = await fetch(presignedUrl);
  if (!res.ok) throw new Error(`blob GET ${res.status} for ${pathname}`);
  return Buffer.from(await res.arrayBuffer());
}

function pickExt(pathname: string): string {
  const m = pathname.match(/\.[a-z0-9]+$/i);
  return m ? m[0] : ".webm";
}

function stripExt(pathname: string): string {
  return pathname.replace(/\.[a-z0-9]+$/i, "");
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
