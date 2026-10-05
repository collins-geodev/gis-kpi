/**
 * Cross-employee duplicate evidence detection. Two live evidence items are
 * treated as the same file when they share any of:
 *
 *  - a content checksum (SHA-256, computed in the browser at upload);
 *  - the same external link;
 *  - the same original filename AND byte size (legacy uploads without a
 *    checksum — a filename alone is too common to flag on).
 *
 * Only matches across DIFFERENT employees are reported: one person re-using
 * their own proof is not the integrity risk this warns about.
 */
export interface DuplicateCandidate {
  id: string;
  employeeId: string;
  checksum?: string | null;
  externalUrl?: string | null;
  originalFilename: string;
  fileSize: number;
}

export function duplicateKeys(e: DuplicateCandidate): string[] {
  const keys: string[] = [];
  if (e.checksum) keys.push(`sum:${e.checksum.toLowerCase()}`);
  if (e.externalUrl) keys.push(`url:${e.externalUrl.trim().toLowerCase()}`);
  if (!e.externalUrl && e.fileSize > 0) {
    keys.push(`name:${e.originalFilename.trim().toLowerCase()}|${e.fileSize}`);
  }
  return keys;
}

/**
 * For every candidate, the OTHER employees holding the same file.
 * Candidates with no cross-employee match are absent from the result.
 */
export function crossEmployeeDuplicates(
  files: DuplicateCandidate[],
): Map<string, Set<string>> {
  const byKey = new Map<string, DuplicateCandidate[]>();
  for (const f of files) {
    for (const k of duplicateKeys(f)) {
      const list = byKey.get(k);
      if (list) list.push(f);
      else byKey.set(k, [f]);
    }
  }
  const out = new Map<string, Set<string>>();
  for (const group of byKey.values()) {
    if (group.length < 2) continue;
    for (const f of group) {
      for (const other of group) {
        if (other.employeeId === f.employeeId) continue;
        const set = out.get(f.id) ?? new Set<string>();
        set.add(other.employeeId);
        out.set(f.id, set);
      }
    }
  }
  return out;
}
