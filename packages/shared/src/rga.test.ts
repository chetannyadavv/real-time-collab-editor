import { describe, it, expect } from 'vitest';
import { RgaDocument } from './rga';

describe('RGA core', () => {
  it('converges when concurrent inserts are applied in opposite orders', () => {
    const a = new RgaDocument('A');
    const b = new RgaDocument('B');

    for (const ch of 'cat') {
      const op = a.localInsert(a.toString().length - 1, ch);
      b.applyRemote(op);
    }
    expect(a.toString()).toBe('cat');
    expect(b.toString()).toBe('cat');

    const opA = a.localInsert(-1, 'h');
    const opB = b.localInsert(2, 's');

    a.applyRemote(opB);
    b.applyRemote(opA);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('hcats');
  });

  it('converges on a delete racing a concurrent insert near the same spot', () => {
    const a = new RgaDocument('A');
    const b = new RgaDocument('B');

    for (const ch of 'abc') {
      const op = a.localInsert(a.toString().length - 1, ch);
      b.applyRemote(op);
    }

    const delOp = a.localDelete(1);
    const insOp = b.localInsert(1, 'X');

    a.applyRemote(insOp);
    b.applyRemote(delOp);

    expect(a.toString()).toBe(b.toString());
    expect(a.toString()).toBe('acX');
  });

  it('does not interleave two forward-chained concurrent runs from a shared root', () => {
    const a = new RgaDocument('A');
    const b = new RgaDocument('B');

    const opsA = [...'cat'].map((ch, idx) => a.localInsert(idx - 1, ch));
    const opsB = [...'dog'].map((ch, idx) => b.localInsert(idx - 1, ch));

    for (const op of opsB) a.applyRemote(op);
    for (const op of opsA) b.applyRemote(op);

    expect(a.toString()).toBe(b.toString());
    expect(['catdog', 'dogcat']).toContain(a.toString());
  });
});
