import { ForbiddenException } from '@nestjs/common';
import type { AuthUser } from '../types';

/** Throws unless the user may work in `storeId` (super admins may work anywhere). */
export function assertStoreAccess(user: AuthUser, storeId: string) {
  if (!user.isSuperAdmin && !user.storeIds.includes(storeId)) {
    throw new ForbiddenException({ code: 'STORE_FORBIDDEN', message: 'You do not have access to this store' });
  }
}

/** Store ids the user may see; `undefined` means unrestricted (super admin). */
export const visibleStoreIds = (user: AuthUser) => (user.isSuperAdmin ? undefined : user.storeIds);
