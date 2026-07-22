import { describe, expect, it } from 'vitest';
import {
  ATTEMPTS_DATABASE_PRESENTATION,
  ATTEMPTS_VIEW,
  DIFFICULTY_OPTIONS,
  PROBLEMS_ALL_VIEW,
  PROBLEMS_DATABASE_PRESENTATION,
  PROBLEMS_REVIEW_VIEW,
  verifyDatabasePresentation,
  verifyManagedView,
} from '../src/notion/presentation.js';

const propertyIds = Object.fromEntries(
  [
    'Problem',
    'Number',
    'Difficulty',
    'Practice State',
    'Solved Streak',
    'Last Attempt',
    'Next Review',
    'Topics',
    'URL',
    'First Solved',
    'Attempt',
    'Result',
    'Language',
    'Attempted At',
    'Resulting State',
    'Resulting Solved Streak',
    'Resulting Next Review',
  ].map((name) => [name, `${name}-id`]),
);

describe('lasting Notion presentation contract', () => {
  it('defines exact database icons, descriptions, and Difficulty colors', () => {
    expect(PROBLEMS_DATABASE_PRESENTATION).toEqual({
      icon: { type: 'emoji', emoji: '🧩' },
      description: 'Current practice state and review schedule. Managed by LC Log.',
    });
    expect(ATTEMPTS_DATABASE_PRESENTATION).toEqual({
      icon: { type: 'emoji', emoji: '📝' },
      description: 'Immutable history of confirmed practice attempts. Managed by LC Log.',
    });
    expect(DIFFICULTY_OPTIONS).toEqual([
      { name: 'Easy', color: 'green' },
      { name: 'Medium', color: 'yellow' },
      { name: 'Hard', color: 'red' },
      { name: 'Unknown', color: 'gray' },
    ]);
  });

  it('defines the exact three managed table views', () => {
    expect(PROBLEMS_REVIEW_VIEW(propertyIds)).toMatchObject({
      name: 'Review queue',
      type: 'table',
      filter: { property: 'Next Review', date: { on_or_before: 'today' } },
      sorts: [
        { property: 'Next Review', direction: 'ascending' },
        { property: 'Problem', direction: 'ascending' },
      ],
    });
    expect(PROBLEMS_ALL_VIEW(propertyIds)).toMatchObject({
      name: 'All problems',
      type: 'table',
      sorts: [
        { property: 'Number', direction: 'ascending' },
        { property: 'Problem', direction: 'ascending' },
      ],
    });
    expect(ATTEMPTS_VIEW(propertyIds)).toMatchObject({
      name: 'Recent attempts',
      type: 'table',
      sorts: [{ property: 'Attempted At', direction: 'descending' }],
    });
  });

  it('keeps only intended properties visible with deliberate table formatting', () => {
    const review = PROBLEMS_REVIEW_VIEW(propertyIds);
    expect(review.configuration).toMatchObject({
      type: 'table',
      frozen_column_index: 0,
      show_vertical_lines: false,
      subtasks: { display_mode: 'disabled' },
    });
    expect(review.configuration.properties?.map((property) => property.property_id)).toEqual(
      ['Problem', 'Difficulty', 'Practice State', 'Solved Streak', 'Next Review', 'Topics'].map(
        (name) => `${name}-id`,
      ),
    );
    expect(
      review.configuration.properties?.find((property) => property.property_id === 'Problem-id'),
    ).toMatchObject({ visible: true, wrap: true });
    expect(
      review.configuration.properties?.find((property) => property.property_id === 'Topics-id'),
    ).toMatchObject({ visible: true, wrap: true });
    expect(
      review.configuration.properties?.find(
        (property) => property.property_id === 'Next Review-id',
      ),
    ).toMatchObject({ date_format: 'relative', time_format: 'hidden' });

    const attempts = ATTEMPTS_VIEW(propertyIds);
    expect(
      attempts.configuration.properties?.find(
        (property) => property.property_id === 'Attempted At-id',
      ),
    ).toMatchObject({ date_format: 'month_day_year', time_format: '12_hour' });
  });

  it('rejects presentation drift in database and managed-view read-back', () => {
    expect(() =>
      verifyDatabasePresentation(
        { icon: { type: 'emoji', emoji: '🧩' }, description: [{ plain_text: 'wrong' }] },
        'LeetCode Problems',
        PROBLEMS_DATABASE_PRESENTATION,
      ),
    ).toThrow('description mismatch');

    const expected = PROBLEMS_REVIEW_VIEW(propertyIds);
    expect(() =>
      verifyManagedView(
        { ...expected, configuration: { ...expected.configuration, show_vertical_lines: true } },
        expected,
      ),
    ).toThrow('Review queue view mismatch');

    expect(() =>
      verifyManagedView(
        {
          ...expected,
          configuration: {
            ...expected.configuration,
            properties: [
              ...expected.configuration.properties,
              { property_id: 'External Key-id', visible: true, width: 160 },
            ],
          },
        },
        expected,
      ),
    ).toThrow('Review queue view mismatch');
  });
});
