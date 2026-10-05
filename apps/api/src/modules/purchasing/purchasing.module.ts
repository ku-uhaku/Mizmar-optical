import { Injectable, Module } from '@nestjs/common';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsModule } from '../documents/documents.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PayablesService } from './payables.service';
import { CreateSupplierDto, UpdateSupplierDto } from './purchasing.dto';
import { PurchasingController } from './purchasing.controller';
import { PurchasingService } from './purchasing.service';

@Injectable()
export class SuppliersService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: 'supplier', label: 'Supplier', search: ['name', 'code', 'contactName', 'city'], sortable: ['name', 'code', 'createdAt'], defaultSort: 'name', unique: ['code'], filters: ['isActive', 'isLensLab'],
      inUse: async (p, id) => {
        if (await p.db.purchaseOrder.count({ where: { supplierId: id } })) return 'Supplier has purchase orders';
        if (await p.db.supplierInvoice.count({ where: { supplierId: id } })) return 'Supplier has invoices';
        if (await p.db.goodsReceipt.count({ where: { supplierId: id } })) return 'Supplier has goods receipts';
        return null;
      },
    });
  }
}
const SuppliersController = createCrudController({ path: 'suppliers', tag: 'purchasing', module: 'suppliers', service: SuppliersService, create: CreateSupplierDto, update: UpdateSupplierDto });

@Module({
  imports: [InventoryModule, DocumentsModule],
  controllers: [SuppliersController, PurchasingController],
  providers: [SuppliersService, PurchasingService, PayablesService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
