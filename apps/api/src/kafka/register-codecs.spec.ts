import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import { registerCompressionCodecs } from './register-codecs';

describe('registerCompressionCodecs', () => {
  beforeAll(() => {
    registerCompressionCodecs();
  });

  it('registers an LZ4 codec that round-trips bytes', async () => {
    const factory = CompressionCodecs[CompressionTypes.LZ4];
    expect(typeof factory).toBe('function');
    const codec = factory() as {
      compress: (encoder: { buffer: Buffer }) => Promise<Buffer>;
      decompress: (buffer: Buffer) => Promise<Buffer>;
    };
    const input = Buffer.from('ttsm.AuditRequests lz4 peek');
    const compressed = await codec.compress({ buffer: input });
    const output = await codec.decompress(compressed);
    expect(Buffer.from(output).toString()).toBe(input.toString());
  });
});
