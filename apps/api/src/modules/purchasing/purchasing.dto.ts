import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PurchaseOrderStatus, SupplierInvoiceStatus } from '../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const vals = <T extends object>(e: T) => Object.values(e) as string[];
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));
const cost = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(9_999_999)(t, k); };
const pct = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(100)(t, k); };

export class CreateSupplierDto {
  @ApiProperty({ example: 'SUP-ESSILOR' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,29}$/, { message: 'code: A-Z, 0-9, _ or -' }) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(120) name!: string;
  @ApiPropertyOptional() @o() @IsString() contactName?: string;
  @ApiPropertyOptional() @o() @IsEmail() email?: string;
  @ApiPropertyOptional() @o() @IsString() phone?: string;
  @ApiPropertyOptional() @o() @IsString() address?: string;
  @ApiPropertyOptional() @o() @IsString() city?: string;
  @ApiPropertyOptional() @o() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional({ description: 'ICE / tax id' }) @o() @IsString() taxId?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(365) paymentTermsDays?: number;
  @ApiPropertyOptional() @o() @IsString() currency?: string;
  @ApiPropertyOptional({ description: 'Supplies prescription lenses (appears in the workshop)' }) @o() @IsBoolean() isLensLab?: boolean;
  @ApiPropertyOptional() @o() @IsString() notes?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateSupplierDto extends PartialType(CreateSupplierDto) {}

export class PoLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
  @ApiProperty({ description: 'Unit cost EXCLUDING tax' }) @cost() unitCost!: number;
  @ApiPropertyOptional({ description: 'Defaults to the default tax rate' }) @o() @pct() taxRatePct?: number;
}
export class CreatePurchaseOrderDto {
  @ApiProperty() @IsString() supplierId!: string;
  @ApiProperty({ description: 'Warehouse the goods will be delivered to' }) @IsString() warehouseId!: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() expectedAt?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
  @ApiProperty({ type: [PoLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PoLineDto) lines!: PoLineDto[];
}
export class UpdatePurchaseOrderDto extends PartialType(CreatePurchaseOrderDto) {}
export class ListPurchaseOrdersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(PurchaseOrderStatus) }) @o() @IsIn(vals(PurchaseOrderStatus)) status?: string;
  @ApiPropertyOptional() @o() @IsString() supplierId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ description: 'Expected date has passed and goods are still outstanding' }) @o() @bool() @IsBoolean() overdue?: boolean;
}

export class ReceiveLineDto {
  @ApiProperty() @IsString() purchaseOrderLineId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
  @ApiPropertyOptional({ description: 'Actual cost if different from the order (excl. tax)' }) @o() @cost() unitCost?: number;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(60) lotNumber?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() expiryDate?: Date;
}
export class ReceiveDto {
  @ApiPropertyOptional({ description: "Supplier's delivery note number" }) @o() @IsString() @MaxLength(60) deliveryNoteRef?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: [ReceiveLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines!: ReceiveLineDto[];
}
export class DirectReceiptLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
  @ApiProperty() @cost() unitCost!: number;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(60) lotNumber?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() expiryDate?: Date;
}
export class DirectReceiptDto {
  @ApiProperty() @IsString() supplierId!: string;
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(60) deliveryNoteRef?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) note?: string;
  @ApiProperty({ type: [DirectReceiptLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => DirectReceiptLineDto) lines!: DirectReceiptLineDto[];
}
export class ListReceiptsDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() supplierId?: string;
  @ApiPropertyOptional() @o() @IsString() purchaseOrderId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
}

export class InvoiceLineDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(300) description!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
  @ApiProperty({ description: 'Unit cost excluding tax' }) @cost() unitCost!: number;
  @ApiPropertyOptional() @o() @pct() taxRatePct?: number;
  @ApiPropertyOptional({ description: 'Match this line to goods that were received' }) @o() @IsString() goodsReceiptLineId?: string;
}
export class CreateSupplierInvoiceDto {
  @ApiProperty() @IsString() supplierId!: string;
  @ApiProperty({ description: "The supplier's own invoice number" }) @IsString() @MinLength(1) @MaxLength(60) supplierRef!: string;
  @ApiProperty() @Type(() => Date) @IsDate() issuedAt!: Date;
  @ApiPropertyOptional({ description: 'Default: issue date + the supplier payment terms' }) @o() @Type(() => Date) @IsDate() dueAt?: Date;
  @ApiPropertyOptional() @o() @IsString() purchaseOrderId?: string;
  @ApiPropertyOptional() @o() @Matches(/^(https?:\/\/|\/)[^\s]+$/) attachmentUrl?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
  @ApiProperty({ type: [InvoiceLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => InvoiceLineDto) lines!: InvoiceLineDto[];
}
export class ListSupplierInvoicesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(SupplierInvoiceStatus) }) @o() @IsIn(vals(SupplierInvoiceStatus)) status?: string;
  @ApiPropertyOptional() @o() @IsString() supplierId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ description: 'Past due and not fully paid' }) @o() @bool() @IsBoolean() overdue?: boolean;
}
export class SupplierPaymentDto {
  @ApiProperty() @IsString() methodId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99_999_999) amount!: number;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional() @o() @IsString() bankAccountId?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() paidAt?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(300) note?: string;
}
export class StoreFilterDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
}
