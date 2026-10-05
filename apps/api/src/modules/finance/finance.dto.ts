import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const money = (min = 0) => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(min)(t, k); Max(999_999_999)(t, k); };
const date = () => (t: object, k: string) => { Type(() => Date)(t, k); IsDate()(t, k); };
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateExpenseCategoryDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,29}$/, { message: 'code: lowercase letters, digits, - or _' }) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional() @o() @IsString() parentId?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateExpenseCategoryDto extends PartialType(CreateExpenseCategoryDto) {}
export class CreateBankAccountDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(80) bankName?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(40) iban?: string;
  @ApiPropertyOptional() @o() @money(-999_999_999) openingBalance?: number;
  @ApiPropertyOptional({ description: 'A cash drawer / petty cash rather than a bank' }) @o() @IsBoolean() isCashAccount?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}

export class CreateExpenseDto {
  @ApiPropertyOptional({ description: 'Defaults to the active store' }) @o() @IsString() storeId?: string;
  @ApiProperty() @IsString() categoryId!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) description!: string;
  @ApiProperty({ description: 'Total paid, VAT included' }) @money(0.01) amount!: number;
  @ApiPropertyOptional({ description: 'Of which recoverable VAT' }) @o() @money() taxAmount?: number;
  @ApiProperty() @date() incurredAt!: Date;
  @ApiPropertyOptional() @o() @IsString() supplierId?: string;
  @ApiPropertyOptional() @o() @Matches(/^(https?:\/\/|\/)[^\s]+$/) attachmentUrl?: string;
}
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
export class PayExpenseDto {
  @ApiPropertyOptional() @o() @IsString() bankAccountId?: string;
  @ApiPropertyOptional() @o() @IsString() methodId?: string;
  @ApiPropertyOptional() @o() @date() paidAt?: Date;
}
export class ListExpensesDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() categoryId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'APPROVED', 'PAID', 'REJECTED'] }) @o() @IsIn(['DRAFT', 'APPROVED', 'PAID', 'REJECTED']) status?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) to?: string;
}
export class RangeDto {
  @ApiProperty({ example: '2026-10-01' }) @Matches(DAY) from!: string;
  @ApiProperty({ example: '2026-10-31' }) @Matches(DAY) to!: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['day', 'month'] }) @o() @IsIn(['day', 'month']) groupBy?: 'day' | 'month';
  @ApiPropertyOptional() @o() @IsString() bankAccountId?: string;
}
export class ManualCashDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiProperty({ enum: ['IN', 'OUT'] }) @IsIn(['IN', 'OUT']) direction!: 'IN' | 'OUT';
  @ApiProperty() @money(0.01) amount!: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) description!: string;
  @ApiPropertyOptional() @o() @IsString() bankAccountId?: string;
  @ApiPropertyOptional() @o() @date() occurredAt?: Date;
}
export class ListPaymentsDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() methodId?: string;
  @ApiPropertyOptional({ enum: ['PAYMENT', 'DEPOSIT', 'REFUND'] }) @o() @IsIn(['PAYMENT', 'DEPOSIT', 'REFUND']) kind?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) to?: string;
}
export class ListCreditNotesDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) from?: string;
  @ApiPropertyOptional() @o() @Matches(DAY) to?: string;
}
