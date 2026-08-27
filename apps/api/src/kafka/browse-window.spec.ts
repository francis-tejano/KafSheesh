import { browseStartOffset, browseWindowSize } from './browse-window';

describe('browseWindowSize', () => {
  it('splits the limit across partitions', () => {
    expect(browseWindowSize(50, 1)).toBe(50n);
    expect(browseWindowSize(50, 5)).toBe(10n);
  });
});

describe('browseStartOffset', () => {
  it('returns the only record on a one-message topic', () => {
    expect(
      browseStartOffset({
        low: '0',
        high: '1',
        direction: 'latest',
        window: 50n,
      }),
    ).toBe('0');
  });

  it('seeks near the high watermark for latest', () => {
    expect(
      browseStartOffset({
        low: '0',
        high: '1000',
        direction: 'latest',
        window: 50n,
      }),
    ).toBe('950');
  });

  it('starts at the log start for earliest', () => {
    expect(
      browseStartOffset({
        low: '10',
        high: '40',
        direction: 'earliest',
        window: 50n,
      }),
    ).toBe('10');
  });

  it('returns null for an empty partition', () => {
    expect(
      browseStartOffset({
        low: '7',
        high: '7',
        direction: 'latest',
        window: 50n,
      }),
    ).toBeNull();
  });

  it('clamps an explicit offset to the log start', () => {
    expect(
      browseStartOffset({
        low: '20',
        high: '30',
        direction: 'offset',
        offset: '5',
        window: 50n,
      }),
    ).toBe('20');
  });
});
