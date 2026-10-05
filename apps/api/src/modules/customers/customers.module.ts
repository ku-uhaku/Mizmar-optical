import { Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CustomersController } from './customers.controller';
import { CustomersService } from './customers.service';
import { CreateInsuranceProviderDto, UpdateInsuranceProviderDto } from './customers.dto';

@Injectable()
export class InsuranceProvidersService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'insuranceProvider', label: 'Insurance provider', search: ['name', 'code'], sortable: ['name', 'createdAt'], defaultSort: 'name', unique: ['code'], filters: ['isActive'],
      inUse: async (p, id) => ((await p.db.customerInsurance.count({ where: { providerId: id } })) > 0 ? 'Provider is attached to customers' : null) });
  }
}
const InsuranceProvidersController = createCrudController({ path: 'insurance-providers', tag: 'customers', module: 'customers', service: InsuranceProvidersService, create: CreateInsuranceProviderDto, update: UpdateInsuranceProviderDto });

@Module({ controllers: [CustomersController, InsuranceProvidersController], providers: [CustomersService, InsuranceProvidersService], exports: [CustomersService] })
export class CustomersModule {}
