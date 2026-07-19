import { describe, it, expect } from 'vitest';
import { RgaDocument, IMAGE_PLACEHOLDER } from './rga';

describe('image nodes', () => {
  it('inserts, positions, and converges correctly across replicas', () => {
    const a = new RgaDocument('A');
    const b = new RgaDocument('B');

    for (const ch of 'hello world') {
      const op = a.localInsert(a.toString().length - 1, ch);
      b.applyRemote(op);
    }
    const op = a.localInsertImage(5, 'https://example.com/cat.png');
    b.applyRemote(op);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe(`hello ${IMAGE_PLACEHOLDER}world`);

    const positionsA = a.getImagePositions();
    expect(positionsA).toHaveLength(1);
    expect(positionsA[0].visibleIndex).toBe(6);
    expect(positionsA[0].src).toBe('https://example.com/cat.png');
  });

  it('deletes like any other node', () => {
    const a = new RgaDocument('A');
    const b = new RgaDocument('B');
    for (const ch of 'hello world') {
      const op = a.localInsert(a.toString().length - 1, ch);
      b.applyRemote(op);
    }
    const insertOp = a.localInsertImage(5, 'https://example.com/cat.png');
    b.applyRemote(insertOp);

    const visIdx = a.getImagePositions()[0].visibleIndex;
    const delOp = a.localDelete(visIdx);
    b.applyRemote(delOp);

    expect(a.toString()).toBe('hello world');
    expect(a.toString()).toBe(b.toString());
    expect(a.getImagePositions()).toHaveLength(0);
  });
});
