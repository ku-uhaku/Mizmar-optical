import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';

const count = async (p: Promise<number>, msg: string) => ((await p) > 0 ? msg : null);

@Injectable()
export class BrandsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'brand', label: 'Brand', search: ['name', 'slug'], sortable: ['name', 'sortOrder', 'createdAt'], defaultSort: 'name', unique: ['slug'], slugFrom: 'name', filters: ['isActive'],
      inUse: (p, id) => count(p.db.product.count({ where: { brandId: id } }), 'Brand still has products') });
  }
}

@Injectable()
export class CategoriesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'category', label: 'Category', search: ['name', 'slug'], sortable: ['name', 'sortOrder', 'createdAt'], defaultSort: 'sortOrder', unique: ['slug'], slugFrom: 'name', filters: ['isActive', 'parentId'],
      include: { parent: { select: { id: true, name: true } } },
      inUse: async (p, id) => (await count(p.db.product.count({ where: { categoryId: id } }), 'Category still has products')) ?? (await count(p.db.category.count({ where: { parentId: id } }), 'Category has sub-categories')) });
  }
  async create(data: Record<string, any>) { await this.assertNoCycle(undefined, data.parentId); return super.create(data); }
  async update(id: string, data: Record<string, any>) { await this.assertNoCycle(id, data.parentId); return super.update(id, data); }
  /** A category may not be moved under itself or one of its own descendants. */
  private async assertNoCycle(id: string | undefined, parentId: string | undefined | null) {
    if (!parentId) return;
    for (let cur: string | null = parentId, hops = 0; cur && hops < 20; hops++) {
      if (cur === id) throw new BadRequestException('A category cannot be its own ancestor');
      const row: { parentId: string | null } | null = await this.prisma.db.category.findFirst({ where: { id: cur }, select: { parentId: true } });
      if (!row) throw new BadRequestException('Parent category not found');
      cur = row.parentId;
    }
  }
}

@Injectable()
export class FrameShapesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'frameShape', label: 'Shape', search: ['name', 'slug'], sortable: ['name', 'sortOrder'], defaultSort: 'sortOrder', unique: ['slug'], slugFrom: 'name', filters: ['isActive'],
      inUse: (p, id) => count(p.db.frameSpec.count({ where: { shapeId: id } }), 'Shape is used by frames') });
  }
}

@Injectable()
export class FrameMaterialsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'frameMaterial', label: 'Material', search: ['name', 'slug'], sortable: ['name', 'sortOrder'], defaultSort: 'sortOrder', unique: ['slug'], slugFrom: 'name', filters: ['isActive'],
      inUse: (p, id) => count(p.db.frameSpec.count({ where: { materialId: id } }), 'Material is used by frames') });
  }
}

@Injectable()
export class LensTypesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'lensType', label: 'Lens type', search: ['name', 'code'], sortable: ['name', 'sortOrder', 'basePrice'], defaultSort: 'sortOrder', unique: ['code'], filters: ['isActive', 'kind'],
      include: { treatments: { where: { deletedAt: null }, select: { treatmentId: true, priceOverride: true } } },
      inUse: (p, id) => count(p.db.lensCatalogEntry.count({ where: { lensTypeId: id } }), 'Lens type still has catalog entries') });
  }

  /** `treatmentIds` replaces the set of treatments offered with this lens type. */
  async create(data: Record<string, any>) {
    const { treatmentIds, ...rest } = data;
    const row = await super.create(rest);
    if (treatmentIds) await this.setTreatments(row.id, treatmentIds);
    return this.get(row.id);
  }
  async update(id: string, data: Record<string, any>) {
    const { treatmentIds, ...rest } = data;
    await super.update(id, rest);
    if (treatmentIds) await this.setTreatments(id, treatmentIds);
    return this.get(id);
  }
  async setTreatments(lensTypeId: string, treatmentIds: string[]) {
    const valid = await this.prisma.db.lensTreatment.findMany({ where: { id: { in: treatmentIds } }, select: { id: true } });
    await this.prisma.raw.$transaction([
      this.prisma.raw.lensTypeTreatment.deleteMany({ where: { lensTypeId } }),
      this.prisma.raw.lensTypeTreatment.createMany({ data: valid.map((t) => ({ lensTypeId, treatmentId: t.id })) }),
    ]);
  }
}

@Injectable()
export class LensTreatmentsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'lensTreatment', label: 'Treatment', search: ['name', 'code'], sortable: ['name', 'sortOrder', 'price'], defaultSort: 'sortOrder', unique: ['code'], filters: ['isActive', 'category'] });
  }
}

@Injectable()
export class LensEntriesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'lensCatalogEntry', label: 'Lens catalog entry', search: ['name', 'sku', 'material'], sortable: ['name', 'sku', 'price', 'refractiveIndex'], defaultSort: 'name', unique: ['sku'], filters: ['isActive', 'lensTypeId', 'supplierId'],
      include: { lensType: { select: { id: true, name: true, code: true } } } });
  }
}
