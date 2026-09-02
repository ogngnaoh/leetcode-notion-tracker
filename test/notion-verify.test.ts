import { describe, expect, it } from 'vitest';
import { verifyV2DataSource } from '../src/notion/verify.js';
import {
  REQUIRED_ATTEMPTS_TYPES,
  REQUIRED_PROBLEMS_TYPES,
  RESULT_OPTIONS,
  STATE_OPTIONS,
} from '../src/notion/schema.js';

function dataSource(
  types: Record<string, string>,
  relations: Record<string, string>,
  options: Record<string, readonly { name: string; color: string }[]>,
): any {
  return {
    object: 'data_source',
    id: 'source',
    properties: Object.fromEntries(
      Object.entries(types).map(([name, type]) => [
        name,
        {
          id: name,
          name,
          type,
          [type]:
            type === 'relation'
              ? { data_source_id: relations[name], type: 'dual_property', dual_property: {} }
              : type === 'select'
                ? { options: options[name] ?? [] }
                : {},
        },
      ]),
    ),
  };
}

describe('verifyV2DataSource', () => {
  it('allows only explicitly configured optional Grind fields with their exact types', () => {
    const source = dataSource(
      { ...REQUIRED_PROBLEMS_TYPES, 'Grind Open': 'formula' },
      { Attempts: 'attempts-source' },
      { 'Practice State': STATE_OPTIONS },
    );
    const options = {
      relation: { name: 'Attempts', dataSourceId: 'attempts-source' },
      selects: { 'Practice State': STATE_OPTIONS },
      optionalTypes: { 'Grind Open': 'formula' },
    };
    expect(() =>
      verifyV2DataSource(source, 'Problems', REQUIRED_PROBLEMS_TYPES, options),
    ).not.toThrow();
    source.properties['Grind Open'].type = 'rich_text';
    expect(() => verifyV2DataSource(source, 'Problems', REQUIRED_PROBLEMS_TYPES, options)).toThrow(
      'expected formula',
    );
  });

  it('accepts exact v2 types, reciprocal relation target, and native option colors', () => {
    const problems = dataSource(
      REQUIRED_PROBLEMS_TYPES,
      { Attempts: 'attempts-source' },
      { 'Practice State': STATE_OPTIONS },
    );
    expect(() =>
      verifyV2DataSource(problems, 'LeetCode Problems', REQUIRED_PROBLEMS_TYPES, {
        relation: { name: 'Attempts', dataSourceId: 'attempts-source' },
        selects: { 'Practice State': STATE_OPTIONS },
      }),
    ).not.toThrow();

    const attempts = dataSource(
      REQUIRED_ATTEMPTS_TYPES,
      { Problem: 'problems-source' },
      { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
    );
    expect(() =>
      verifyV2DataSource(attempts, 'LeetCode Attempts', REQUIRED_ATTEMPTS_TYPES, {
        relation: { name: 'Problem', dataSourceId: 'problems-source' },
        selects: { Result: RESULT_OPTIONS, 'Resulting State': STATE_OPTIONS },
      }),
    ).not.toThrow();
  });

  it('rejects extras, mistyped fields, wrong relations, and wrong colors', () => {
    const exact = dataSource(
      REQUIRED_PROBLEMS_TYPES,
      { Attempts: 'attempts-source' },
      { 'Practice State': STATE_OPTIONS },
    );
    const options = {
      relation: { name: 'Attempts', dataSourceId: 'attempts-source' },
      selects: { 'Practice State': STATE_OPTIONS },
    };

    expect(() =>
      verifyV2DataSource(
        { ...exact, properties: { ...exact.properties, Surprise: { type: 'rich_text' } } },
        'Problems',
        REQUIRED_PROBLEMS_TYPES,
        options,
      ),
    ).toThrow('Surprise: unexpected');
    expect(() =>
      verifyV2DataSource(
        {
          ...exact,
          properties: {
            ...exact.properties,
            Topics: { ...exact.properties.Topics, type: 'rich_text' },
          },
        },
        'Problems',
        REQUIRED_PROBLEMS_TYPES,
        options,
      ),
    ).toThrow('Topics: expected multi_select, received rich_text');
    expect(() =>
      verifyV2DataSource(exact, 'Problems', REQUIRED_PROBLEMS_TYPES, {
        ...options,
        relation: { name: 'Attempts', dataSourceId: 'wrong-source' },
      }),
    ).toThrow('Attempts: wrong relation target');

    const wrongColors = structuredClone(exact);
    wrongColors.properties['Practice State'].select.options[0].color = 'red';
    expect(() =>
      verifyV2DataSource(wrongColors, 'Problems', REQUIRED_PROBLEMS_TYPES, options),
    ).toThrow('Practice State: select options/colors mismatch');

    const singleRelation = structuredClone(exact);
    singleRelation.properties.Attempts.relation = {
      data_source_id: 'attempts-source',
      type: 'single_property',
      single_property: {},
    };
    expect(() =>
      verifyV2DataSource(singleRelation, 'Problems', REQUIRED_PROBLEMS_TYPES, options),
    ).toThrow('Attempts: relation must be reciprocal dual_property');
  });

  it('rejects a Difficulty select whose required option names are incomplete', () => {
    const problems = dataSource(
      REQUIRED_PROBLEMS_TYPES,
      { Attempts: 'attempts-source' },
      {
        Difficulty: [{ name: 'Easy', color: 'green' }],
        'Practice State': STATE_OPTIONS,
      },
    );

    expect(() =>
      verifyV2DataSource(problems, 'Problems', REQUIRED_PROBLEMS_TYPES, {
        relation: { name: 'Attempts', dataSourceId: 'attempts-source' },
        selects: { 'Practice State': STATE_OPTIONS },
        selectNames: { Difficulty: ['Easy', 'Medium', 'Hard', 'Unknown'] },
      }),
    ).toThrow('Difficulty: select option names mismatch');
  });
});
