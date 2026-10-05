import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUUID, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { ItemCondition, OrderPaymentStatus, OrderStatus, QuoteStatus } from '../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const vals = <T extends object>(e: T) => Object.values(e) as string[];
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

export class DiscountDto {
  @ApiProperty({ enum: ['PERCENT', 'AMOUNT'] }) @IsIn(['PERCENT', 'AMOUNT']) type!: 'PERCENT' | 'AMOUNT';
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(99_999_999) value!: number;
}

export class LensInputDto {
  @ApiProperty() @IsString() lensTypeId!: string;
  @ApiPropertyOptional({ description: 'A concrete lens from the catalog; omit to price at the lens type base price' }) @IsOptional() @IsString() lensEntryId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @ArrayMaxSize(10) @IsString({ each: true }) treatmentIds?: string[];
  @ApiPropertyOptional({ description: "One of the customer's prescriptions" }) @IsOptional() @IsString() prescriptionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

export class SaleLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
  @ApiPropertyOptional({ type: DiscountDto, description: 'Requires the pos:discount permission' }) @IsOptional() @ValidateNested() @Type(() => DiscountDto) discount?: DiscountDto;
  @ApiPropertyOptional({ type: LensInputDto, description: 'Prescription lenses to fit in this frame' }) @IsOptional() @ValidateNested() @Type(() => LensInputDto) lens?: LensInputDto;
}

export class PaymentInputDto {
  @ApiProperty() @IsString() methodId!: string;
  @ApiProperty({ description: 'Amount applied to the order (for cash, the amount due — change is handled at the till)' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99_999_999) amount!: number;
  @ApiPropertyOptional({ description: 'Card slip, cheque number, transfer reference…' }) @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class CheckoutDto {
  @ApiPropertyOptional({ description: 'Unique per checkout attempt (a UUID). Retrying the same attempt returns the original order.' }) @IsOptional() @IsString() @MaxLength(64) clientRef?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiProperty({ type: [SaleLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines!: SaleLineDto[];
  @ApiProperty({ type: [PaymentInputDto] }) @IsArray() @ArrayMaxSize(10) @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments!: PaymentInputDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @ApiPropertyOptional({ description: 'Convert this quote (it is re-priced at current prices)' }) @IsOptional() @IsString() quoteId?: string;
}

export class AddPaymentDto {
  @ApiProperty() @IsString() methodId!: string;
  @ApiProperty() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) @Max(99_999_999) amount!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}

export class ListOrdersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(OrderStatus) }) @IsOptional() @IsIn(vals(OrderStatus)) status?: string;
  @ApiPropertyOptional({ enum: vals(OrderPaymentStatus) }) @IsOptional() @IsIn(vals(OrderPaymentStatus)) paymentStatus?: string;
  @ApiPropertyOptional({ enum: ['POS', 'ONLINE'] }) @IsOptional() @IsIn(['POS', 'ONLINE']) channel?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ description: 'Only orders with an outstanding balance' }) @IsOptional() @bool() @IsBoolean() hasBalance?: boolean;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

export class ReturnLineDto {
  @ApiProperty() @IsString() orderLineId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(1000) quantity!: number;
  @ApiPropertyOptional({ enum: vals(ItemCondition) }) @IsOptional() @IsIn(vals(ItemCondition)) condition?: string;
  @ApiPropertyOptional({ description: 'Put the item back in stock (default: yes unless damaged)' }) @IsOptional() @IsBoolean() restock?: boolean;
}
export class RefundInputDto {
  @ApiProperty() @IsString() methodId!: string;
  @ApiPropertyOptional({ description: 'Defaults to the full value of the returned lines (capped at what was paid)' }) @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) reference?: string;
}
export class CreateReturnDto {
  @ApiProperty({ type: [ReturnLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => ReturnLineDto) lines!: ReturnLineDto[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional({ type: RefundInputDto, description: 'Omit to record the return without paying anything back (e.g. store credit later)' }) @IsOptional() @ValidateNested() @Type(() => RefundInputDto) refund?: RefundInputDto;
}
export class CancelOrderDto {
  @ApiProperty() @IsString() @MaxLength(500) reason!: string;
  @ApiPropertyOptional({ type: RefundInputDto }) @IsOptional() @ValidateNested() @Type(() => RefundInputDto) refund?: RefundInputDto;
}

export class CreateQuoteDto {
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiProperty({ type: [SaleLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines!: SaleLineDto[];
  @ApiPropertyOptional({ example: '2026-11-05' }) @IsOptional() @Type(() => Date) @IsDate() validUntil?: Date;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateQuoteDto extends PartialType(CreateQuoteDto) {}
export class ListQuotesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(QuoteStatus) }) @IsOptional() @IsIn(vals(QuoteStatus)) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
}
export class ListInvoicesDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() customerId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
export class DocumentQueryDto {
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @IsOptional() @IsIn(['fr', 'en', 'ar']) locale?: string;
}
void IsUUID;
