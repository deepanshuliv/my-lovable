import { describe, expect, test } from 'bun:test';
import { toolCall } from './toolDefintion';

const parse = toolCall.request_api_keys;

describe('request_api_keys arguments', () => {
  test('normal request', () => {
    const result = parse({ service: 'AI chat', keys: [{ key: 'OPENAI_API_KEY', reason: 'chat' }] });
    expect(result.malformed).toBe(false);
    expect(result.service).toBe('AI chat');
    expect(result.accepted).toEqual([{ key: 'OPENAI_API_KEY', reason: 'chat' }]);
  });

  test('names are upper-cased and trimmed, duplicates dropped', () => {
    const result = parse({ service: 's', keys: [{ key: ' openai_api_key ', reason: 'a' }, { key: 'OPENAI_API_KEY', reason: 'b' }] });
    expect(result.accepted).toEqual([{ key: 'OPENAI_API_KEY', reason: 'a' }]);
  });

  test('invalid and platform names are rejected', () => {
    const result = parse({
      service: 's',
      keys: [{ key: 'my key', reason: '' }, { key: '1KEY' }, { key: 'PORT' }, { key: 'NODE_ENV' }, { key: 'OK_KEY' }],
    });
    expect(result.accepted.map((k) => k.key)).toEqual(['OK_KEY']);
    expect(result.rejected).toEqual(['my key', '1KEY', 'PORT', 'NODE_ENV']);
  });

  test('missing reason gets a default, missing service gets a default', () => {
    const result = parse({ keys: [{ key: 'A_KEY' }] });
    expect(result.service).toBe('this feature');
    expect(result.accepted[0]!.reason).toBeTruthy();
  });

  test('the old `secrets` shape is still understood', () => {
    expect(parse({ secrets: [{ key: 'A_KEY', reason: 'r' }] }).accepted.length).toBe(1);
  });

  test('malformed input is flagged, never thrown', () => {
    for (const bad of [{}, { keys: 'OPENAI_API_KEY' }, { keys: null }, { keys: { key: 'X' } }]) {
      expect(parse(bad as Record<string, unknown>).malformed).toBe(true);
    }
    expect(parse({ keys: [null, 42, 'X', { reason: 'no key' }] }).accepted).toEqual([]);
  });
});
