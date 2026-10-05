import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsLatitude, IsLongitude, IsObject, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateStoreDto {
  @ApiProperty({ example: 'CASA' }) @IsString() @Matches(/^[A-Z0-9_-]{2,12}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(2) name!: string;
  @ApiProperty({ example: 'casablanca-maarif' }) @IsString() @Matches(/^[a-z0-9-]+$/) slug!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() region?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() postalCode?: string;
  @ApiPropertyOptional() @IsOptional() @IsLatitude() latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsLongitude() longitude?: number;
  @ApiPropertyOptional({ description: '{ mon: [{open,close}], ... }' }) @IsOptional() @IsObject() openingHours?: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() showOnLocator?: boolean;
}
export class UpdateStoreDto extends PartialType(CreateStoreDto) {}
export class ListStoresDto extends PaginationDto {}
