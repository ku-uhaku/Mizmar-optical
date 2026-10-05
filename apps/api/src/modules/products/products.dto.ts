import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, Min, MinLength, ValidateNested } from 'class-validator';
import { Gender, ProductStatus, ProductType, RimType } from '../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const price = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(9_999_999)(t, k); };
const vals = <T extends object>(e: T) => Object.values(e) as string[];
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));

export class FrameSpecDto {
  @ApiPropertyOptional() @o() @IsString() shapeId?: string;
  @ApiPropertyOptional() @o() @IsString() materialId?: string;
  @ApiPropertyOptional({ enum: vals(RimType) }) @o() @IsIn(vals(RimType)) rimType?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(10) @Max(80) lensWidthMm?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(10) @Max(80) lensHeightMm?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(5) @Max(40) bridgeMm?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(80) @Max(180) templeMm?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(80) @Max(200) frameWidthMm?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(1) @Max(200) weightGrams?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isPolarized?: boolean;
  @ApiPropertyOptional() @o() @IsString() uvProtection?: string;
}

export class InitialStockDto {
  @ApiProperty() @IsString() warehouseId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(100_000) quantity!: number;
}

export class CreateVariantDto {
  @ApiProperty({ example: 'RB5154-01-52' }) @IsString() @MinLength(1) @Matches(/^[\w.\-/]+$/, { message: 'sku may contain letters, digits, . _ - /' }) sku!: string;
  @ApiPropertyOptional() @o() @IsString() @MinLength(4) barcode?: string;
  @ApiPropertyOptional() @o() @IsString() name?: string;
  @ApiPropertyOptional() @o() @IsString() color?: string;
  @ApiPropertyOptional({ example: '#111111' }) @o() @Matches(/^#[0-9a-fA-F]{6}$/) colorHex?: string;
  @ApiPropertyOptional({ example: '52-18-145' }) @o() @IsString() size?: string;
  @ApiProperty() @price() price!: number;
  @ApiPropertyOptional() @o() @price() compareAtPrice?: number;
  @ApiPropertyOptional() @o() @price() cost?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) weightGrams?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsInt() sortOrder?: number;
  @ApiPropertyOptional({ type: [InitialStockDto], description: 'Opening stock per warehouse (recorded as INITIAL movements)' })
  @o() @IsArray() @ArrayMaxSize(20) @ValidateNested({ each: true }) @Type(() => InitialStockDto) initialStock?: InitialStockDto[];
}
export class UpdateVariantDto extends PartialType(OmitType(CreateVariantDto, ['initialStock'] as const)) {}

export class CreateProductDto {
  @ApiProperty({ enum: vals(ProductType) }) @IsIn(vals(ProductType)) type!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @o() @Matches(/^[a-z0-9-]+$/) slug?: string;
  @ApiPropertyOptional() @o() @IsString() brandId?: string;
  @ApiPropertyOptional() @o() @IsString() categoryId?: string;
  @ApiPropertyOptional() @o() @IsString() taxRateId?: string;
  @ApiPropertyOptional() @o() @IsString() shortDescription?: string;
  @ApiPropertyOptional() @o() @IsString() description?: string;
  @ApiPropertyOptional({ enum: vals(Gender) }) @o() @IsIn(vals(Gender)) gender?: string;
  @ApiPropertyOptional({ enum: vals(ProductStatus) }) @o() @IsIn(vals(ProductStatus)) status?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isPublished?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isFeatured?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() requiresPrescription?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isLensConfigurable?: boolean;
  @ApiPropertyOptional({ type: [String] }) @o() @IsArray() @ArrayUnique() @ArrayMaxSize(30) @IsString({ each: true }) tags?: string[];
  @ApiPropertyOptional() @o() @IsString() seoTitle?: string;
  @ApiPropertyOptional() @o() @IsString() seoDescription?: string;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, unknown>;
  @ApiPropertyOptional({ type: FrameSpecDto }) @o() @ValidateNested() @Type(() => FrameSpecDto) frameSpec?: FrameSpecDto;
  @ApiPropertyOptional({ type: [CreateVariantDto] }) @o() @IsArray() @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => CreateVariantDto) variants?: CreateVariantDto[];
}
export class UpdateProductDto extends PartialType(OmitType(CreateProductDto, ['type', 'variants'] as const)) {}

export class ListProductsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(ProductType) }) @o() @IsIn(vals(ProductType)) type?: string;
  @ApiPropertyOptional() @o() @IsString() brandId?: string;
  @ApiPropertyOptional() @o() @IsString() categoryId?: string;
  @ApiPropertyOptional({ enum: vals(ProductStatus) }) @o() @IsIn(vals(ProductStatus)) status?: string;
  @ApiPropertyOptional({ enum: vals(Gender) }) @o() @IsIn(vals(Gender)) gender?: string;
  @ApiPropertyOptional() @o() @IsString() shapeId?: string;
  @ApiPropertyOptional() @o() @IsString() materialId?: string;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() isPublished?: boolean;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() isFeatured?: boolean;
  @ApiPropertyOptional() @o() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @ApiPropertyOptional() @o() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;
}

export class LookupQueryDto {
  @ApiPropertyOptional({ description: 'Also match draft/archived products and inactive variants (inventory screens)' }) @o() @bool() @IsBoolean() includeInactive?: boolean;
}

export class AddImageDto {
  @ApiProperty() @IsString() @Matches(/^(https?:\/\/|\/)[^\s]+$/, { message: 'url must be http(s) or an absolute path' }) url!: string;
  @ApiPropertyOptional() @o() @IsString() alt?: string;
  @ApiPropertyOptional() @o() @IsString() variantId?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isPrimary?: boolean;
}
export class ReorderImagesDto {
  @ApiProperty({ type: [String] }) @IsArray() @ArrayUnique() @IsString({ each: true }) ids!: string[];
}
