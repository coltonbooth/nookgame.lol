import { describe, expect, it } from 'vitest';
import {
  MARKER_ONE_IN,
  NO_MARKER,
  createGame,
  type Slot,
} from './game';
import { PIECES, type PieceId } from './pieces';
import {
  CHARGED_MARKER_ONE_IN,
  MUTATORS,
  allowsPiece,
  describeMutator,
  fogHides,
  mutatorForWeek,
  type Mutator,
} from './mutators';

const byName = (name: string): PieceId => {
  const p = PIECES.find((piece) => piece.name === name);
  if (!p) throw new Error(`no piece named ${name}`);
  return p.id;
};

const slot = (piece: PieceId): Slot => ({
  piece,
  color: 1,
  marker: NO_MARKER,
  markerKind: 'gem',
});

describe('the weekly slot', () => {
  it('rotates and wraps', () => {
    expect(mutatorForWeek(0)).toBe(MUTATORS[0]);
    expect(mutatorForWeek(MUTATORS.length)).toBe(MUTATORS[0]);
    expect(mutatorForWeek(MUTATORS.length + 1)).toBe(MUTATORS[1]);
  });

  it('survives a negative week rather than returning undefined', () => {
    // Anyone with a clock set before the epoch still gets a real rule.
    for (const week of [-1, -7, -12]) {
      expect(MUTATORS).toContain(mutatorForWeek(week));
    }
  });

  it('describes every rule in the house voice', () => {
    for (const m of MUTATORS) {
      const text = describeMutator(m);
      expect(text.length).toBeGreaterThan(0);
      expect(text).toBe(text.toLowerCase());
    }
  });
});

describe('spare', () => {
  it('takes the singles and dominoes out of the bag', () => {
    expect(allowsPiece('spare', byName('1x1'))).toBe(false);
    expect(allowsPiece('spare', byName('2x1'))).toBe(false);
    expect(allowsPiece('spare', byName('1x2'))).toBe(false);
  });

  it('keeps everything from a triomino up', () => {
    expect(allowsPiece('spare', byName('3x1'))).toBe(true);
    expect(allowsPiece('spare', byName('3x3'))).toBe(true);
  });

  it('leaves the bag alone under any other rule', () => {
    for (const m of [null, 'fog', 'charged'] as Array<Mutator | null>) {
      expect(allowsPiece(m, byName('1x1'))).toBe(true);
    }
  });
});

describe('charged', () => {
  /** Every marker on the tray of a freshly dealt game. */
  const dealtKinds = (options: Parameters<typeof createGame>[0]): string[] =>
    createGame(options).tray.flatMap((s) =>
      s && s.marker !== NO_MARKER ? [s.markerKind] : [],
    );

  it('turns every marker into a charge, overriding the policy', () => {
    // markerOneIn: 1 marks every piece, so one deal is a full sample.
    for (let seed = 0; seed < 12; seed++) {
      const kinds = dealtKinds({ seed, mutator: 'charged', markerOneIn: 1 });
      expect(kinds).toHaveLength(3);
      expect(new Set(kinds)).toEqual(new Set(['charge']));
    }
  });

  it('overrides a sealed Nook, which would otherwise force gems', () => {
    const kinds = dealtKinds({
      seed: 5,
      mutator: 'charged',
      markerOneIn: 1,
      nookUnlocked: false,
    });
    expect(kinds).not.toContain('gem');
  });

  it('leaves the ordinary marker kinds alone without the rule', () => {
    const kinds = dealtKinds({ seed: 5, markerOneIn: 1, nookUnlocked: false });
    expect(new Set(kinds)).toEqual(new Set(['gem']));
  });

  it('deals markers far more often than an ordinary run', () => {
    expect(CHARGED_MARKER_ONE_IN).toBeLessThan(MARKER_ONE_IN);
  });
});

describe('fog', () => {
  const full = [slot(0), slot(0), slot(0)];

  it('hides the third slot while the others still hold pieces', () => {
    expect(fogHides('fog', 2, full)).toBe(true);
  });

  it('reveals it once the other two are played', () => {
    expect(fogHides('fog', 2, [null, null, slot(0)])).toBe(false);
  });

  it('never touches the first two slots', () => {
    expect(fogHides('fog', 0, full)).toBe(false);
    expect(fogHides('fog', 1, full)).toBe(false);
  });

  it('does nothing under any other rule', () => {
    for (const m of [null, 'spare', 'charged'] as Array<Mutator | null>) {
      expect(fogHides(m, 2, full)).toBe(false);
    }
  });
});
