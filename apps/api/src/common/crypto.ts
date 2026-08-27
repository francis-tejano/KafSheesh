import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

const PREFIX = 'enc:v1:';

function keyMaterial(): Buffer | null {
  const secret = process.env.KAFSHEESH_MASTER_KEY;
  if (!secret) {
    return null;
  }
  return createHash('sha256').update(secret).digest();
}

export function seal(value: string | undefined): string | undefined {
  if (!value || value.startsWith(PREFIX)) {
    return value;
  }
  const key = keyMaterial();
  if (!key) {
    return value;
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString('base64')}.${tag.toString('base64')}.${encrypted.toString('base64')}`;
}

export function open(value: string | undefined): string | undefined {
  if (!value || !value.startsWith(PREFIX)) {
    return value;
  }
  const key = keyMaterial();
  if (!key) {
    throw new Error(
      'Encrypted secret found but KAFSHEESH_MASTER_KEY is not set',
    );
  }
  const payload = value.slice(PREFIX.length);
  const [ivB64, tagB64, dataB64] = payload.split('.');
  const decipher = createDecipheriv(
    'aes-256-gcm',
    key,
    Buffer.from(ivB64, 'base64'),
  );
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(dataB64, 'base64')),
    decipher.final(),
  ]);
  return decrypted.toString('utf8');
}

export function sealSecrets<T extends Record<string, unknown>>(
  obj: T,
  keys: (keyof T)[],
): T {
  const next = { ...obj };
  for (const key of keys) {
    const value = next[key];
    if (typeof value === 'string') {
      next[key] = seal(value) as T[keyof T];
    }
  }
  return next;
}
