import { isLoopbackHost, rewriteLoopbackBrokers } from './parse-broker';

describe('isLoopbackHost', () => {
  it('accepts loopback names', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
  });

  it('rejects advertised broker hosts', () => {
    expect(isLoopbackHost('kf-ttsm-004-sit-001.example.net')).toBe(false);
  });
});

describe('rewriteLoopbackBrokers', () => {
  const previous = process.env.KAFSHEESH_COMPOSE_KAFKA_HOST;

  afterEach(() => {
    if (previous === undefined) {
      delete process.env.KAFSHEESH_COMPOSE_KAFKA_HOST;
    } else {
      process.env.KAFSHEESH_COMPOSE_KAFKA_HOST = previous;
    }
  });

  it('rewrites localhost to the Compose Kafka hostname', () => {
    process.env.KAFSHEESH_COMPOSE_KAFKA_HOST = 'kafka';
    expect(rewriteLoopbackBrokers(['localhost:9092'])).toEqual(['kafka:9092']);
  });
});
