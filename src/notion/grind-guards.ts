export function dailyViewPatch(ids: Record<string, string>, day: number) {
  const id = (name: string) => {
    if (!ids[name]) throw new Error(`Missing Grind property: ${name}.`);
    return decodeURIComponent(ids[name]);
  };
  return {
    filter: { property: id('Grind Day'), select: { equals: `Day ${day}` } },
    sorts: [{ property: id('Grind Order'), direction: 'ascending' as const }],
    configuration: {
      type: 'table' as const,
      properties: [
        { property_id: id('Problem'), visible: true, width: 360 },
        { property_id: id('Grind Done'), visible: true, width: 130 },
        { property_id: id(ids.Solution ? 'Solution' : 'Grind Open'), visible: true, width: 410 },
      ],
      group_by: {
        type: 'select' as const,
        property_id: id('Grind Block'),
        sort: { type: 'manual' as const },
        hide_empty_groups: true,
      },
      wrap_cells: true,
      frozen_column_index: 0,
    },
  };
}
function subset(actual: any, expected: any): boolean {
  if (Array.isArray(expected))
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((e, i) => subset(actual[i], e))
    );
  if (expected && typeof expected === 'object')
    return !!actual && Object.entries(expected).every(([k, v]) => subset(actual[k], v));
  return actual === expected;
}
export function guardDrift(view: any, patch: ReturnType<typeof dailyViewPatch>): boolean {
  const actual = {
    ...view,
    configuration: {
      ...view.configuration,
      properties: view.configuration?.properties?.filter((p: any) => p.visible),
    },
  };
  return !subset(actual, patch);
}
