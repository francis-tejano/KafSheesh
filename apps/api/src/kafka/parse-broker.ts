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

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

/** In Compose the API is not the host, so localhost:9092 would hit this container. */
export function rewriteLoopbackBrokers(brokers: string[]): string[] {
  const composeHost = process.env.KAFSHEESH_COMPOSE_KAFKA_HOST?.trim();
  if (!composeHost) {
    return brokers;
  }
  return brokers.map((broker) => {
    const parsed = parseBroker(broker);
    if (!LOOPBACK.has(parsed.host.toLowerCase())) {
      return broker;
    }
    return brokerKey(composeHost, parsed.port);
  });
}
