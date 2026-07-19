import { describe, it, expect } from 'vitest';
import { RgaDocument } from './rga';

function setup(): [RgaDocument, RgaDocument] {
  const a = new RgaDocument('A');
  const b = new RgaDocument('B');
  for (const ch of 'hello world') {
    const op = a.localInsert(a.toString().length - 1, ch);
    b.applyRemote(op);
  }
  return [a, b];
}

describe('rich-text marks', () => {
  it('applies bold to a range and computes correct formatted runs', () => {
    const [a] = setup();
    a.addMark('bold', 0, 4, true);
    const runs = a.getFormattedRuns();
    expect(runs[0].text).toBe('hello');
    expect(runs[0].bold).toBe(true);
    expect(runs[1].bold).toBe(false);
  });

  it('resolves concurrent, genuinely overlapping/conflicting marks identically on both replicas', () => {
    const [a, b] = setup();

    const opA = a.addMark('bold', 0, 9, true);
    const opB = b.addMark('bold', 3, 8, false);

    a.applyRemote(opB);
    b.applyRemote(opA);

    expect(a.getFormattedRuns()).toEqual(b.getFormattedRuns());
  });

  it('inherits bold formatting when a new character is inserted inside an existing bold range', () => {
    const [a, b] = setup();
    const markOp = a.addMark('bold', 0, 4, true);
    b.applyRemote(markOp);

    const insertOp = a.localInsert(2, 'X');
    b.applyRemote(insertOp);

    const runsA = a.getFormattedRuns();
    expect(a.toString().startsWith('helXlo')).toBe(true);
    expect(runsA[0].bold).toBe(true);
    expect(runsA[0].text).toBe('helXlo');
  });
});
