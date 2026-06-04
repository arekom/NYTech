/**
 * One-off cleanup: delete Vercel Blob objects that aren't referenced by
 * any row in the sessions table.
 *
 * Two prefixes we care about:
 *   - recordings/   audio uploaded by /api/analyze
 *   - brain-maps/   brain PNG + activations tensor uploaded by lib/brain.ts
 *
 * Orphans show up when:
 *   - /api/analyze uploaded a blob then crashed before the DB insert
 *   - Dev/test runs that didn't persist a sessions row
 *   - Rows were deleted manually from the DB without first deleting the blob
 *
 * Defaults to dry-run (lists what would be deleted, deletes nothing).
 * Pass `--apply` to actually delete.
 *
 *   npm run cleanup-blobs           # dry-run, shows the orphan list
 *   npm run cleanup-blobs -- --apply  # actually delete
 */
import { del, list, type ListBlobResultBlob } from "@vercel/blob";
import postgres from "postgres";

type BrainMapPathnames = {
  image_pathname?: string | null;
  activations_pathname?: string | null;
};

async function main() {
  const apply = process.argv.includes("--apply");

  const url = process.env.POSTGRES_URL;
  if (!url) throw new Error("POSTGRES_URL is not set");
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not set");
  }

  const sql = postgres(url, { ssl: "require", prepare: false });

  // ── Build the set of referenced pathnames across all sessions ──────────
  // Every audio file, every brain file, every per-take file. signal_data
  // is unrolled with `jsonb_array_elements` so each take row gets its own
  // pathname out of the takes array.
  const referencedRows = await sql<
    Array<{
      audio_pathname: string | null;
      image_pathname: string | null;
      activations_pathname: string | null;
    }>
  >`
    select
      audio_pathname,
      signal_data->'brain_map'->>'image_pathname' as image_pathname,
      signal_data->'brain_map'->>'activations_pathname' as activations_pathname
    from sessions
  `;

  // Per-take pathnames pulled separately — one row per take across all
  // sessions. New-schema sessions have 5; legacy sessions have 0.
  const takeRows = await sql<Array<{ pathname: string | null }>>`
    select t->>'pathname' as pathname
    from sessions, jsonb_array_elements(coalesce(signal_data->'takes', '[]'::jsonb)) as t
  `;

  const referenced = new Set<string>();
  for (const row of referencedRows) {
    if (row.audio_pathname) referenced.add(row.audio_pathname);
    if (row.image_pathname) referenced.add(row.image_pathname);
    if (row.activations_pathname) referenced.add(row.activations_pathname);
  }
  for (const row of takeRows) {
    if (row.pathname) referenced.add(row.pathname);
  }

  console.log(`Referenced pathnames in sessions: ${referenced.size}`);

  // ── Walk both blob prefixes, classify each as referenced or orphan ─────
  const orphans: ListBlobResultBlob[] = [];
  const kept: ListBlobResultBlob[] = [];

  for (const prefix of ["recordings/", "brain-maps/"]) {
    let cursor: string | undefined;
    do {
      const page = await list({ prefix, cursor, limit: 1000 });
      for (const blob of page.blobs) {
        if (referenced.has(blob.pathname)) {
          kept.push(blob);
        } else {
          orphans.push(blob);
        }
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
  }

  const totalBytes = (arr: ListBlobResultBlob[]) =>
    arr.reduce((sum, b) => sum + (b.size || 0), 0);

  console.log("");
  console.log(`Kept    : ${kept.length} blobs (${formatBytes(totalBytes(kept))})`);
  console.log(`Orphans : ${orphans.length} blobs (${formatBytes(totalBytes(orphans))})`);

  if (orphans.length === 0) {
    console.log("Nothing to delete.");
    await sql.end();
    return;
  }

  // Show up to 20 orphan entries for sanity-checking before deleting.
  const sample = orphans.slice(0, 20);
  console.log("");
  console.log(`First ${sample.length} orphan${sample.length === 1 ? "" : "s"}:`);
  for (const b of sample) {
    console.log(`  ${b.pathname}  ${formatBytes(b.size)}  ${b.uploadedAt.toISOString()}`);
  }
  if (orphans.length > sample.length) {
    console.log(`  ... +${orphans.length - sample.length} more`);
  }

  if (!apply) {
    console.log("");
    console.log("Dry-run only. Re-run with `-- --apply` to delete.");
    await sql.end();
    return;
  }

  // ── Delete in batches. @vercel/blob's del() accepts an array of
  //    pathnames or URLs; chunking keeps each request well under the
  //    platform's request limits.
  console.log("");
  console.log(`Deleting ${orphans.length} orphan${orphans.length === 1 ? "" : "s"} ...`);

  const BATCH = 100;
  let deleted = 0;
  for (let i = 0; i < orphans.length; i += BATCH) {
    const chunk = orphans.slice(i, i + BATCH).map((b) => b.pathname);
    await del(chunk);
    deleted += chunk.length;
    console.log(`  ${deleted} / ${orphans.length}`);
  }

  console.log(`Done. Reclaimed ${formatBytes(totalBytes(orphans))}.`);
  await sql.end();
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
