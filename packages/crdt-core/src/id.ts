// Every character in the document gets one of these. It never changes,
// never gets reused, and is comparable so every replica agrees on ordering.
export interface OpId {
  counter: number;    // this replica's local logical clock at the moment of insertion
  replicaId: string;  // which client/replica created this character
}

export function idsEqual(a: OpId | null, b: OpId | null): boolean {
  if (a === null || b === null) return a === b;
  return a.counter === b.counter && a.replicaId === b.replicaId;
}

// Total order over ids: compare counter first, then replicaId as a tiebreak.
// Returns > 0 if a should sort after b, < 0 if before, 0 if equal.
export function compareId(a: OpId, b: OpId): number {
  if (a.counter !== b.counter) return a.counter - b.counter;
  return a.replicaId < b.replicaId ? -1 : a.replicaId > b.replicaId ? 1 : 0;
}
