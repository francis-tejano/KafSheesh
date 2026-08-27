import type { AppFlags } from '@kafsheesh/shared';

export function envEnabled(name: string): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'yes' || value === 'on';
}

export function isDestructiveDisabled(): boolean {
  return envEnabled('KAFSHEESH_DISABLE_DESTRUCTIVE');
}

export function appFlags(): AppFlags {
  return { disableDestructive: isDestructiveDisabled() };
}
