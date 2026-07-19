import { describe, it, expect } from 'vitest';
import { RgaDocument } from './rga';
import type { OpId } from './id';

function setup(): [RgaDocument, RgaDocument] {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  for (const ch of 'list') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }
  return [a, b];
}

function prependProperly(doc: RgaDocument, word: string, beforeCharId: OpId) {
  const ops = [];
  const first = doc.insertBeforeId(beforeCharId, word[0]);
  ops.push(first);
  let prevId = first.id;
  for (const ch of word.slice(1)) {
    const op = doc.insertAfterId(prevId, ch);
    ops.push(op);
    prevId = op.id;
  }
  return ops;
}

describe('Fugue extension fixes the prepend interleaving anomaly', () => {
  it('converges cleanly with proper word boundaries, not a garbled mix', () => {
    const [a, b] = setup();

    const frontIdA = a.getSnapshotNodes().find((n) => n.char === 'l')!.id;
    const frontIdB = b.getSnapshotNodes().find((n) => n.char === 'l')!.id;

    const opsA = prependProperly(a, 'bread', frontIdA);
    const opsB = prependProperly(b, 'fruit', frontIdB);

    for (const op of opsB) a.applyRemote(op);
    for (const op of opsA) b.applyRemote(op);

    expect(a.toString()).toBe(b.toString());
    expect(['breadfruitlist', 'fruitbreadlist']).toContain(a.toString());
  });

  it('is genuinely commutative: a different valid interleaving of the two op-streams converges to the same result', () => {
    const [a, b] = setup();
    const frontIdA = a.getSnapshotNodes().find((n) => n.char === 'l')!.id;
    const frontIdB = b.getSnapshotNodes().find((n) => n.char === 'l')!.id;
    const opsA = prependProperly(a, 'bread', frontIdA);
    const opsB = prependProperly(b, 'fruit', frontIdB);
    for (const op of opsB) a.applyRemote(op);
    for (const op of opsA) b.applyRemote(op);

    const [c] = setup();
    const interleaved: typeof opsA = [];
    const maxLen = Math.max(opsA.length, opsB.length);
    for (let i = 0; i < maxLen; i++) {
      if (opsB[i]) interleaved.push(opsB[i]);
      if (opsA[i]) interleaved.push(opsA[i]);
    }
    for (const op of interleaved) c.applyRemote(op);

    expect(c.toString()).toBe(a.toString());
  });
});
