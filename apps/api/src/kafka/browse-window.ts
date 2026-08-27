export type BrowseDirection = 'latest' | 'earliest' | 'offset';

export function browseWindowSize(
  limit: number,
  partitionCount: number,
): bigint {
  const parts = Math.max(1, partitionCount);
  return BigInt(Math.max(1, Math.ceil(limit / parts)));
}

/** Start offset for a partition peek, or null when the log is empty. */
export function browseStartOffset(input: {
  low: string;
  high: string;
  direction?: BrowseDirection;
  offset?: string;
  window: bigint;
}): string | null {
  const low = BigInt(input.low);
  const high = BigInt(input.high);
  if (high <= low) {
    return null;
  }
  let start = low;
  if (input.direction === 'offset' && input.offset) {
    start = BigInt(input.offset);
  } else if (input.direction !== 'earliest') {
    start = high > input.window ? high - input.window : low;
  }
  if (start < low) {
    start = low;
  }
  if (start >= high) {
    return null;
  }
  return start.toString();
}
