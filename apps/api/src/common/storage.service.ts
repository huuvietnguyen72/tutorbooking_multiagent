import { randomBytes } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import type { Env } from '../config/env';
import { AppError } from './app-error';
import { APP_ENV } from './config';

export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG = Buffer.from([0xff, 0xd8, 0xff]);
const AVATAR_NAME = /^[a-f0-9]{32}\.(jpg|png)$/;

/** Type comes from the magic bytes, never from the client's filename or Content-Type (D2). */
export function sniffImage(data: Buffer): 'jpg' | 'png' | null {
  if (data.subarray(0, PNG.length).equals(PNG)) return 'png';
  if (data.subarray(0, JPEG.length).equals(JPEG)) return 'jpg';
  return null;
}

/** Local-disk storage for avatars; files get random names and are only served by the API itself (D2). */
@Injectable()
export class StorageService {
  private readonly root: string;

  constructor(@Inject(APP_ENV) env: Env) {
    this.root = resolve(env.UPLOAD_DIR, 'avatars');
  }

  /** Returns the stored file name. Throws 413/415 AppErrors for bad uploads. */
  async saveAvatar(data: Buffer): Promise<string> {
    if (data.length > MAX_AVATAR_BYTES) throw new AppError(413, 'FILE_TOO_LARGE', 'File too large');
    const ext = sniffImage(data);
    if (!ext) throw new AppError(415, 'UNSUPPORTED_FILE_TYPE', 'Only JPG and PNG are accepted');
    const name = `${randomBytes(16).toString('hex')}.${ext}`;
    await mkdir(this.root, { recursive: true });
    await writeFile(resolve(this.root, name), data, { flag: 'wx', mode: 0o640 });
    return name;
  }

  async deleteAvatar(name: string): Promise<void> {
    if (!AVATAR_NAME.test(name)) return;
    await unlink(resolve(this.root, name)).catch(() => undefined);
  }

  /** Absolute path for a valid avatar name, or null (blocks path traversal by whitelist). */
  avatarPath(name: string): string | null {
    return AVATAR_NAME.test(name) ? resolve(this.root, name) : null;
  }

  static urlFor(name: string): string {
    return `/api/v1/files/avatars/${name}`;
  }

  static nameFromUrl(url: string | null): string | null {
    const match = url?.match(/\/files\/avatars\/([^/]+)$/);
    return match ? match[1] : null;
  }
}
