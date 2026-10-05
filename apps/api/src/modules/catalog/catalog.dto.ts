import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, IsUrl, Matches, Max, Min, MinLength } from 'class-validator';
import { LensKind, TreatmentCategory } from '../../generated/prisma/client';

const opt = () => IsOptional();
const money = () => [IsNumber({ maxDecimalPlaces: 2 }), Min(0)];
const apply = (...d: PropertyDecorator[]) => (t: object, k: string) => d.forEach((x) => x(t, k));

export class CreateBrandDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @Matches(/^[a-z0-9-]+$/) slug?: string;
  @ApiPropertyOptional() @opt() @IsString() logoUrl?: string;
  @ApiPropertyOptional() @opt() @IsString() description?: string;
  @ApiPropertyOptional() @opt() @IsString() website?: string;
  @ApiPropertyOptional() @opt() @IsBoolean() isFeatured?: boolean;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateBrandDto extends PartialType(CreateBrandDto) {}

export class CreateCategoryDto {
  @ApiPropertyOptional() @opt() @IsString() parentId?: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @Matches(/^[a-z0-9-]+$/) slug?: string;
  @ApiPropertyOptional() @opt() @IsString() description?: string;
  @ApiPropertyOptional() @opt() @IsString() imageUrl?: string;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateCategoryDto extends PartialType(CreateCategoryDto) {}

export class CreateFrameShapeDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @Matches(/^[a-z0-9-]+$/) slug?: string;
  @ApiPropertyOptional() @opt() @IsString() iconUrl?: string;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateFrameShapeDto extends PartialType(CreateFrameShapeDto) {}

export class CreateFrameMaterialDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @Matches(/^[a-z0-9-]+$/) slug?: string;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateFrameMaterialDto extends PartialType(CreateFrameMaterialDto) {}

export class CreateLensTypeDto {
  @ApiProperty({ example: 'progressive' }) @IsString() @Matches(/^[a-z][a-z0-9_]{1,40}$/) code!: string;
  @ApiProperty({ enum: Object.values(LensKind) }) @IsIn(Object.values(LensKind)) kind!: (typeof LensKind)[keyof typeof LensKind];
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @IsString() description?: string;
  @ApiPropertyOptional() @opt() @apply(...money()) basePrice?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() requiresAdd?: boolean;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateLensTypeDto extends PartialType(CreateLensTypeDto) {}

export class CreateLensTreatmentDto {
  @ApiProperty({ example: 'anti_reflective' }) @IsString() @Matches(/^[a-z][a-z0-9_]{1,40}$/) code!: string;
  @ApiProperty({ enum: Object.values(TreatmentCategory) }) @IsIn(Object.values(TreatmentCategory)) category!: (typeof TreatmentCategory)[keyof typeof TreatmentCategory];
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @opt() @IsString() description?: string;
  @ApiPropertyOptional() @opt() @apply(...money()) price?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @opt() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @opt() @IsObject() translations?: Record<string, unknown>;
}
export class UpdateLensTreatmentDto extends PartialType(CreateLensTreatmentDto) {}

const range = (min: number, max: number) => apply(IsNumber({ maxDecimalPlaces: 2 }), Min(min), Max(max));
export class CreateLensEntryDto {
  @ApiProperty() @IsString() lensTypeId!: string;
  @ApiPropertyOptional() @opt() @IsString() supplierId?: string;
  @ApiProperty() @IsString() @MinLength(1) sku!: string;
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiProperty({ example: 1.6 }) @range(1.4, 2.0) refractiveIndex!: number;
  @ApiPropertyOptional() @opt() @IsString() material?: string;
  @ApiPropertyOptional() @opt() @IsInt() @Min(40) @Max(100) diameterMm?: number;
  @ApiPropertyOptional() @opt() @range(-30, 30) sphMin?: number;
  @ApiPropertyOptional() @opt() @range(-30, 30) sphMax?: number;
  @ApiPropertyOptional() @opt() @range(-15, 15) cylMin?: number;
  @ApiPropertyOptional() @opt() @range(-15, 15) cylMax?: number;
  @ApiPropertyOptional() @opt() @range(0, 6) addMin?: number;
  @ApiPropertyOptional() @opt() @range(0, 6) addMax?: number;
  @ApiProperty() @apply(...money()) price!: number;
  @ApiPropertyOptional() @opt() @apply(...money()) cost?: number;
  @ApiPropertyOptional() @opt() @IsInt() @Min(0) leadTimeDays?: number;
  @ApiPropertyOptional() @opt() @IsBoolean() isActive?: boolean;
}
export class UpdateLensEntryDto extends PartialType(CreateLensEntryDto) {}
void IsUrl;
