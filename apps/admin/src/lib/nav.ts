import { LayoutDashboard, Users, ShieldCheck, Store, ScrollText, Glasses, Tags, Boxes, UserRound, type LucideIcon } from 'lucide-react';

export interface NavItem { key: string; href: string; icon: LucideIcon; permission?: string }

/** Add one entry per module as phases land; the sidebar hides items the user lacks permission for. */
export const NAV: NavItem[] = [
  { key: 'dashboard', href: '/', icon: LayoutDashboard },
  { key: 'customers', href: '/customers', icon: UserRound, permission: 'customers:read' },
  { key: 'products', href: '/products', icon: Glasses, permission: 'products:read' },
  { key: 'inventory', href: '/inventory', icon: Boxes, permission: 'inventory:read' },
  { key: 'catalog', href: '/catalog', icon: Tags, permission: 'catalog:read' },
  { key: 'users', href: '/users', icon: Users, permission: 'users:read' },
  { key: 'roles', href: '/roles', icon: ShieldCheck, permission: 'roles:read' },
  { key: 'stores', href: '/stores', icon: Store, permission: 'stores:read' },
  { key: 'audit', href: '/audit', icon: ScrollText, permission: 'audit:read' },
];
