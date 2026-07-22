import { describe, expect, it } from 'vitest';
import { readBridgeEnv } from '../src/bridge/env.js';

const base = {
  NOTION_TOKEN: 'ntn_test',
  BRIDGE_TOKEN: 'a-very-long-personal-bridge-token',
};

describe('bridge environment', () => {
  it('defaults the daily goal to 10 and accepts positive integers', () => {
    expect(readBridgeEnv(base).DAILY_NEW_PROBLEM_GOAL).toBe(10);
    expect(readBridgeEnv({ ...base, DAILY_NEW_PROBLEM_GOAL: '7' }).DAILY_NEW_PROBLEM_GOAL).toBe(7);
  });

  it.each(['0', '-1', '1.5', ' 10', '101', 'abc'])('rejects invalid daily goal %s', (value) => {
    expect(() => readBridgeEnv({ ...base, DAILY_NEW_PROBLEM_GOAL: value })).toThrow();
  });
});
