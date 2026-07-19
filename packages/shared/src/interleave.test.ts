import { describe, it, expect } from 'vitest';
import { RgaDocument } from './rga';

function setup(): [RgaDocument, RgaDocument] {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  for (const ch of 'list') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }
  return [a, b];
}

function prependBackward(doc: RgaDocument, word: string) {
  return [...word].map((ch) => doc.insertAfterId(null, ch));
}

describe('known limitation: naive non-chained prepend interleaves', () => {
  it('still converges (CRDT guarantee holds) but produces a garbled, non-readable result', () => {
    const [a, b] = setup();

    const opsA = prependBackward(a, 'bread');
    const opsB = prependBackward(b, 'fruit');

    for (const op of opsB) a.applyRemote(op);
    for (const op of opsA) b.applyRemote(op);

    expect(a.toString()).toBe(b.toString());

    const readable = a.toString() === 'breadfruitlist' || a.toString() === 'fruitbreadlist';
    expect(readable).toBe(false);
  });
});
