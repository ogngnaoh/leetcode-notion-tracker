import type { Difficulty } from '../../src/shared/contract.js';

export function difficultyBadgeClass(difficulty: Difficulty): string {
  switch (difficulty) {
    case 'Easy':
      return 'difficulty-badge--easy';
    case 'Medium':
      return 'difficulty-badge--medium';
    case 'Hard':
      return 'difficulty-badge--hard';
    case 'Unknown':
      return 'difficulty-badge--unknown';
    default:
      return 'difficulty-badge--unknown';
  }
}
