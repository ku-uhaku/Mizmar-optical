/**
 * Single source of truth for RBAC. A permission key is `<module>:<action>`.
 * The API seeds the `Permission` table from this catalog and guards routes with
 * `@Permissions('users:create')`; the admin UI filters navigation with the same keys.
 */
export const PERMISSION_CATALOG = {
  users: ['read', 'create', 'update', 'delete'],
  roles: ['read', 'create', 'update', 'delete'],
  stores: ['read', 'create', 'update', 'delete'],
  settings: ['read', 'update'],
  audit: ['read'],
  customers: ['read', 'create', 'update', 'delete', 'export'],
  prescriptions: ['read', 'create', 'update', 'delete'],
  products: ['read', 'create', 'update', 'delete', 'import'],
  catalog: ['read', 'create', 'update', 'delete'], // brands, categories, lens types, treatments
  inventory: ['read', 'adjust', 'transfer', 'count'],
  pos: ['access', 'discount', 'refund', 'manage_register'],
  orders: ['read', 'create', 'update', 'cancel'],
  quotes: ['read', 'create', 'update', 'delete'],
  invoices: ['read', 'create', 'void'],
  returns: ['read', 'create', 'approve'],
  payments: ['read', 'create', 'refund'],
  coupons: ['read', 'create', 'update', 'delete'],
  suppliers: ['read', 'create', 'update', 'delete'],
  purchasing: ['read', 'create', 'update', 'receive', 'approve'],
  workshop: ['read', 'create', 'update', 'assign', 'quality_check'],
  appointments: ['read', 'create', 'update', 'delete'],
  hr: ['read', 'create', 'update', 'delete', 'payroll'],
  finance: ['read', 'create', 'update', 'approve'],
  reports: ['read', 'export'],
  media: ['upload'],
  cms: ['read', 'create', 'update', 'delete', 'publish'],
} as const;

export type PermissionModule = keyof typeof PERMISSION_CATALOG;

export type PermissionKey = {
  [M in PermissionModule]: `${M}:${(typeof PERMISSION_CATALOG)[M][number]}`;
}[PermissionModule];

export const ALL_PERMISSIONS: PermissionKey[] = (
  Object.entries(PERMISSION_CATALOG) as [PermissionModule, readonly string[]][]
).flatMap(([module, actions]) => actions.map((a) => `${module}:${a}` as PermissionKey));

export const parsePermission = (key: string): { module: string; action: string } => {
  const [module, action] = key.split(':');
  return { module, action };
};

/** Seeded system roles. Super Admin bypasses checks (User.isSuperAdmin), so it needs no list. */
export const SYSTEM_ROLES: Record<string, { name: string; description: string; permissions: PermissionKey[] | '*' }> = {
  super_admin: { name: 'Super Admin', description: 'Full access to everything', permissions: '*' },
  store_manager: {
    name: 'Store Manager',
    description: 'Runs a store: sales, stock, staff scheduling, reports',
    permissions: ALL_PERMISSIONS.filter(
      (p) => !['roles:', 'settings:update', 'stores:delete', 'hr:payroll'].some((x) => p.startsWith(x) || p === x),
    ),
  },
  optician: {
    name: 'Optician',
    description: 'Eye exams, prescriptions, POS and customer care',
    permissions: [
      'customers:read', 'customers:create', 'customers:update',
      'prescriptions:read', 'prescriptions:create', 'prescriptions:update',
      'products:read', 'catalog:read', 'inventory:read', 'media:upload',
      'pos:access', 'orders:read', 'orders:create', 'quotes:read', 'quotes:create', 'quotes:update',
      'invoices:read', 'payments:read', 'payments:create',
      'workshop:read', 'workshop:create', 'appointments:read', 'appointments:create', 'appointments:update',
    ],
  },
  technician: {
    name: 'Technician',
    description: 'Lab / workshop job orders',
    permissions: ['workshop:read', 'workshop:update', 'workshop:quality_check', 'products:read', 'inventory:read', 'customers:read', 'prescriptions:read'],
  },
  cashier: {
    name: 'Cashier',
    description: 'POS sales and register',
    permissions: [
      'pos:access', 'pos:manage_register', 'products:read', 'customers:read', 'customers:create',
      'orders:read', 'orders:create', 'invoices:read', 'payments:read', 'payments:create', 'prescriptions:read', 'workshop:create',
    ],
  },
  hr: {
    name: 'HR',
    description: 'Employees, attendance, leave, payroll',
    permissions: ['hr:read', 'hr:create', 'hr:update', 'hr:delete', 'hr:payroll', 'users:read'],
  },
  accountant: {
    name: 'Accountant',
    description: 'Finance, purchasing invoices and reports',
    permissions: [
      'finance:read', 'finance:create', 'finance:update', 'finance:approve',
      'invoices:read', 'payments:read', 'purchasing:read', 'suppliers:read', 'reports:read', 'reports:export', 'orders:read',
    ],
  },
};
