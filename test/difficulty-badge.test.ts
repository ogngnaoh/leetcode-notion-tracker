import { describe, expect, it } from 'vitest';
import { difficultyBadgeClass } from '../extension/src/difficulty-badge.js';

describe('difficultyBadgeClass', () => {
  it('maps each difficulty to a distinct style class', () => {
    expect(difficultyBadgeClass('Easy')).toBe('difficulty-badge--easy');
    expect(difficultyBadgeClass('Medium')).toBe('difficulty-badge--medium');
    expect(difficultyBadgeClass('Hard')).toBe('difficulty-badge--hard');
    expect(difficultyBadgeClass('Unknown')).toBe('difficulty-badge--unknown');
  });
});
