import { describe, it, expect } from 'vitest';
import { hasNativeTools } from '../../apps/bridge/src/codex/native-profile-probe';

describe('effective native tool catalog', () => {
  it('recognizes both Responses tool transports and rejects instructions that merely mention tools', () => {
    expect(hasNativeTools({ tools: [{ type: 'function', name: 'terminal' }] })).toBe(true);
    expect(hasNativeTools({ input: [{ type: 'additional_tools', tools: [{ type: 'namespace', name: 'functions', tools: [{ name: 'exec' }] }] }] })).toBe(true);
    expect(hasNativeTools({ instructions: 'You have tools', tools: [] })).toBe(false);
    expect(hasNativeTools({ input: [{ type: 'message', tools: ['not an advertised tool'] }] })).toBe(false);
    expect(hasNativeTools({ input: [null, 'invalid', { type: 'additional_tools', tools: [] }] })).toBe(false);
  });
});
