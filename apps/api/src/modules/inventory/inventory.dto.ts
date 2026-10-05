import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';
import { AdjustmentReason, ProductType, StockMovementType } from '../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const vals = <T extends object>(e: T) => Object.values(e) as string[];
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

export class StockQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() brandId?: string;
  @ApiPropertyOptional({ enum: vals(ProductType) }) @IsOptional() @IsIn(vals(ProductType)) productType?: string;
  @ApiPropertyOptional({ description: 'Only levels at or below their reorder point' }) @IsOptional() @bool() @IsBoolean() lowStock?: boolean;
}
export class StoreFilterDto {
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
}
export class MovementQueryDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() variantId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: vals(StockMovementType) }) @IsOptional() @IsIn(vals(StockMovementType)) type?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}
export class UpdateStockLevelDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) reorderPoint?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1_000_000) reorderQty?: number;
}

export class AdjustmentLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty({ description: 'Signed change, e.g. -2 (damaged) or +1 (found)' }) @IsInt() @Min(-100_000) @Max(100_000) quantityDelta!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
export class CreateAdjustmentDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty({ enum: vals(AdjustmentReason) }) @IsIn(vals(AdjustmentReason)) reason!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiProperty({ type: [AdjustmentLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => AdjustmentLineDto) lines!: AdjustmentLineDto[];
}

export class TransferLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
}
export class CreateTransferDto {
  @ApiProperty() @IsString() fromWarehouseId!: string;
  @ApiProperty() @IsString() toWarehouseId!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
  @ApiPropertyOptional({ description: 'Ship immediately (stock leaves the origin now)' }) @IsOptional() @IsBoolean() ship?: boolean;
  @ApiProperty({ type: [TransferLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => TransferLineDto) lines!: TransferLineDto[];
}
export class ReceiveLineDto {
  @ApiProperty() @IsString() lineId!: string;
  @ApiProperty() @IsInt() @Min(0) receivedQty!: number;
}
export class ReceiveTransferDto {
  @ApiPropertyOptional({ type: [ReceiveLineDto], description: 'Omit to receive everything that was shipped' })
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiveLineDto) lines?: ReceiveLineDto[];
}
export class ListDocsDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() status?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() warehouseId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
}

export class CreateCountDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiPropertyOptional({ enum: vals(ProductType), description: 'Count only this product type' }) @IsOptional() @IsIn(vals(ProductType)) productType?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
export class CountLineInputDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty({ nullable: true }) @IsOptional() @IsInt() @Min(0) @Max(1_000_000) countedQty!: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() note?: string;
}
export class SaveCountLinesDto {
  @ApiProperty({ type: [CountLineInputDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CountLineInputDto) lines!: CountLineInputDto[];
}

export class CreateWarehouseDto {
  @ApiProperty() @IsString() storeId!: string;
  @ApiProperty() @IsString() code!: string;
  @ApiProperty() @IsString() name!: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateWarehouseDto {
  @ApiPropertyOptional() @IsOptional() @IsString() name?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
