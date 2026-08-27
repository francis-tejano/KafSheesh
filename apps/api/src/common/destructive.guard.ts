import { CanActivate, ForbiddenException, Injectable } from '@nestjs/common';
import { isDestructiveDisabled } from './flags';

export const DESTRUCTIVE_DISABLED_MESSAGE =
  'Destructive actions are disabled (KAFSHEESH_DISABLE_DESTRUCTIVE).';

@Injectable()
export class DestructiveGuard implements CanActivate {
  canActivate(): boolean {
    if (isDestructiveDisabled()) {
      throw new ForbiddenException(DESTRUCTIVE_DISABLED_MESSAGE);
    }
    return true;
  }
}
