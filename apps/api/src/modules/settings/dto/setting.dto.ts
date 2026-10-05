import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDefined, IsEnum, IsOptional, IsString, ValidateNested } from 'class-validator';

export class UpsertSettingDto {
  @ApiPropertyOptional({ enum: ['GLOBAL', 'STORE'], default: 'GLOBAL' }) @IsOptional() @IsEnum({ GLOBAL: 'GLOBAL', STORE: 'STORE' }) scope?: 'GLOBAL' | 'STORE';
  @ApiPropertyOptional({ description: 'Store id when scope = STORE' }) @IsOptional() @IsString() storeId?: string;
  @ApiProperty({ example: 'general' }) @IsString() group!: string;
  @ApiProperty({ example: 'currency' }) @IsString() key!: string;
  @ApiProperty({ description: 'Any JSON value' }) @IsDefined() value!: unknown;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isPublic?: boolean;
}

export class BulkUpsertSettingsDto {
  @ApiProperty({ type: [UpsertSettingDto] }) @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => UpsertSettingDto) items!: UpsertSettingDto[];
}
