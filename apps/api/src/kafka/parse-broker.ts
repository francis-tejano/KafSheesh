export function parseBroker(broker: string): { host: string; port: number } {
  const trimmed = broker.trim();
  if (trimmed.startsWith('[')) {
    const end = trimmed.indexOf(']');
    const host = trimmed.slice(1, end);
    const port = Number(trimmed.slice(end + 2) || 9092);
    return { host, port };
  }
  const idx = trimmed.lastIndexOf(':');
  if (idx === -1) {
    return { host: trimmed, port: 9092 };
  }
  return { host: trimmed.slice(0, idx), port: Number(trimmed.slice(idx + 1) || 9092) };
}

export function brokerKey(host: string, port: number): string {
  return `${host}:${port}`;
}
