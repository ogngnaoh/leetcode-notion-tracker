type SelectOption = { readonly name: string; readonly color: string };

export interface DataSourceVerificationOptions {
  relation: { name: string; dataSourceId: string };
  selects: Record<string, readonly SelectOption[]>;
  selectNames?: Record<string, readonly string[]>;
}

export function verifyV2DataSource(
  response: unknown,
  label: string,
  expected: Record<string, string>,
  options: DataSourceVerificationOptions,
): void {
  const properties = (response as any)?.properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) {
    throw new Error(`Notion returned only a partial or invalid ${label} data source.`);
  }

  const failures: string[] = [];
  for (const name of Object.keys(properties)) {
    if (!expected[name]) failures.push(`${name}: unexpected`);
  }
  for (const [name, type] of Object.entries(expected)) {
    const property = properties[name];
    if (!property) {
      failures.push(`${name}: missing`);
    } else if (property.type !== type) {
      failures.push(`${name}: expected ${type}, received ${String(property.type)}`);
    }
  }

  const relation = properties[options.relation.name];
  if (relation?.type === 'relation') {
    if (relation.relation?.data_source_id !== options.relation.dataSourceId) {
      failures.push(`${options.relation.name}: wrong relation target`);
    }
    if (
      relation.relation?.type !== 'dual_property' ||
      !relation.relation?.dual_property ||
      typeof relation.relation.dual_property !== 'object'
    ) {
      failures.push(`${options.relation.name}: relation must be reciprocal dual_property`);
    }
  }

  for (const [name, expectedOptions] of Object.entries(options.selects)) {
    const actual = properties[name]?.select?.options;
    const normalized = Array.isArray(actual)
      ? actual.map((item: any) => ({ name: item.name, color: item.color }))
      : [];
    if (JSON.stringify(normalized) !== JSON.stringify(expectedOptions)) {
      failures.push(`${name}: select options/colors mismatch`);
    }
  }

  for (const [name, expectedNames] of Object.entries(options.selectNames ?? {})) {
    const actual = properties[name]?.select?.options;
    const names = Array.isArray(actual) ? actual.map((item: any) => item.name) : [];
    if (JSON.stringify(names) !== JSON.stringify(expectedNames)) {
      failures.push(`${name}: select option names mismatch`);
    }
  }

  if (failures.length > 0) {
    throw new Error(`${label} schema mismatch:\n- ${failures.join('\n- ')}`);
  }
}
