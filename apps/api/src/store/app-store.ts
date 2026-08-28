export abstract class AppStore {
  abstract readonly kind: 'json' | 'postgres';
  abstract read<T>(name: string, fallback: T): Promise<T>;
  abstract write<T>(name: string, value: T): Promise<void>;
}

export function databaseUrl(): string | undefined {
  const url = process.env.DATABASE_URL?.trim();
  return url || undefined;
}
