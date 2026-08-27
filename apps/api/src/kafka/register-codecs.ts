import { CompressionCodecs, CompressionTypes } from 'kafkajs';
import SnappyCodec from 'kafkajs-snappy';
import * as lz4js from 'lz4js';

let registered = false;

function asBuffer(value: Uint8Array): Buffer {
  return Buffer.isBuffer(value) ? value : Buffer.from(value);
}

const lz4Codec = {
  compress(encoder: { buffer: Buffer }): Promise<Buffer> {
    return Promise.resolve(asBuffer(lz4js.compress(encoder.buffer)));
  },
  decompress(buffer: Buffer): Promise<Buffer> {
    return Promise.resolve(asBuffer(lz4js.decompress(buffer)));
  },
};

/** KafkaJS ships GZIP only. Register LZ4 and Snappy used on real clusters. */
export function registerCompressionCodecs(): void {
  if (registered) {
    return;
  }
  CompressionCodecs[CompressionTypes.LZ4] = () => lz4Codec;
  CompressionCodecs[CompressionTypes.Snappy] = SnappyCodec;
  registered = true;
}
