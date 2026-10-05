export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  locale: string;
  type: 'STAFF' | 'CUSTOMER';
  /** The CRM customer linked to a storefront account. */
  customerId: string | null;
  isSuperAdmin: boolean;
  roles: string[]; // role codes
  permissions: string[]; // effective `module:action` keys (empty for super admin; bypassed)
  storeIds: string[];
  stores: { id: string; code: string; name: string }[];
  defaultStoreId: string | null;
}

declare module 'express' {
  interface Request {
    user?: AuthUser;
    storeId?: string | null;
    traceId?: string;
  }
}
