import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const GROUPS = ['day', 'week', 'month', 'store', 'employee', 'category', 'brand', 'product', 'type', 'channel'] as const;
export type Group = (typeof GROUPS)[number];

export class ReportQueryDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DAY) from!: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DAY) to!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: GROUPS }) @IsOptional() @IsIn(GROUPS) groupBy?: Group;
  @ApiPropertyOptional({ enum: ['units', 'revenue'] }) @IsOptional() @IsIn(['units', 'revenue']) by?: 'units' | 'revenue';
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @IsOptional() @IsIn(['fr', 'en', 'ar']) locale?: 'fr' | 'en' | 'ar';
}
export class ExportQueryDto extends ReportQueryDto {
  @ApiPropertyOptional({ enum: ['xlsx', 'csv', 'html'], description: 'html opens a print-ready page (Print → Save as PDF)' }) @IsOptional() @IsIn(['xlsx', 'csv', 'html']) format?: 'xlsx' | 'csv' | 'html';
}
export class StockQueryDto {
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @IsOptional() @IsIn(['fr', 'en', 'ar']) locale?: 'fr' | 'en' | 'ar';
}
