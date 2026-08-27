import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import type { ConnectionDiagnostic, CreateClusterInput } from '@kafsheesh/shared';
import { ApiService } from '../../core/api.service';
import { ConfirmService } from '../../core/confirm.service';
import { BrandComponent } from '../../layout/brand.component';

@Component({
  selector: 'app-cluster-wizard',
  imports: [FormsModule, RouterLink, BrandComponent],
  template: `
    <div class="content">
    <app-brand />
    <div class="page-head" style="margin-top:22px">
      <div>
        <h1>{{ editId() ? 'Edit cluster' : 'Add cluster' }}</h1>
        <p>Direct brokers, or SSH to a jump host that can see Kafka.</p>
      </div>
      <a class="btn ghost" routerLink="/clusters">Back</a>
    </div>

    <div class="stepper">
      @for (item of steps; track item; let i = $index) {
        <button type="button" class="step" [class.active]="step() === i" [class.done]="step() > i" (click)="go(i)">
          {{ i + 1 }}. {{ item }}
        </button>
      }
    </div>

    @if (error()) {
      <div class="banner">{{ error() }}</div>
    }

    <form class="card" (ngSubmit)="save()">
      @if (step() === 0) {
        <label>
          <span>Name</span>
          <input name="name" [(ngModel)]="model.name" required placeholder="prod-payments" />
        </label>
        <label>
          <span>How will Kafsheesh reach Kafka?</span>
          <select name="mode" [(ngModel)]="mode">
            <option value="direct">Direct — brokers are reachable from this machine</option>
            <option value="tunnel">Tunnel — hop through a bastion (server2 → Kafka on server1)</option>
          </select>
        </label>
        <label>
          <span>Notes</span>
          <textarea name="notes" [(ngModel)]="model.notes" placeholder="Optional context for the team"></textarea>
        </label>
      }

      @if (step() === 1 && mode === 'direct') {
        <p>Direct mode does not use a bastion. Continue to Kafka brokers.</p>
        <button type="button" class="btn primary" (click)="step.set(2)">Continue to Kafka</button>
      }

      @if (step() === 1 && mode === 'tunnel') {
        <p class="help">SSH to the host that already has network access to Kafka. Kafsheesh opens local forwards and remaps advertised listeners automatically.</p>
        <div class="grid two">
          <label>
            <span>Bastion host</span>
            <input name="thost" [(ngModel)]="model.tunnel!.host" required placeholder="server2.example.com" />
          </label>
          <label>
            <span>SSH port</span>
            <input name="tport" type="number" [(ngModel)]="model.tunnel!.port" />
          </label>
        </div>
        <label>
          <span>Connect address (optional)</span>
          <input name="tconnect" [(ngModel)]="model.tunnel!.connectHost" placeholder="10.113.131.77 or another resolvable name" />
          <div class="help">
            Dial this IP or hostname instead when the API cannot resolve the bastion name (VPN / split DNS).
            Leave empty to use the bastion host.
          </div>
        </label>
        <div class="grid two">
          <label>
            <span>Username</span>
            <input name="tuser" [(ngModel)]="model.tunnel!.username" required />
          </label>
          <label>
            <span>Auth</span>
            <select name="tauth" [(ngModel)]="model.tunnel!.authType">
              <option value="password">Password</option>
              <option value="privateKey">Private key (PEM / PPK)</option>
            </select>
          </label>
        </div>
        @if (model.tunnel?.authType === 'password') {
          <label>
            <span>Password</span>
            <input name="tpass" type="password" [(ngModel)]="model.tunnel!.password" />
          </label>
        } @else {
          <label>
            <span>Key file</span>
            <input
              type="file"
              name="tkeyfile"
              accept=".pem,.ppk,.key,application/x-pem-file,application/x-x509-ca-cert"
              (change)="onBastionKeyFile($event)"
            />
            <div class="help">
              Accepts OpenSSH/PEM (<code>.pem</code>, <code>id_rsa</code>) and PuTTY (<code>.ppk</code>).
              @if (model.tunnel; as tunnel) {
                @if (tunnel.privateKeyFileName) {
                  Loaded <strong>{{ tunnel.privateKeyFileName }}</strong>
                  @if (tunnel.privateKey === '••••') { (already stored) }
                }
              }
            </div>
          </label>
          <label>
            <span>Or paste the key</span>
            <textarea
              name="tkey"
              [(ngModel)]="model.tunnel!.privateKey"
              placeholder="-----BEGIN OPENSSH PRIVATE KEY----- or PuTTY-User-Key-File-2: ..."
            ></textarea>
          </label>
          <label>
            <span>Key passphrase</span>
            <input name="tph" type="password" [(ngModel)]="model.tunnel!.passphrase" />
            <div class="help">Required when the PEM or PPK file is encrypted.</div>
          </label>
        }
        @if (!showHop()) {
          <button type="button" class="btn ghost" (click)="showHop.set(true)">Add another hop (ProxyJump)</button>
        } @else {
          <label>
            <span>Optional extra hop (ProxyJump)</span>
            <input name="jumphost" [(ngModel)]="jumpHost" placeholder="jump.example.com:22" />
            <div class="help">Leave empty for a single hop. Format host:port.</div>
          </label>
          <div class="grid two">
            <label>
              <span>Jump username</span>
              <input name="jumpuser" [(ngModel)]="jumpUser" />
            </label>
            <label>
              <span>Jump auth</span>
              <select name="jumpauth" [(ngModel)]="jumpAuthType">
                <option value="password">Password</option>
                <option value="privateKey">Private key (PEM / PPK)</option>
              </select>
            </label>
          </div>
          @if (jumpAuthType === 'password') {
            <label>
              <span>Jump password</span>
              <input name="jumppass" type="password" [(ngModel)]="jumpPassword" />
            </label>
          } @else {
            <label>
              <span>Jump key file</span>
              <input type="file" name="jumpkeyfile" accept=".pem,.ppk,.key" (change)="onJumpKeyFile($event)" />
              <div class="help">
                @if (jumpKeyFileName) {
                  Loaded <strong>{{ jumpKeyFileName }}</strong>
                }
              </div>
            </label>
            <label>
              <span>Jump key passphrase</span>
              <input name="jumpph" type="password" [(ngModel)]="jumpPassphrase" />
            </label>
          }
        }
      }

      @if (step() === 2) {
        <label>
          <span>{{ mode === 'tunnel' ? 'Brokers as seen from the bastion' : 'Bootstrap brokers' }}</span>
          <input name="brokers" [(ngModel)]="brokersText" required placeholder="broker-1.internal:9092, broker-2.internal:9092" />
          <div class="help">Comma-separated host:port. For tunnels, use the addresses the bastion can resolve.</div>
        </label>
        <label class="check">
          <input type="checkbox" name="ssl" [(ngModel)]="model.ssl" />
          <span>TLS</span>
        </label>
        <label>
          <span>SASL</span>
          <select name="sasl" [(ngModel)]="saslMode">
            <option value="">None</option>
            <option value="plain">PLAIN</option>
            <option value="scram-sha-256">SCRAM-SHA-256</option>
            <option value="scram-sha-512">SCRAM-SHA-512</option>
          </select>
        </label>
        @if (saslMode) {
          <div class="grid two">
            <label>
              <span>SASL username</span>
              <input name="suser" [(ngModel)]="saslUser" />
            </label>
            <label>
              <span>SASL password</span>
              <input name="spass" type="password" [(ngModel)]="saslPassword" />
            </label>
          </div>
        }
        <label>
          <span>Schema Registry URL</span>
          <input name="sr" [(ngModel)]="schemaUrl" placeholder="http://schema-registry:8081" />
        </label>
      }

      @if (step() === 3) {
        <p>Save the cluster, then run diagnostics. Diagnostics test SSH, port forwards, Kafka metadata, and advertised-listener remapping without leaving a session open.</p>
        <ul class="mono" style="color:var(--muted)">
          <li>{{ model.name }}</li>
          <li>{{ mode === 'tunnel' ? 'Tunnel via ' + model.tunnel?.host : 'Direct' }}</li>
          <li>{{ brokersText }}</li>
        </ul>
      }

      <div class="row">
        @if (step() > 0) {
          <button type="button" class="btn ghost" (click)="step.set(step() - 1)">Back</button>
        }
        @if (step() < 3) {
          <button type="button" class="btn primary" (click)="next()">Continue</button>
        } @else {
          <button class="btn primary" [disabled]="saving()">{{ saving() ? 'Saving…' : editId() ? 'Save changes' : 'Create cluster' }}</button>
        }
      </div>
    </form>

    @if (createdId()) {
      <div class="card" style="margin-top:16px">
        <div class="row" style="justify-content:space-between">
          <h3 style="margin:0">Connection diagnostics</h3>
          <button class="btn" (click)="runDiagnose()" [disabled]="diagnosing()">{{ diagnosing() ? 'Running…' : 'Run tests' }}</button>
        </div>
        @if (diag(); as result) {
          @if (result.ok) {
            <div class="ok-banner">All checks passed. Advertised listeners will be remapped through the tunnel.</div>
          }
          @for (item of result.steps; track item.id) {
            <div class="row" style="margin:10px 0">
              <span class="pill" [class.ok]="item.status === 'ok'" [class.err]="item.status === 'error'">{{ item.status }}</span>
              <strong>{{ item.label }}</strong>
              <span class="help">{{ item.detail }} @if (item.durationMs) { ({{ item.durationMs }}ms) }</span>
            </div>
          }
          @if (result.advertisedListeners.length) {
            <p class="help">Advertised: {{ result.advertisedListeners.join(', ') }}</p>
          }
          @if (result.remappedBrokers.length) {
            <p class="help">Remapped: {{ result.remappedBrokers.join(' · ') }}</p>
          }
        }
        <div class="row" style="margin-top:16px">
          <a class="btn primary" [routerLink]="['/c', createdId(), 'overview']">Open cluster</a>
        </div>
      </div>
    }
    </div>
  `,
})
export class ClusterWizardPage {
  private readonly api = inject(ApiService);
  private readonly confirm = inject(ConfirmService);
  private readonly route = inject(ActivatedRoute);

  readonly steps = ['Identity', 'Path', 'Kafka', 'Review'];
  readonly step = signal(0);
  readonly error = signal('');
  readonly saving = signal(false);
  readonly diagnosing = signal(false);
  readonly createdId = signal('');
  readonly editId = signal('');
  readonly diag = signal<ConnectionDiagnostic | null>(null);
  readonly showHop = signal(false);

  mode: 'direct' | 'tunnel' = 'tunnel';
  brokersText = '';
  saslMode = '';
  saslUser = '';
  saslPassword = '';
  schemaUrl = '';
  jumpHost = '';
  jumpUser = '';
  jumpPassword = '';
  jumpAuthType: 'password' | 'privateKey' = 'password';
  jumpPrivateKey = '';
  jumpKeyFileName = '';
  jumpPassphrase = '';

  model: CreateClusterInput = {
    name: '',
    brokers: [],
    notes: '',
    ssl: false,
    tunnel: {
      enabled: true,
      host: 'localhost',
      port: 22,
      username: 'kafsheesh',
      authType: 'password',
      password: 'kafsheesh',
    },
  };

  constructor() {
    const id = this.route.snapshot.paramMap.get('id');
    if (id) {
      this.editId.set(id);
      this.createdId.set(id);
      this.api.getCluster(id).subscribe((cluster) => {
        this.model.name = cluster.name;
        this.model.notes = cluster.notes;
        this.model.ssl = cluster.ssl;
        this.brokersText = cluster.brokers.join(', ');
        this.mode = cluster.tunnel?.enabled ? 'tunnel' : 'direct';
        if (cluster.tunnel) {
          this.model.tunnel = { ...cluster.tunnel };
          const hop = cluster.tunnel.hops?.[0];
          if (hop) {
            this.showHop.set(true);
            this.jumpHost = `${hop.host}:${hop.port}`;
            this.jumpUser = hop.username;
            this.jumpAuthType = hop.authType;
            this.jumpPrivateKey = hop.privateKey ?? '';
            this.jumpKeyFileName = hop.privateKeyFileName ?? '';
            this.jumpPassphrase = hop.passphrase ?? '';
            this.jumpPassword = hop.password ?? '';
          }
        }
        if (cluster.sasl) {
          this.saslMode = cluster.sasl.mechanism;
          this.saslUser = cluster.sasl.username;
        }
        this.schemaUrl = cluster.schemaRegistry?.url ?? '';
      });
    }
  }

  onBastionKeyFile(event: Event) {
    void this.readKeyFile(event, (name, text) => {
      if (!this.model.tunnel) {
        return;
      }
      this.model.tunnel.authType = 'privateKey';
      this.model.tunnel.privateKey = text;
      this.model.tunnel.privateKeyFileName = name;
    });
  }

  onJumpKeyFile(event: Event) {
    void this.readKeyFile(event, (name, text) => {
      this.jumpAuthType = 'privateKey';
      this.jumpPrivateKey = text;
      this.jumpKeyFileName = name;
    });
  }

  private async readKeyFile(event: Event, apply: (name: string, text: string) => void) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) {
      return;
    }
    const name = file.name.toLowerCase();
    if (!/\.(pem|ppk|key)$/i.test(file.name) && !name.includes('id_')) {
      const looksOk = file.size < 256_000;
      if (!looksOk) {
        this.error.set('Choose a PEM or PPK private key file.');
        return;
      }
    }
    try {
      const text = await file.text();
      this.assertKeyFile(text, file.name);
      apply(file.name, text);
      this.error.set('');
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Could not read the key file');
    }
    input.value = '';
  }

  private assertKeyFile(text: string, fileName: string) {
    const body = text.replace(/^\uFEFF/, '').trim();
    const isPem =
      body.includes('BEGIN OPENSSH PRIVATE KEY') ||
      body.includes('BEGIN RSA PRIVATE KEY') ||
      body.includes('BEGIN PRIVATE KEY') ||
      body.includes('BEGIN EC PRIVATE KEY') ||
      body.includes('BEGIN DSA PRIVATE KEY') ||
      body.includes('BEGIN ENCRYPTED PRIVATE KEY');
    const isPpk = body.startsWith('PuTTY-User-Key-File-');
    if (!isPem && !isPpk) {
      throw new Error(
        `${fileName} is not a PEM or PPK private key. Expected OpenSSH/PEM headers or PuTTY-User-Key-File.`,
      );
    }
  }

  go(index: number) {
    this.sync();
    this.step.set(index);
  }

  next() {
    this.sync();
    if (this.step() === 0 && this.mode === 'direct') {
      this.step.set(2);
      return;
    }
    this.step.update((value) => Math.min(3, value + 1));
  }

  async save() {
    this.sync();
    if (this.editId()) {
      const ok = await this.confirm.ask({
        title: 'Save cluster changes',
        message: `Overwrite the saved connection for ${this.model.name}? Broker, tunnel, and auth settings are replaced. Kafka data is not deleted.`,
        confirmLabel: 'Save changes',
      });
      if (!ok) {
        return;
      }
    }
    this.saving.set(true);
    this.error.set('');
    const req = this.editId()
      ? this.api.updateCluster(this.editId(), this.model)
      : this.api.createCluster(this.model);
    req.subscribe({
      next: (cluster) => {
        this.saving.set(false);
        this.createdId.set(cluster.id);
        this.editId.set(cluster.id);
      },
      error: (err: { error?: { message?: string } }) => {
        this.saving.set(false);
        this.error.set(err.error?.message ?? 'Save failed');
      },
    });
  }

  runDiagnose() {
    const id = this.createdId();
    if (!id) {
      return;
    }
    this.diagnosing.set(true);
    this.api.diagnose(id).subscribe({
      next: (result) => {
        this.diag.set(result);
        this.diagnosing.set(false);
      },
      error: (err: { error?: { message?: string } }) => {
        this.diagnosing.set(false);
        this.error.set(err.error?.message ?? 'Diagnostics failed');
      },
    });
  }

  private sync() {
    this.model.brokers = this.brokersText.split(',').map((item) => item.trim()).filter(Boolean);
    if (this.mode === 'tunnel' && this.model.tunnel) {
      this.model.tunnel.enabled = true;
      this.model.tunnel.remoteBrokers = this.model.brokers;
      if (
        this.model.tunnel.privateKey &&
        this.model.tunnel.privateKey !== '••••' &&
        !this.model.tunnel.privateKeyFileName
      ) {
        this.model.tunnel.privateKeyFileName = this.model.tunnel.privateKey
          .trim()
          .startsWith('PuTTY-User-Key-File-')
          ? 'pasted.ppk'
          : 'pasted.pem';
      }
      if (this.jumpHost) {
        const [host, port] = this.jumpHost.split(':');
        this.model.tunnel.hops = [
          {
            host,
            port: Number(port || 22),
            username: this.jumpUser || this.model.tunnel.username,
            authType: this.jumpAuthType,
            password: this.jumpAuthType === 'password' ? this.jumpPassword : undefined,
            privateKey: this.jumpAuthType === 'privateKey' ? this.jumpPrivateKey : undefined,
            privateKeyFileName: this.jumpAuthType === 'privateKey' ? this.jumpKeyFileName : undefined,
            passphrase: this.jumpAuthType === 'privateKey' ? this.jumpPassphrase : undefined,
          },
        ];
      } else {
        this.model.tunnel.hops = [];
      }
    } else {
      this.model.tunnel = undefined;
    }
    this.model.sasl = this.saslMode
      ? {
          mechanism: this.saslMode as 'plain' | 'scram-sha-256' | 'scram-sha-512',
          username: this.saslUser,
          password: this.saslPassword,
        }
      : undefined;
    this.model.schemaRegistry = this.schemaUrl ? { url: this.schemaUrl } : undefined;
  }
}
