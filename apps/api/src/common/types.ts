export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: string;
  isSuperAdmin: boolean;
  roles: string[]; // role codes
  permissions: string[]; // effective `module:action` keys (empty for super admin; bypassed)
  storeIds: string[];
  defaultStoreId: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
    storeId?: string | null;
    traceId?: string;
  }
}
