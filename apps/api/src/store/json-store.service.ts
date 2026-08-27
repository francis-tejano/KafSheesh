import { Injectable, OnModuleInit } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join } from 'path';

@Injectable()
export class JsonStoreService implements OnModuleInit {
  private readonly root =
    process.env.KAFSHEESH_DATA_DIR ?? join(process.cwd(), 'data');

  async onModuleInit() {
    await mkdir(this.root, { recursive: true });
  }

  async read<T>(name: string, fallback: T): Promise<T> {
    const path = join(this.root, name);
    try {
      const raw = await readFile(path, 'utf8');
      return JSON.parse(raw) as T;
    } catch {
      await this.write(name, fallback);
      return fallback;
    }
  }

  async write<T>(name: string, value: T): Promise<void> {
    const path = join(this.root, name);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(value, null, 2), 'utf8');
  }
}
