import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthUser } from '../../common/types';
import { renderHtml } from '../documents/template-engine';
import * as D from './admin-config.dto';
import { assertNoActiveContent } from './admin-config.resources';
import { cleanTranslations, plainText } from './sanitize';
import { sampleContext } from './sample-context';

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const FONT = /^[\w\s-]{1,40}$/;
const COLOR_KEYS = ['primary', 'secondary', 'accent', 'background', 'foreground'];

/** Permission that guards each entity's custom fields: you can read/write them only if you can read/update the record itself. */
const ENTITY_PERM: Record<string, string> = { CUSTOMER: 'customers', PRODUCT: 'products', PRODUCT_VARIANT: 'products', ORDER: 'orders', PRESCRIPTION: 'prescriptions', JOB_ORDER: 'workshop', SUPPLIER: 'suppliers', EMPLOYEE: 'hr', APPOINTMENT: 'appointments' };
const DELEGATE: Record<string, string> = { CUSTOMER: 'customer', PRODUCT: 'product', PRODUCT_VARIANT: 'productVariant', ORDER: 'order', PRESCRIPTION: 'prescription', JOB_ORDER: 'jobOrder', SUPPLIER: 'supplier', EMPLOYEE: 'employee', APPOINTMENT: 'appointment' };

@Injectable()
export class AdminConfigService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------ branding
  async branding() {
    const b = await this.prisma.db.brandingSetting.findFirst({ where: { key: 'default' } });
    if (!b) throw new NotFoundException('Branding not configured');
    return b;
  }

  async setBranding(dto: D.BrandingDto) {
    const colors: Record<string, Record<string, string>> = {};
    for (const mode of ['light', 'dark'] as const) {
      for (const [k, v] of Object.entries(dto.colors?.[mode] ?? {})) {
        if (!COLOR_KEYS.includes(k)) throw new BadRequestException({ code: 'INVALID_COLOR', message: `Unknown colour "${k}"` });
        if (!HEX.test(v)) throw new BadRequestException({ code: 'INVALID_COLOR', message: `"${k}" must be a #hex colour` });
        (colors[mode] ??= {})[k] = v;
      }
    }
    for (const f of [dto.fonts?.heading, dto.fonts?.body]) if (f && !FONT.test(f)) throw new BadRequestException({ code: 'INVALID_FONT', message: 'Font names may contain letters, digits, spaces and dashes only' });
    const flat = (o: Record<string, string> | undefined, keys?: string[]) => (o ? Object.fromEntries(Object.entries(o).filter(([k, v]) => typeof v === 'string' && (!keys || keys.includes(k))).map(([k, v]) => [k, plainText(v).slice(0, 200)])) : undefined);
    const data = {
      storeName: plainText(dto.storeName), tagline: dto.tagline === undefined ? undefined : plainText(dto.tagline), logoUrl: dto.logoUrl, logoDarkUrl: dto.logoDarkUrl, faviconUrl: dto.faviconUrl,
      ...(dto.colors && { colors }), ...(dto.fonts && { fonts: { heading: dto.fonts.heading, body: dto.fonts.body } }),
      ...(dto.social && { social: flat(dto.social) }), ...(dto.contact && { contact: flat(dto.contact as Record<string, string>, ['phone', 'email', 'address']) }), ...(dto.legal && { legal: flat(dto.legal, ['legalName', 'ice', 'rc', 'if', 'patente', 'cnss']) }),
    };
    const existing = await this.prisma.raw.brandingSetting.findFirst({ where: { key: 'default' } });
    return existing ? this.prisma.raw.brandingSetting.update({ where: { id: existing.id }, data }) : this.prisma.raw.brandingSetting.create({ data: { key: 'default', colors: {}, fonts: {}, ...data } as never });
  }

  // ------------------------------------------------------------------ menus
  async menus() {
    const menus = await this.prisma.db.menu.findMany({ orderBy: { code: 'asc' } });
    const items = await this.prisma.db.menuItem.findMany({ orderBy: { sortOrder: 'asc' } });
    const tree = (menuId: string, parentId: string | null): unknown[] => items.filter((i) => i.menuId === menuId && i.parentId === parentId).map((i) => ({ id: i.id, label: i.label, url: i.url, openInNewTab: i.openInNewTab, isActive: i.isActive, translations: i.translations, children: tree(menuId, i.id) }));
    return menus.map((m) => ({ code: m.code, name: m.name, items: tree(m.id, null) }));
  }

  async setMenu(code: string, dto: D.SetMenuDto) {
    if (!/^[a-z][a-z_]{1,29}$/.test(code)) throw new BadRequestException('Invalid menu code');
    const menu = await this.prisma.raw.menu.upsert({ where: { code }, update: { ...(dto.name && { name: plainText(dto.name), deletedAt: null }), deletedAt: null }, create: { code, name: plainText(dto.name ?? code) } });
    await this.prisma.raw.$transaction(async (tx) => {
      await tx.menuItem.updateMany({ where: { menuId: menu.id, deletedAt: null }, data: { deletedAt: new Date() } });
      let order = 0;
      const write = async (items: D.MenuItemDto[], parentId: string | null, depth: number) => {
        for (const i of items) {
          if (depth > 2) throw new BadRequestException({ code: 'MENU_TOO_DEEP', message: 'Menus can have two levels' });
          const row = await tx.menuItem.create({ data: { menuId: menu.id, parentId, type: 'URL', label: plainText(i.label), url: i.url, openInNewTab: i.openInNewTab ?? false, isActive: i.isActive ?? true, sortOrder: order++, translations: (cleanTranslations(i.translations) ?? undefined) as never } });
          if (i.children?.length) await write(i.children, row.id, depth + 1);
        }
      };
      await write(dto.items, null, 1);
    });
    return (await this.menus()).find((m) => m.code === code);
  }

  async reorder(model: 'homeSection' | 'banner' | 'testimonial', ids: string[]) {
    const raw = (this.prisma.raw as any)[model];
    const found = await raw.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
    if (found.length !== new Set(ids).size) throw new BadRequestException({ code: 'UNKNOWN_IDS', message: 'Some items do not exist' });
    await this.prisma.raw.$transaction(ids.map((id, i) => raw.update({ where: { id }, data: { sortOrder: i } })));
    return { reordered: ids.length };
  }

  // ------------------------------------------------------------------ documents
  preview(dto: D.PreviewTemplateDto) {
    assertNoActiveContent(dto.html);
    try { return { html: renderHtml(dto.html, sampleContext(dto.type, (dto.locale ?? 'fr') as 'fr')) }; }
    catch (e) { throw new BadRequestException({ code: 'TEMPLATE_ERROR', message: `The template does not render: ${(e as Error).message}` }); }
  }

  sequences(storeId?: string) {
    return this.prisma.db.documentSequence.findMany({ where: { ...(storeId && { storeId }) }, orderBy: [{ storeId: 'asc' }, { docType: 'asc' }, { periodKey: 'asc' }] });
  }

  async setSequence(id: string, dto: D.SequenceDto) {
    const row = await this.prisma.db.documentSequence.findFirst({ where: { id } });
    if (!row) throw new NotFoundException('Sequence not found');
    if (row.periodKey !== 'all') throw new BadRequestException({ code: 'NOT_A_TEMPLATE', message: 'Edit the format row (period "all"); counters advance by themselves' });
    return this.prisma.raw.documentSequence.update({ where: { id }, data: dto as never });
  }

  // ------------------------------------------------------------------ custom field values
  private canUse(user: AuthUser, entity: string, action: 'read' | 'update') {
    const perm = `${ENTITY_PERM[entity]}:${action}`;
    if (!user.isSuperAdmin && !user.permissions.includes(perm)) throw new ForbiddenException({ code: 'MISSING_PERMISSION', message: 'Insufficient permissions', details: { missing: [perm] } });
  }

  private async mustExist(entity: string, id: string) {
    if (!ENTITY_PERM[entity]) throw new BadRequestException({ code: 'UNKNOWN_ENTITY', message: 'Unknown entity' });
    if (!(await (this.prisma.db as any)[DELEGATE[entity]].findFirst({ where: { id }, select: { id: true } }))) throw new NotFoundException('Record not found');
  }

  async customValues(entity: string, id: string, user: AuthUser) {
    entity = entity.toUpperCase();
    this.canUse(user, entity, 'read');
    await this.mustExist(entity, id);
    const [defs, vals] = await Promise.all([
      this.prisma.db.customFieldDefinition.findMany({ where: { entity: entity as never, isActive: true }, orderBy: { sortOrder: 'asc' } }),
      this.prisma.db.customFieldValue.findMany({ where: { entity: entity as never, entityId: id } }),
    ]);
    const byDef = new Map(vals.map((v) => [v.definitionId, v.value]));
    return defs.map((d) => ({ id: d.id, key: d.key, label: d.label, type: d.type, options: d.options, isRequired: d.isRequired, translations: d.translations, value: byDef.get(d.id) ?? null }));
  }

  private coerce(def: { key: string; type: string; options: unknown }, v: unknown): unknown {
    const bad = (m: string) => new BadRequestException({ code: 'INVALID_FIELD', message: `${def.key}: ${m}`, details: { key: def.key } });
    if (v === null || v === '' || v === undefined) return null;
    switch (def.type) {
      case 'TEXT': if (typeof v !== 'string' || v.length > 255) throw bad('text up to 255 characters'); return plainText(v);
      case 'TEXTAREA': if (typeof v !== 'string' || v.length > 5000) throw bad('text up to 5000 characters'); return plainText(v);
      case 'NUMBER': if (!Number.isInteger(Number(v))) throw bad('a whole number'); return Number(v);
      case 'DECIMAL': if (!Number.isFinite(Number(v))) throw bad('a number'); return Number(v);
      case 'BOOLEAN': if (typeof v !== 'boolean') throw bad('true or false'); return v;
      case 'DATE': if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v))) throw bad('a date (YYYY-MM-DD)'); return v;
      case 'SELECT': if (typeof v !== 'string' || !(def.options as string[]).includes(v)) throw bad('one of the listed choices'); return v;
      case 'MULTI_SELECT': if (!Array.isArray(v) || v.some((x) => !(def.options as string[]).includes(x))) throw bad('only listed choices'); return [...new Set(v as string[])];
      default: throw bad('unsupported type');
    }
  }

  async setCustomValues(entity: string, id: string, dto: D.SetCustomValuesDto, user: AuthUser) {
    entity = entity.toUpperCase();
    this.canUse(user, entity, 'update');
    await this.mustExist(entity, id);
    const defs = await this.prisma.db.customFieldDefinition.findMany({ where: { entity: entity as never, isActive: true } });
    const known = new Map(defs.map((d) => [d.key, d]));
    for (const k of Object.keys(dto.values)) if (!known.has(k)) throw new BadRequestException({ code: 'UNKNOWN_FIELD', message: `Unknown field "${k}"`, details: { key: k } });
    const current = new Map((await this.prisma.db.customFieldValue.findMany({ where: { entity: entity as never, entityId: id } })).map((v) => [v.definitionId, v.value]));
    const next = new Map<string, unknown>();
    for (const d of defs) {
      const v = d.key in dto.values ? this.coerce(d, dto.values[d.key]) : (current.get(d.id) ?? null);
      if (d.isRequired && (v === null || (Array.isArray(v) && !v.length))) throw new BadRequestException({ code: 'FIELD_REQUIRED', message: `${d.label} is required`, details: { key: d.key } });
      next.set(d.id, v);
    }
    await this.prisma.raw.$transaction(defs.map((d) => {
      const v = next.get(d.id);
      return v === null
        ? this.prisma.raw.customFieldValue.deleteMany({ where: { definitionId: d.id, entityId: id } })
        : this.prisma.raw.customFieldValue.upsert({ where: { definitionId_entityId: { definitionId: d.id, entityId: id } }, update: { value: v as never, deletedAt: null }, create: { definitionId: d.id, entity: entity as never, entityId: id, value: v as never } });
    }));
    return this.customValues(entity, id, user);
  }
}
