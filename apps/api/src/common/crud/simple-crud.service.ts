import { ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { PaginationDto } from '../dto/pagination.dto';
import { paginate, searchWhere } from '../utils/paginate';
import { releaseUnique } from '../utils/soft-delete';
import { uniqueSlug } from '../utils/slug';

export interface CrudConfig {
  model: string; // prisma delegate name, e.g. 'brand'
  label: string; // for error messages
  search: string[];
  sortable: string[];
  defaultSort: string;
  /** Globally-unique columns released (suffixed) on soft delete so the value can be reused. */
  unique?: string[];
  /** Auto-generate `slug` from this field when the client doesn't send one. */
  slugFrom?: string;
  /** Query-string filters a client may use on the list endpoint (exact match). */
  filters?: string[];
  include?: object;
  /** Normalise / validate the payload before it is written (sanitise HTML, enforce one-default rules…). Throw an HttpException to refuse. */
  beforeSave?: (data: Record<string, any>, existing: Record<string, any> | null, prisma: PrismaService) => Promise<Record<string, any>> | Record<string, any>;
  /** Runs after create/update/delete (e.g. clear a cache). */
  afterChange?: () => void;
  /** Return a human reason if the row can't be deleted (e.g. still referenced). */
  inUse?: (prisma: PrismaService, id: string) => Promise<string | null>;
}

/**
 * Generic CRUD for simple reference-data tables (brands, categories, lens types…). Concrete services only supply a config.
 * Complex aggregates (products, customers, inventory) have their own services.
 */
export abstract class SimpleCrudService {
  constructor(protected readonly prisma: PrismaService, protected readonly cfg: CrudConfig) {}

  protected get db(): any { return (this.prisma.db as any)[this.cfg.model]; }
  protected get raw(): any { return (this.prisma.raw as any)[this.cfg.model]; }

  async list(dto: PaginationDto, query: Record<string, any> = {}) {
    const filters: Record<string, unknown> = {};
    for (const key of this.cfg.filters ?? []) {
      const v = query[key];
      if (v === undefined || v === '') continue;
      filters[key] = v === 'true' ? true : v === 'false' ? false : v;
    }
    return paginate(this.db, dto, {
      where: { ...searchWhere(dto.search, this.cfg.search), ...filters },
      include: this.cfg.include, sortable: this.cfg.sortable, defaultSort: this.cfg.defaultSort,
    });
  }

  async get(id: string) {
    const row = await this.db.findFirst({ where: { id }, include: this.cfg.include });
    if (!row) throw new NotFoundException(`${this.cfg.label} not found`);
    return row;
  }

  async create(data: Record<string, any>) {
    const { slugFrom } = this.cfg;
    if (slugFrom && !data.slug) data.slug = await uniqueSlug(async (s) => !!(await this.raw.findFirst({ where: { slug: s } })), data[slugFrom], this.cfg.model);
    if (this.cfg.beforeSave) data = await this.cfg.beforeSave(data, null, this.prisma);
    const row = await this.raw.create({ data, include: this.cfg.include });
    this.cfg.afterChange?.();
    return row;
  }

  async update(id: string, data: Record<string, any>) {
    const existing = await this.get(id);
    if (this.cfg.beforeSave) data = await this.cfg.beforeSave(data, existing, this.prisma);
    const row = await this.raw.update({ where: { id }, data, include: this.cfg.include });
    this.cfg.afterChange?.();
    return row;
  }

  async remove(id: string) {
    const row = await this.get(id);
    const reason = await this.cfg.inUse?.(this.prisma, id);
    if (reason) throw new ConflictException({ code: 'IN_USE', message: reason });
    const released = Object.fromEntries((this.cfg.unique ?? []).filter((f) => typeof row[f] === 'string').map((f) => [f, releaseUnique(row[f], id)]));
    await this.raw.update({ where: { id }, data: { deletedAt: new Date(), ...released } });
    this.cfg.afterChange?.();
  }
}
