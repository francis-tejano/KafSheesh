import { parsePrivateKey } from 'sshpk';

function isPemOrOpenSsh(text: string): boolean {
  return (
    text.includes('BEGIN OPENSSH PRIVATE KEY') ||
    text.includes('BEGIN RSA PRIVATE KEY') ||
    text.includes('BEGIN PRIVATE KEY') ||
    text.includes('BEGIN EC PRIVATE KEY') ||
    text.includes('BEGIN DSA PRIVATE KEY') ||
    text.includes('BEGIN ENCRYPTED PRIVATE KEY')
  );
}

export function isPuttyKey(text: string): boolean {
  return text.trimStart().startsWith('PuTTY-User-Key-File-');
}

export function resolvePrivateKey(raw?: string, passphrase?: string): string | undefined {
  if (!raw) {
    return raw;
  }
  const text = raw.replace(/^\uFEFF/, '').trim();
  if (isPuttyKey(text)) {
    try {
      const key = parsePrivateKey(text, 'auto', { passphrase });
      return key.toString(key.type === 'ed25519' ? 'openssh' : 'pkcs1');
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Could not read the PPK file. Check the passphrase and that it is a PuTTY private key. ${detail}`,
      );
    }
  }
  if (isPemOrOpenSsh(text)) {
    return text;
  }
  throw new Error('Upload a PEM, OpenSSH, or PuTTY PPK private key file.');
}
