export type PropertyIds = Readonly<Record<string, string>>;

export interface DatabasePresentation {
  readonly icon: { readonly type: 'emoji'; readonly emoji: string };
  readonly description: string;
}

export interface ManagedView {
  readonly name: string;
  readonly type: 'table';
  readonly filter?: Record<string, unknown>;
  readonly sorts: readonly {
    readonly property: string;
    readonly direction: 'ascending' | 'descending';
  }[];
  readonly configuration: {
    readonly type: 'table';
    readonly properties: readonly {
      readonly property_id: string;
      readonly visible: true;
      readonly width: number;
      readonly wrap?: boolean;
      readonly date_format?: 'relative' | 'month_day_year';
      readonly time_format?: 'hidden' | '12_hour';
    }[];
    readonly subtasks: { readonly display_mode: 'disabled' };
    readonly wrap_cells: false;
    readonly frozen_column_index: 0;
    readonly show_vertical_lines: false;
  };
}

export const PROBLEMS_DATABASE_PRESENTATION: DatabasePresentation = {
  icon: { type: 'emoji', emoji: '🧩' },
  description: 'Current practice state and review schedule. Managed by LC Log.',
};

export const ATTEMPTS_DATABASE_PRESENTATION: DatabasePresentation = {
  icon: { type: 'emoji', emoji: '📝' },
  description: 'Immutable history of confirmed practice attempts. Managed by LC Log.',
};

export const DIFFICULTY_OPTIONS = [
  { name: 'Easy', color: 'green' },
  { name: 'Medium', color: 'yellow' },
  { name: 'Hard', color: 'red' },
  { name: 'Unknown', color: 'gray' },
] as const;

function property(
  ids: PropertyIds,
  name: string,
  width: number,
  extra: Partial<ManagedView['configuration']['properties'][number]> = {},
): ManagedView['configuration']['properties'][number] {
  const propertyId = ids[name];
  if (!propertyId) throw new Error(`Missing Notion property ID for ${name}.`);
  return { property_id: propertyId, visible: true, width, ...extra };
}

function table(
  properties: ManagedView['configuration']['properties'],
): ManagedView['configuration'] {
  return {
    type: 'table',
    properties,
    subtasks: { display_mode: 'disabled' },
    wrap_cells: false,
    frozen_column_index: 0,
    show_vertical_lines: false,
  };
}

export const PROBLEMS_REVIEW_VIEW = (ids: PropertyIds): ManagedView => ({
  name: 'Review queue',
  type: 'table',
  filter: { property: 'Next Review', date: { on_or_before: 'today' } },
  sorts: [
    { property: 'Next Review', direction: 'ascending' },
    { property: 'Problem', direction: 'ascending' },
  ],
  configuration: table([
    property(ids, 'Problem', 280, { wrap: true }),
    property(ids, 'Difficulty', 110),
    property(ids, 'Practice State', 145),
    property(ids, 'Solved Streak', 105),
    property(ids, 'Next Review', 130, { date_format: 'relative', time_format: 'hidden' }),
    property(ids, 'Topics', 260, { wrap: true }),
  ]),
});

export const PROBLEMS_ALL_VIEW = (ids: PropertyIds): ManagedView => ({
  name: 'All problems',
  type: 'table',
  sorts: [
    { property: 'Number', direction: 'ascending' },
    { property: 'Problem', direction: 'ascending' },
  ],
  configuration: table([
    property(ids, 'Problem', 280, { wrap: true }),
    property(ids, 'Number', 80),
    property(ids, 'Difficulty', 110),
    property(ids, 'Practice State', 145),
    property(ids, 'Solved Streak', 105),
    property(ids, 'Last Attempt', 145, { date_format: 'month_day_year', time_format: '12_hour' }),
    property(ids, 'Next Review', 130, { date_format: 'relative', time_format: 'hidden' }),
    property(ids, 'Topics', 260, { wrap: true }),
  ]),
});

export const ATTEMPTS_VIEW = (ids: PropertyIds): ManagedView => ({
  name: 'Recent attempts',
  type: 'table',
  sorts: [{ property: 'Attempted At', direction: 'descending' }],
  configuration: table([
    property(ids, 'Attempt', 320, { wrap: true }),
    property(ids, 'Result', 125),
    property(ids, 'Language', 115),
    property(ids, 'Attempted At', 175, { date_format: 'month_day_year', time_format: '12_hour' }),
    property(ids, 'Resulting State', 145),
    property(ids, 'Resulting Solved Streak', 150),
    property(ids, 'Resulting Next Review', 155, {
      date_format: 'relative',
      time_format: 'hidden',
    }),
  ]),
});

function descriptionText(value: unknown): string {
  if (!Array.isArray(value)) return '';
  return value.map((item: any) => item?.plain_text ?? item?.text?.content ?? '').join('');
}

export function verifyDatabasePresentation(
  response: unknown,
  label: string,
  expected: DatabasePresentation,
): void {
  const database = response as any;
  if (database?.icon?.type !== 'emoji' || database.icon.emoji !== expected.icon.emoji) {
    throw new Error(`${label} icon mismatch.`);
  }
  if (descriptionText(database?.description) !== expected.description) {
    throw new Error(`${label} description mismatch.`);
  }
  if (database?.cover != null) throw new Error(`${label} cover must be empty.`);
  if (database?.is_locked === true) throw new Error(`${label} must not be locked.`);
}

function normalized(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalized);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined && item !== null)
      .map(([key, item]) => [key, normalized(item)]),
  );
}

export function verifyManagedView(response: unknown, expected: ManagedView): void {
  const actual = response as any;
  const actualProperties = Array.isArray(actual?.configuration?.properties)
    ? actual.configuration.properties
    : [];
  const propertyNames = new Map<string, string>(
    actualProperties
      .filter(
        (item: any) =>
          typeof item.property_id === 'string' && typeof item.property_name === 'string',
      )
      .map((item: any) => [item.property_id, item.property_name]),
  );
  const ownedPropertyIds = new Set(
    expected.configuration.properties.map(({ property_id }) => property_id),
  );
  const translateProperty = (item: any): any =>
    item && typeof item === 'object' && typeof item.property === 'string'
      ? { ...item, property: propertyNames.get(item.property) ?? item.property }
      : item;
  const comparable = {
    name: actual?.name,
    type: actual?.type,
    filter: translateProperty(actual?.filter),
    sorts: (actual?.sorts ?? []).map(translateProperty),
    configuration: {
      type: actual?.configuration?.type,
      properties: actualProperties
        .filter((item: any) => item.visible === true || ownedPropertyIds.has(item.property_id))
        .map(({ property_name: _propertyName, ...item }: any) => item),
      subtasks: { display_mode: actual?.configuration?.subtasks?.display_mode },
      wrap_cells: actual?.configuration?.wrap_cells,
      frozen_column_index: actual?.configuration?.frozen_column_index,
      show_vertical_lines: actual?.configuration?.show_vertical_lines,
    },
  };
  if (JSON.stringify(normalized(comparable)) !== JSON.stringify(normalized(expected))) {
    throw new Error(
      `${expected.name} view mismatch. Expected ${JSON.stringify(normalized(expected))}; received ${JSON.stringify(normalized(comparable))}.`,
    );
  }
}

export function propertyIds(response: unknown): Record<string, string> {
  const properties = (response as any)?.properties;
  if (!properties || typeof properties !== 'object')
    throw new Error('Missing data source properties.');
  return Object.fromEntries(
    Object.entries(properties).map(([name, value]: [string, any]) => [
      name,
      decodeURIComponent(value.id),
    ]),
  );
}
