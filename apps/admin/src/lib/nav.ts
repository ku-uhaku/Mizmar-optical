import { LayoutDashboard, Users, ShieldCheck, Store, ScrollText, Glasses, Tags, Boxes, UserRound, ShoppingCart, ReceiptText, FileText, Landmark, ClipboardList, Truck, PackageSearch, Wrench, Receipt, type LucideIcon } from 'lucide-react';

export interface NavItem { key: string; href: string; icon: LucideIcon; permission?: string }

/** Add one entry per module as phases land; the sidebar hides items the user lacks permission for. */
export const NAV: NavItem[] = [
  { key: 'dashboard', href: '/', icon: LayoutDashboard },
  { key: 'pos', href: '/pos', icon: ShoppingCart, permission: 'pos:access' },
  { key: 'orders', href: '/orders', icon: ClipboardList, permission: 'orders:read' },
  { key: 'quotes', href: '/quotes', icon: FileText, permission: 'quotes:read' },
  { key: 'invoices', href: '/invoices', icon: ReceiptText, permission: 'invoices:read' },
  { key: 'registers', href: '/pos/sessions', icon: Landmark, permission: 'pos:manage_register' },
  { key: 'customers', href: '/customers', icon: UserRound, permission: 'customers:read' },
  { key: 'products', href: '/products', icon: Glasses, permission: 'products:read' },
  { key: 'inventory', href: '/inventory', icon: Boxes, permission: 'inventory:read' },
  { key: 'catalog', href: '/catalog', icon: Tags, permission: 'catalog:read' },
  { key: 'suppliers', href: '/suppliers', icon: Truck, permission: 'suppliers:read' },
  { key: 'purchasing', href: '/purchasing', icon: PackageSearch, permission: 'purchasing:read' },
  { key: 'payables', href: '/payables', icon: Receipt, permission: 'finance:read' },
  { key: 'workshop', href: '/workshop', icon: Wrench, permission: 'workshop:read' },
  { key: 'users', href: '/users', icon: Users, permission: 'users:read' },
  { key: 'roles', href: '/roles', icon: ShieldCheck, permission: 'roles:read' },
  { key: 'stores', href: '/stores', icon: Store, permission: 'stores:read' },
  { key: 'audit', href: '/audit', icon: ScrollText, permission: 'audit:read' },
];
