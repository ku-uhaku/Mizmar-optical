import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDefined, IsIn, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const money = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(99_999_999)(t, k); };

export class OpenSessionDto {
  @ApiProperty() @IsString() registerId!: string;
  @ApiProperty({ description: 'Cash in the drawer at opening' }) @money() openingFloat!: number;
}
export class CashMovementDto {
  @ApiProperty({ enum: ['CASH_IN', 'CASH_OUT'] }) @IsIn(['CASH_IN', 'CASH_OUT']) type!: 'CASH_IN' | 'CASH_OUT';
  @ApiProperty() @money() amount!: number;
  @ApiProperty({ description: 'Why (e.g. bank deposit, change float, supplier paid in cash)' }) @IsString() @MaxLength(200) reason!: string;
}
export class CloseSessionDto {
  @ApiProperty({ description: 'Cash actually counted in the drawer' }) @money() countedCash!: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
export class ListSessionsDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['OPEN', 'CLOSED'] }) @IsOptional() @IsIn(['OPEN', 'CLOSED']) status?: string;
}
export class DailyReportDto {
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ example: '2026-10-05', description: 'Local date in the store timezone (default: today)' }) @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
}
export class HoldSaleDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(80) label?: string;
  @ApiProperty({ description: 'The POS cart as the client sent it to checkout' }) @IsDefined() @IsObject() cart!: Record<string, unknown>;
  @ApiPropertyOptional() @IsOptional() @IsString() registerId?: string;
}
export class LensOptionsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Type(() => String) @IsString() lensTypeId?: string;
}
