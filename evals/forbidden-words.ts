/**
 * Thin re-export so the eval harness and production analyze route share
 * a single audit implementation. See lib/forbidden-words.ts.
 */
export { auditSignalData, type ForbiddenWordHit } from "@/lib/forbidden-words";
