import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { releaseUnique } from '../../common/utils/soft-delete';
import { assertStoreAccess } from '../../common/utils/store-access';
import type { AuthUser } from '../../common/types';
import { NumberingService } from '../numbering/numbering.service';
import * as D from './customers.dto';
import { isExpired, sphericalEquivalent, validatePrescription } from './prescription.rules';

const RX_FIELDS = ['source', 'prescriberName', 'issuedAt', 'expiresAt', 'storeId', 'odSph', 'odCyl', 'odAxis', 'odAdd', 'odPd', 'odPrism', 'odBase', 'osSph', 'osCyl', 'osAxis', 'osAdd', 'osPd', 'osPrism', 'osBase', 'pdTotal', 'attachmentUrl', 'notes'] as const;
const num = (v: unknown) => (v == null ? v : Number(v));

/** Decorate a prescription row for clients: numbers (not Decimals), expiry flag and spherical equivalents. */
export const presentRx = (rx: any) => ({
  ...rx,
  isExpired: isExpired(rx.expiresAt),
  odSphericalEquivalent: sphericalEquivalent(num(rx.odSph) as number, num(rx.odCyl) as number),
  osSphericalEquivalent: sphericalEquivalent(num(rx.osSph) as number, num(rx.osCyl) as number),
});

@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService, private readonly numbering: NumberingService) {}

  // ------------------------------------------------------------------ customers
  async list(dto: D.ListCustomersDto) {
    const where = {
      ...searchWhere(dto.search, ['firstName', 'lastName', 'email', 'phone', 'whatsapp', 'code', 'nationalId']),
      ...(dto.gender && { gender: dto.gender as any }), ...(dto.storeId && { preferredStoreId: dto.storeId }), ...(dto.marketingOptIn !== undefined && { marketingOptIn: dto.marketingOptIn }),
    };
    return paginate(this.prisma.db.customer, dto, { where, sortable: ['lastName', 'firstName', 'createdAt', 'loyaltyPoints'], defaultSort: 'createdAt' });
  }

  async get(id: string) {
    const c = await this.prisma.db.customer.findFirst({
      where: { id },
      include: {
        addresses: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
        insurances: { where: { deletedAt: null }, include: { provider: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' } },
        customerNotes: { where: { deletedAt: null }, orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }], take: 50 },
        prescriptions: { where: { deletedAt: null, isActive: true }, orderBy: { issuedAt: 'desc' }, take: 1 },
        _count: { select: { prescriptions: { where: { deletedAt: null } } } },
      },
    });
    if (!c) throw new NotFoundException('Customer not found');
    const authors = await this.prisma.db.user.findMany({ where: { id: { in: [...new Set(c.customerNotes.map((n) => n.authorId).filter(Boolean) as string[])] } }, select: { id: true, firstName: true, lastName: true } });
    const { prescriptions, customerNotes, _count, ...rest } = c;
    return {
      ...rest, prescriptionCount: _count.prescriptions, currentPrescription: prescriptions[0] ? presentRx(prescriptions[0]) : null,
      notes: customerNotes.map((n) => ({ ...n, author: authors.find((a) => a.id === n.authorId) ?? null })),
    };
  }

  /** Same phone/email as an existing customer? (checked at the counter before creating a duplicate). */
  async findDuplicates(phone?: string, email?: string, excludeId?: string) {
    const or = [...(phone ? [{ phone }, { whatsapp: phone }] : []), ...(email ? [{ email: { equals: email, mode: 'insensitive' as const } }] : [])];
    if (!or.length) return [];
    return this.prisma.db.customer.findMany({ where: { OR: or, ...(excludeId && { id: { not: excludeId } }) }, select: { id: true, code: true, firstName: true, lastName: true, phone: true, email: true }, take: 5 });
  }

  async create(dto: D.CreateCustomerDto, user: AuthUser, activeStoreId?: string | null) {
    const { allowDuplicate, ...data } = dto;
    if (!allowDuplicate) {
      const dupes = await this.findDuplicates(dto.phone, dto.email);
      if (dupes.length) throw new ConflictException({ code: 'DUPLICATE_CUSTOMER', message: 'A customer with this phone or email already exists', details: { matches: dupes } });
    }
    const storeId = dto.preferredStoreId ?? activeStoreId ?? user.defaultStoreId ?? (await this.prisma.db.store.findFirst({ select: { id: true } }))?.id;
    if (!storeId) throw new BadRequestException('No store available to number the customer');
    if (dto.preferredStoreId) assertStoreAccess(user, dto.preferredStoreId);
    const id = await this.prisma.raw.$transaction(async (tx) => {
      const code = await this.numbering.next(tx, storeId, 'CUSTOMER');
      return (await tx.customer.create({ data: { ...(data as any), code, preferredStoreId: dto.preferredStoreId ?? storeId, createdById: user.id, email: dto.email?.toLowerCase() } })).id;
    });
    return this.get(id);
  }

  async update(id: string, dto: D.UpdateCustomerDto, user: AuthUser) {
    await this.mustExist(id);
    const { allowDuplicate, ...data } = dto;
    if (!allowDuplicate && (dto.phone || dto.email)) {
      const dupes = await this.findDuplicates(dto.phone, dto.email, id);
      if (dupes.length) throw new ConflictException({ code: 'DUPLICATE_CUSTOMER', message: 'Another customer already uses this phone or email', details: { matches: dupes } });
    }
    if (dto.preferredStoreId) assertStoreAccess(user, dto.preferredStoreId);
    await this.prisma.raw.customer.update({ where: { id }, data: { ...(data as any), ...(dto.email && { email: dto.email.toLowerCase() }) } });
    return this.get(id);
  }

  async remove(id: string) {
    const c = await this.mustExist(id);
    await this.prisma.raw.customer.update({ where: { id }, data: { deletedAt: new Date(), ...(c.code && { code: releaseUnique(c.code, id) }) } });
  }

  private async mustExist(id: string) {
    const c = await this.prisma.db.customer.findFirst({ where: { id } });
    if (!c) throw new NotFoundException('Customer not found');
    return c;
  }

  /** CSV export. Cells starting with = + - @ are prefixed with ' so spreadsheets never execute them as formulas. */
  async exportCsv(): Promise<string> {
    const cols = ['code', 'firstName', 'lastName', 'phone', 'email', 'gender', 'dateOfBirth', 'marketingOptIn', 'loyaltyPoints', 'createdAt'] as const;
    const cell = (v: unknown) => {
      let s = v instanceof Date ? v.toISOString().slice(0, 10) : v == null ? '' : String(v);
      if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = await this.prisma.db.customer.findMany({ orderBy: { createdAt: 'asc' }, take: 50_000, select: Object.fromEntries(cols.map((c) => [c, true])) as any });
    return '﻿' + [cols.join(','), ...rows.map((r: any) => cols.map((c) => cell(r[c])).join(','))].join('\r\n') + '\r\n';
  }

  // ------------------------------------------------------------------ addresses
  async addAddress(customerId: string, dto: D.AddressDto) {
    await this.mustExist(customerId);
    return this.prisma.raw.$transaction(async (tx) => {
      if (dto.isDefaultShipping) await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefaultShipping: false } });
      if (dto.isDefaultBilling) await tx.customerAddress.updateMany({ where: { customerId }, data: { isDefaultBilling: false } });
      return tx.customerAddress.create({ data: { ...dto, customerId } });
    });
  }
  async updateAddress(id: string, dto: D.UpdateAddressDto) {
    const a = await this.prisma.db.customerAddress.findFirst({ where: { id } });
    if (!a) throw new NotFoundException('Address not found');
    return this.prisma.raw.$transaction(async (tx) => {
      if (dto.isDefaultShipping) await tx.customerAddress.updateMany({ where: { customerId: a.customerId, id: { not: id } }, data: { isDefaultShipping: false } });
      if (dto.isDefaultBilling) await tx.customerAddress.updateMany({ where: { customerId: a.customerId, id: { not: id } }, data: { isDefaultBilling: false } });
      return tx.customerAddress.update({ where: { id }, data: dto });
    });
  }
  async removeAddress(id: string) {
    if (!(await this.prisma.db.customerAddress.findFirst({ where: { id } }))) throw new NotFoundException('Address not found');
    await this.prisma.db.customerAddress.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ notes
  async addNote(customerId: string, dto: D.NoteDto, user: AuthUser) {
    await this.mustExist(customerId);
    return this.prisma.raw.customerNote.create({ data: { customerId, body: dto.body, isPinned: dto.isPinned ?? false, authorId: user.id } });
  }
  async updateNote(id: string, dto: D.UpdateNoteDto) {
    if (!(await this.prisma.db.customerNote.findFirst({ where: { id } }))) throw new NotFoundException('Note not found');
    return this.prisma.raw.customerNote.update({ where: { id }, data: dto });
  }
  async removeNote(id: string) {
    if (!(await this.prisma.db.customerNote.findFirst({ where: { id } }))) throw new NotFoundException('Note not found');
    await this.prisma.db.customerNote.delete({ where: { id } });
  }

  // ------------------------------------------------------------------ insurance
  async addInsurance(customerId: string, dto: D.InsuranceDto) {
    await this.mustExist(customerId);
    if (!(await this.prisma.db.insuranceProvider.findFirst({ where: { id: dto.providerId } }))) throw new BadRequestException('Unknown insurance provider');
    this.assertDates(dto.validFrom, dto.validTo);
    return this.prisma.raw.customerInsurance.create({ data: { ...dto, customerId }, include: { provider: { select: { id: true, name: true } } } });
  }
  async updateInsurance(id: string, dto: D.UpdateInsuranceDto) {
    const cur = await this.prisma.db.customerInsurance.findFirst({ where: { id } });
    if (!cur) throw new NotFoundException('Insurance record not found');
    if (dto.providerId && !(await this.prisma.db.insuranceProvider.findFirst({ where: { id: dto.providerId } }))) throw new BadRequestException('Unknown insurance provider');
    this.assertDates(dto.validFrom ?? cur.validFrom, dto.validTo ?? cur.validTo);
    return this.prisma.raw.customerInsurance.update({ where: { id }, data: dto, include: { provider: { select: { id: true, name: true } } } });
  }
  async removeInsurance(id: string) {
    if (!(await this.prisma.db.customerInsurance.findFirst({ where: { id } }))) throw new NotFoundException('Insurance record not found');
    await this.prisma.db.customerInsurance.delete({ where: { id } });
  }
  private assertDates(from?: Date | null, to?: Date | null) {
    if (from && to && to < from) throw new BadRequestException('validTo cannot be before validFrom');
  }

  // ------------------------------------------------------------------ prescriptions
  async listPrescriptions(customerId: string) {
    await this.mustExist(customerId);
    const rows = await this.prisma.db.prescription.findMany({ where: { customerId }, orderBy: [{ issuedAt: 'desc' }, { createdAt: 'desc' }] });
    return rows.map(presentRx);
  }

  async getPrescription(id: string) {
    const rx = await this.prisma.db.prescription.findFirst({ where: { id } });
    if (!rx) throw new NotFoundException('Prescription not found');
    return presentRx(rx);
  }

  async addPrescription(customerId: string, dto: D.PrescriptionDto, user: AuthUser, activeStoreId?: string | null) {
    await this.mustExist(customerId);
    validatePrescription(dto);
    const { makeCurrent = true, ...data } = dto;
    const storeId = dto.storeId ?? activeStoreId ?? user.defaultStoreId ?? undefined;
    if (storeId) assertStoreAccess(user, storeId);
    const rx = await this.prisma.raw.$transaction(async (tx) => {
      if (makeCurrent) await tx.prescription.updateMany({ where: { customerId, isActive: true }, data: { isActive: false } });
      return tx.prescription.create({ data: { ...(data as any), customerId, storeId, createdById: user.id, isActive: makeCurrent } });
    });
    return presentRx(rx);
  }

  async updatePrescription(id: string, dto: D.UpdatePrescriptionDto, user: AuthUser) {
    const cur = await this.prisma.db.prescription.findFirst({ where: { id } });
    if (!cur) throw new NotFoundException('Prescription not found');
    const { makeCurrent, isActive, ...changes } = dto;
    // validate the MERGED record so a partial update can't create an inconsistent one
    const merged = { ...Object.fromEntries(RX_FIELDS.map((f) => [f, (cur as any)[f] instanceof Object && 'toNumber' in (cur as any)[f] ? Number((cur as any)[f]) : (cur as any)[f]])), ...changes };
    validatePrescription(merged);
    const rx = await this.prisma.raw.$transaction(async (tx) => {
      const active = isActive ?? (makeCurrent ? true : undefined);
      if (active) await tx.prescription.updateMany({ where: { customerId: cur.customerId, id: { not: id }, isActive: true }, data: { isActive: false } });
      // a changed measurement invalidates a previous verification
      const measurementChanged = Object.keys(changes).some((k) => /^(od|os|pd)/.test(k));
      return tx.prescription.update({ where: { id }, data: { ...(changes as any), ...(active !== undefined && { isActive: active }), ...(measurementChanged && { verifiedById: null, verifiedAt: null }) } });
    });
    void user;
    return presentRx(rx);
  }

  async verifyPrescription(id: string, user: AuthUser) {
    await this.getPrescription(id);
    return presentRx(await this.prisma.raw.prescription.update({ where: { id }, data: { verifiedById: user.id, verifiedAt: new Date() } }));
  }

  async removePrescription(id: string) {
    await this.getPrescription(id);
    await this.prisma.db.prescription.delete({ where: { id } });
  }
}
