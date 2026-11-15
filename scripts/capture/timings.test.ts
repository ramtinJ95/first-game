import { describe, expect, it } from 'vitest';
import { mergeTimes, parseTimes, TIMES_TITLE, timesAnnotation } from './timings.ts';

describe('capture timings', () => {
  it('reads back the seconds a shard reported in its annotation', () => {
    const times = { shard: '2/8', seconds: { map: 120.5, news: 31 } };
    const [, title, message] = /^::notice title=([^:]+)::(.*)$/.exec(timesAnnotation(times)) ?? [];
    expect(title).toBe(TIMES_TITLE);
    expect(parseTimes(title ?? '', message ?? '')).toEqual(times);
  });

  it('escapes what the runner would decode, so the message it serves is the JSON written', () => {
    const times = { shard: '1/8', seconds: { 'odd%0Aname': 12 } };
    const message = /title=[^:]+::(.*)$/.exec(timesAnnotation(times))?.[1] ?? '';
    const served = message.replaceAll('%0A', '\n').replaceAll('%0D', '\r').replaceAll('%25', '%');
    expect(parseTimes(TIMES_TITLE, served)).toEqual(times);
  });

  it('ignores other annotations and refuses malformed seconds', () => {
    expect(parseTimes('memory curve', 'loads,bytes')).toBeUndefined();
    expect(() => parseTimes(TIMES_TITLE, '{"shard":"1/8","seconds":{"map":-1}}')).toThrow(
      'malformed',
    );
  });

  it('puts measured seconds in place of recorded ones and drops scenarios that are gone', () => {
    const merged = mergeTimes(
      { map: 495.8, gone: 10, news: 40 },
      [
        { shard: '1/2', seconds: { map: 300 } },
        { shard: '2/2', seconds: { fresh: 25 } },
      ],
      ['news', 'map', 'fresh'],
    );
    expect(merged).toEqual({ fresh: 25, map: 300, news: 40 });
    expect(Object.keys(merged)).toEqual(['fresh', 'map', 'news']);
  });
});
