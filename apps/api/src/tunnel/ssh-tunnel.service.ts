import { Injectable, Logger } from '@nestjs/common';
import { createServer, type Server, type Socket } from 'net';
import { Client, type ConnectConfig } from 'ssh2';
import type { JumpHop, TunnelConfig, TunnelRuntime } from '@kafsheesh/shared';
import { ActivityService } from '../activity/activity.service';
import { open } from '../common/crypto';
import { explainLookupError, resolveConnectAddress } from './resolve-host';
import { isPuttyKey, resolvePrivateKey } from './ssh-key';

interface Forward {
  remote: string;
  remoteHost: string;
  remotePort: number;
  localPort: number;
  server: Server;
}

interface TunnelSession {
  config: TunnelConfig;
  clients: Client[];
  leaf: Client;
  forwards: Map<string, Forward>;
  connectedAt: Date;
  lastLatencyMs?: number;
}

function hopKey(host: string, port: number): string {
  return `${host}:${port}`;
}

function authConfig(hop: Pick<JumpHop, 'authType' | 'password' | 'privateKey' | 'passphrase'>): Partial<ConnectConfig> {
  if (hop.authType === 'privateKey') {
    const passphrase = open(hop.passphrase);
    const material = open(hop.privateKey);
    return {
      privateKey: resolvePrivateKey(material, passphrase),
      passphrase: material && isPuttyKey(material) ? undefined : passphrase,
    };
  }
  return { password: open(hop.password) };
}

@Injectable()
export class SshTunnelService {
  private readonly logger = new Logger(SshTunnelService.name);
  private readonly sessions = new Map<string, TunnelSession>();

  constructor(private readonly activity: ActivityService) {}

  getRuntime(clusterId: string): TunnelRuntime | undefined {
    const session = this.sessions.get(clusterId);
    if (!session) {
      return undefined;
    }
    return {
      connected: true,
      bastion: hopKey(session.config.host, session.config.port),
      hops: session.config.hops?.length ?? 0,
      forwards: [...session.forwards.values()].map((forward) => ({
        remote: forward.remote,
        localPort: forward.localPort,
      })),
      latencyMs: session.lastLatencyMs,
      connectedAt: session.connectedAt.toISOString(),
    };
  }

  async openSession(clusterId: string, config: TunnelConfig): Promise<TunnelRuntime> {
    await this.closeSession(clusterId);
    const hops: JumpHop[] = [
      ...(config.hops ?? []),
      {
        host: config.host,
        port: config.port,
        username: config.username,
        authType: config.authType,
        password: config.password,
        privateKey: config.privateKey,
        passphrase: config.passphrase,
        connectHost: config.connectHost,
      },
    ];

    const clients: Client[] = [];
    let previous: Client | undefined;
    let leaf: Client | undefined;

    this.logger.log(
      `Opening SSH session for ${clusterId}: ${hops
        .map((hop, index) => `${index}:${hop.username}@${hop.host}:${hop.port}/${hop.authType}`)
        .join(' → ')}`,
    );
    try {
      for (const hop of hops) {
        const target = hop.connectHost
          ? `${hop.username}@${hop.host}:${hop.port} via ${hop.connectHost}`
          : `${hop.username}@${hop.host}:${hop.port}`;
        this.logger.log(`SSH connecting ${target} (${hop.authType})`);
        this.activity.info('SSH', `Connecting ${target} (${hop.authType})`, clusterId);
        const client = await this.connectHop(hop, previous, clusterId);
        this.logger.log(`SSH ready ${hop.username}@${hop.host}:${hop.port}`);
        this.activity.info('SSH', `Ready ${hop.username}@${hop.host}:${hop.port}`, clusterId);
        clients.push(client);
        previous = client;
        leaf = client;
      }
      if (!leaf) {
        throw new Error('No SSH hop configured');
      }

      const session: TunnelSession = {
        config,
        clients,
        leaf,
        forwards: new Map(),
        connectedAt: new Date(),
      };
      this.sessions.set(clusterId, session);
      this.logger.log(
        `Tunnel ${clusterId} opened via ${hopKey(config.host, config.port)} (port-forward only; no shell probe)`,
      );
      this.activity.info(
        'SSH',
        `Tunnel open via ${hopKey(config.host, config.port)}`,
        clusterId,
      );
      return this.getRuntime(clusterId)!;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Tunnel ${clusterId} failed: ${message}`);
      this.activity.error('SSH', `Tunnel failed: ${message}`, clusterId);
      for (const client of clients) {
        client.end();
      }
      throw error;
    }
  }

  async ensureForward(clusterId: string, remoteHost: string, remotePort: number): Promise<number> {
    const session = this.sessions.get(clusterId);
    if (!session) {
      throw new Error(`No tunnel session for cluster ${clusterId}`);
    }
    const remote = hopKey(remoteHost, remotePort);
    const existing = session.forwards.get(remote);
    if (existing) {
      return existing.localPort;
    }

    const server = createServer((socket) => {
      this.pipeThroughSsh(session.leaf, remoteHost, remotePort, socket);
    });

    const localPort = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string') {
          reject(new Error('Failed to bind local tunnel port'));
          return;
        }
        resolve(address.port);
      });
    });

    session.forwards.set(remote, {
      remote,
      remoteHost,
      remotePort,
      localPort,
      server,
    });
    this.logger.log(`Forward ${remote} -> 127.0.0.1:${localPort} (${clusterId})`);
    this.activity.info('SSH', `Forward ${remote} → 127.0.0.1:${localPort}`, clusterId);
    return localPort;
  }

  async closeSession(clusterId: string): Promise<void> {
    const session = this.sessions.get(clusterId);
    if (!session) {
      return;
    }
    for (const forward of session.forwards.values()) {
      await new Promise<void>((resolve) => forward.server.close(() => resolve()));
    }
    for (const client of session.clients) {
      client.end();
    }
    this.sessions.delete(clusterId);
  }

  async ping(clusterId: string): Promise<number | undefined> {
    const session = this.sessions.get(clusterId);
    if (!session) {
      return undefined;
    }
    session.lastLatencyMs = await this.measureLatency(session.leaf);
    return session.lastLatencyMs;
  }

  private connectHop(hop: JumpHop, through?: Client, clusterId?: string): Promise<Client> {
    return new Promise((resolve, reject) => {
      const client = new Client();
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error(`SSH timeout connecting to ${hop.host}:${hop.port}`));
      }, 15_000);

      const start = (address: string) => {
        client
          .on('ready', () => {
            clearTimeout(timeout);
            resolve(client);
          })
          .on('error', (error) => {
            clearTimeout(timeout);
            this.logger.error(`SSH error ${hop.username}@${hop.host}:${hop.port}: ${error.message}`);
            reject(explainLookupError(hop.connectHost || hop.host, error));
          })
          .connect({
            host: address,
            port: hop.port,
            username: hop.username,
            readyTimeout: 12_000,
            keepaliveInterval: 15_000,
            keepaliveCountMax: 3,
            ...authConfig(hop),
          });
      };

      if (!through) {
        void resolveConnectAddress(hop.connectHost || hop.host)
          .then((resolved) => {
            if (resolved.address !== hop.host) {
              const line = `Resolved ${hop.host} → ${resolved.address} (${resolved.source})`;
              this.logger.log(line);
              this.activity.info('SSH', line, clusterId);
            }
            start(resolved.address);
          })
          .catch((error) => {
            clearTimeout(timeout);
            reject(error);
          });
        return;
      }

      through.forwardOut('127.0.0.1', 0, hop.host, hop.port, (error, stream) => {
        if (error) {
          clearTimeout(timeout);
          reject(error);
          return;
        }
        client
          .on('ready', () => {
            clearTimeout(timeout);
            resolve(client);
          })
          .on('error', (err) => {
            clearTimeout(timeout);
            this.logger.error(`SSH error ${hop.username}@${hop.host}:${hop.port} (via jump): ${err.message}`);
            reject(err);
          })
          .connect({
            sock: stream,
            host: hop.host,
            port: hop.port,
            username: hop.username,
            readyTimeout: 12_000,
            keepaliveInterval: 15_000,
            ...authConfig(hop),
          });
      });
    });
  }

  private pipeThroughSsh(leaf: Client, host: string, port: number, socket: Socket) {
    leaf.forwardOut('127.0.0.1', 0, host, port, (error, stream) => {
      if (error) {
        socket.destroy(error);
        return;
      }
      socket.pipe(stream);
      stream.pipe(socket);
      socket.on('close', () => stream.close());
      stream.on('close', () => socket.destroy());
      stream.on('error', () => socket.destroy());
      socket.on('error', () => stream.close());
    });
  }

  private measureLatency(client: Client): Promise<number> {
    return new Promise((resolve) => {
      const started = Date.now();
      const finish = () => resolve(Date.now() - started);
      const timer = setTimeout(() => {
        this.logger.warn('SSH shell probe timed out; bastion likely allows forwarding only');
        finish();
      }, 1500);
      try {
        client.exec('true', { readyTimeout: 1000 } as never, (error, stream) => {
          clearTimeout(timer);
          if (error || !stream) {
            finish();
            return;
          }
          stream.on('close', finish);
          stream.on('error', finish);
        });
      } catch {
        clearTimeout(timer);
        finish();
      }
    });
  }
}
