import { execFile } from 'child_process';
import { Resolver } from 'dns';
import { lookup } from 'dns/promises';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const memory = new Map<string, { address: string; at: number }>();
const CACHE_MS = 5 * 60_000;
const FALLBACK_NAMESERVERS = ['172.24.0.156', '172.24.0.39', '100.100.100.100'];

export interface ResolvedHost {
  address: string;
  source: 'ip' | 'lookup' | 'nameserver' | 'system' | 'hosts' | 'cache';
}

export async function resolveConnectAddress(host: string): Promise<ResolvedHost> {
  const name = host.trim();
  if (!name) {
    throw new Error('Bastion host is empty');
  }
  if (isIpAddress(name)) {
    return { address: name, source: 'ip' };
  }
  if (!isHostname(name)) {
    throw new Error(`Invalid host name: ${name}`);
  }

  const fresh = memory.get(name);
  if (fresh && Date.now() - fresh.at < CACHE_MS) {
    return { address: fresh.address, source: 'cache' };
  }

  const resolved =
    (await tryLookup(name)) ??
    (await trySystemResolver(name)) ??
    (await readPersistedHost(name)) ??
    (await trySystemNameservers(name)) ??
    (await tryDig(name)) ??
    (await tryHostsFile(name));

  if (!resolved) {
    throw new Error(
      `Cannot resolve ${name}. Node DNS and VPN/system resolvers failed. Stay on the corporate VPN and retry.`,
    );
  }
  memory.set(name, { address: resolved.address, at: Date.now() });
  await persistHost(name, resolved.address);
  return resolved;
}

export function explainLookupError(host: string, error: unknown): Error {
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  const detail = error instanceof Error ? error.message : String(error);
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || detail.includes('ENOTFOUND')) {
    return new Error(`Cannot reach ${host} (${code || 'ENOTFOUND'}).`);
  }
  return error instanceof Error ? error : new Error(detail);
}

async function tryLookup(name: string): Promise<ResolvedHost | undefined> {
  try {
    const result = await lookup(name, { family: 4, all: false });
    return { address: result.address, source: 'lookup' };
  } catch {
    try {
      const result = await lookup(name, { all: false });
      return { address: result.address, source: 'lookup' };
    } catch {
      return undefined;
    }
  }
}

async function trySystemNameservers(name: string): Promise<ResolvedHost | undefined> {
  const servers = await listNameservers();
  for (const server of servers) {
    const address = await resolve4Against(name, [server]);
    if (address) {
      return { address, source: 'nameserver' };
    }
  }
  return undefined;
}

function resolve4Against(name: string, servers: string[]): Promise<string | undefined> {
  return new Promise((resolve) => {
    const resolver = new Resolver();
    try {
      resolver.setServers(servers);
    } catch {
      resolve(undefined);
      return;
    }
    const timer = setTimeout(() => resolve(undefined), 2000);
    resolver.resolve4(name, (error, addresses) => {
      clearTimeout(timer);
      resolve(!error && addresses?.[0] ? addresses[0] : undefined);
    });
  });
}

async function listNameservers(): Promise<string[]> {
  const found = new Set<string>(FALLBACK_NAMESERVERS);
  const persisted = await readPersistedNameservers();
  for (const server of persisted) {
    found.add(server);
  }
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/sbin/scutil', ['--dns'], { timeout: 3000 });
      for (const match of stdout.matchAll(/nameserver\[\d+\]\s*:\s*([0-9a-fA-F:.]+)/g)) {
        if (!match[1].includes(':')) {
          found.add(match[1]);
        }
      }
      await persistNameservers([...found]);
    } catch {
      /* ignore */
    }
  }
  try {
    const resolv = await readFile('/etc/resolv.conf', 'utf8');
    for (const line of resolv.split('\n')) {
      const match = line.match(/^\s*nameserver\s+(\S+)/);
      if (match && !match[1].includes(':')) {
        found.add(match[1]);
      }
    }
  } catch {
    /* ignore */
  }
  return [...found];
}

async function trySystemResolver(name: string): Promise<ResolvedHost | undefined> {
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/dscacheutil',
        ['-q', 'host', '-a', 'name', name],
        { timeout: 4000 },
      );
      const match = stdout.match(/ip_address:\s*(\S+)/);
      if (match) {
        return { address: match[1], source: 'system' };
      }
    } catch {
      /* ignore */
    }
  }
  try {
    const { stdout } = await execFileAsync('/usr/bin/getent', ['ahostsv4', name], { timeout: 4000 });
    const match = stdout.match(/^(\d{1,3}(?:\.\d{1,3}){3})\s/);
    if (match) {
      return { address: match[1], source: 'system' };
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

async function tryDig(name: string): Promise<ResolvedHost | undefined> {
  const servers = await listNameservers();
  for (const server of servers) {
    try {
      const { stdout } = await execFileAsync(
        '/usr/bin/dig',
        [`@${server}`, '+short', '+time=2', '+tries=1', 'A', name],
        { timeout: 3500 },
      );
      const address = stdout
        .split('\n')
        .map((line) => line.trim())
        .find((line) => /^(?:\d{1,3}\.){3}\d{1,3}$/.test(line));
      if (address) {
        return { address, source: 'nameserver' };
      }
    } catch {
      /* ignore */
    }
  }
  return undefined;
}

async function tryHostsFile(name: string): Promise<ResolvedHost | undefined> {
  try {
    const text = await readFile('/etc/hosts', 'utf8');
    for (const line of text.split('\n')) {
      const trimmed = line.replace(/#.*$/, '').trim();
      if (!trimmed) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 2 && parts.slice(1).includes(name) && isIpAddress(parts[0])) {
        return { address: parts[0], source: 'hosts' };
      }
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

function cachePath(): string {
  const root = process.env.KAFSHEESH_DATA_DIR ?? join(process.cwd(), 'data');
  return join(root, 'dns-cache.json');
}

interface DiskCache {
  nameservers: string[];
  hosts: Record<string, { address: string; at: string }>;
}

async function readDisk(): Promise<DiskCache> {
  try {
    return JSON.parse(await readFile(cachePath(), 'utf8')) as DiskCache;
  } catch {
    return { nameservers: [], hosts: {} };
  }
}

async function writeDisk(cache: DiskCache): Promise<void> {
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(cache, null, 2), 'utf8');
}

async function readPersistedHost(name: string): Promise<ResolvedHost | undefined> {
  const cache = await readDisk();
  const hit = cache.hosts[name];
  if (hit?.address && isIpAddress(hit.address)) {
    return { address: hit.address, source: 'cache' };
  }
  return undefined;
}

async function persistHost(name: string, address: string): Promise<void> {
  const cache = await readDisk();
  cache.hosts[name] = { address, at: new Date().toISOString() };
  await writeDisk(cache);
}

async function readPersistedNameservers(): Promise<string[]> {
  const cache = await readDisk();
  return cache.nameservers ?? [];
}

async function persistNameservers(nameservers: string[]): Promise<void> {
  const cache = await readDisk();
  cache.nameservers = nameservers;
  await writeDisk(cache);
}

function isHostname(value: string): boolean {
  return /^(?=.{1,253}$)[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(
    value,
  );
}

function isIpAddress(value: string): boolean {
  return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(value);
}
