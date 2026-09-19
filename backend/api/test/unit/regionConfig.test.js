import { describe, expect, it } from 'vitest';
import { parseRegionsConfig } from '../../../../k8s/multi-region/region-config.js';

describe('parseRegionsConfig', () => {
  it('parses a valid non-empty region array', () => {
    const config = [
      { name: 'us-east-1', endpoint: 'https://us-east.example.com', primary: true },
      { name: 'eu-west-1', endpoint: 'https://eu-west.example.com', primary: false },
    ];

    expect(parseRegionsConfig(JSON.stringify(config))).toEqual(config);
  });

  it('rejects malformed JSON with a clear configuration error', () => {
    expect(() => parseRegionsConfig('[{"name":"us-east-1"}')).toThrow(
      /REGIONS must be valid JSON/,
    );
  });

  it.each([
    ['object', '{"name":"us-east-1"}'],
    ['string', '"us-east-1"'],
    ['number', '42'],
    ['null', 'null'],
    ['empty array', '[]'],
  ])('rejects a %s instead of a non-empty region array', (_label, value) => {
    expect(() => parseRegionsConfig(value)).toThrow(
      'REGIONS must be a non-empty JSON array of region objects',
    );
  });

  it.each([
    ['null entry', '[null]'],
    ['string entry', '["us-east-1"]'],
    ['array entry', '[["us-east-1"]]'],
    ['number entry', '[1]'],
  ])('rejects a %s', (_label, value) => {
    expect(() => parseRegionsConfig(value)).toThrow(/REGIONS\[0\] must be a region object/);
  });
});
