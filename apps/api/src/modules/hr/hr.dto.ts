import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const date = () => (t: object, k: string) => { Type(() => Date)(t, k); IsDate()(t, k); };
const money = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(9_999_999)(t, k); };
const PERIOD = /^\d{4}-(0[1-9]|1[0-2])$/;

export class CreateEmployeeDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) lastName!: string;
  @ApiPropertyOptional({ description: 'Link to a dashboard login (needed for self-service clock-in and leave requests)' }) @o() @IsString() userId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() managerId?: string;
  @ApiPropertyOptional({ description: 'Generated (EMP-0001…) when omitted' }) @o() @IsString() @Matches(/^[A-Z0-9][A-Z0-9-]{1,19}$/) employeeNumber?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(30) nationalId?: string;
  @ApiPropertyOptional({ description: 'CNSS number' }) @o() @IsString() @MaxLength(30) socialSecurityNo?: string;
  @ApiPropertyOptional() @o() @date() birthDate?: Date;
  @ApiPropertyOptional() @o() @date() hireDate?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(80) position?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(80) department?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @o() @IsEmail() email?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) address?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(40) bankIban?: string;
}
export class UpdateEmployeeDto extends PartialType(CreateEmployeeDto) {
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] }) @o() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
  @ApiPropertyOptional() @o() @date() terminationDate?: Date;
}
export class ListEmployeesDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'ON_LEAVE', 'TERMINATED'] }) @o() @IsIn(['ACTIVE', 'ON_LEAVE', 'TERMINATED']) status?: string;
}
export class ContractDto {
  @ApiProperty({ enum: ['CDI', 'CDD', 'ANAPEC', 'INTERNSHIP', 'FREELANCE'] }) @IsIn(['CDI', 'CDD', 'ANAPEC', 'INTERNSHIP', 'FREELANCE']) type!: string;
  @ApiProperty() @date() startDate!: Date;
  @ApiPropertyOptional() @o() @date() endDate?: Date;
  @ApiProperty({ description: 'Gross monthly salary' }) @money() baseSalary!: number;
  @ApiPropertyOptional() @o() @IsNumber() @Min(1) @Max(80) hoursPerWeek?: number;
  @ApiPropertyOptional() @o() @date() probationEnd?: Date;
  @ApiPropertyOptional() @o() @Matches(/^(https?:\/\/|\/)[^\s]+$/) documentUrl?: string;
}

export class ClockDto { @ApiPropertyOptional() @o() @IsString() @MaxLength(200) note?: string }
export class AttendanceManualDto {
  @ApiProperty() @IsString() employeeId!: string;
  @ApiProperty({ example: '2026-10-05' }) @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  @ApiPropertyOptional({ example: '09:00' }) @o() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) checkIn?: string;
  @ApiPropertyOptional({ example: '18:00' }) @o() @Matches(/^([01]\d|2[0-3]):[0-5]\d$/) checkOut?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(480) breakMinutes?: number;
  @ApiPropertyOptional({ enum: ['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY'] }) @o() @IsIn(['PRESENT', 'LATE', 'ABSENT', 'LEAVE', 'HOLIDAY']) status?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) note?: string;
}
export class ListAttendanceDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() employeeId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @ApiPropertyOptional() @o() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
export class PeriodDto {
  @ApiProperty({ example: '2026-10' }) @Matches(PERIOD, { message: 'periodKey must be YYYY-MM' }) periodKey!: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
}

export class CreateLeaveDto {
  @ApiPropertyOptional({ description: 'Defaults to you. Requesting for someone else needs hr:create' }) @o() @IsString() employeeId?: string;
  @ApiProperty() @IsString() leaveTypeId!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @ApiProperty() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(300) reason?: string;
}
export class DecideLeaveDto { @ApiPropertyOptional() @o() @IsString() @MaxLength(300) note?: string }
export class ListLeaveDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() employeeId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] }) @o() @IsIn(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED']) status?: string;
}
export class CreateLeaveTypeDto {
  @ApiProperty() @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,19}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @o() @IsBoolean() isPaid?: boolean;
  @ApiPropertyOptional({ description: 'Yearly allowance in days; empty = no limit' }) @o() @IsNumber() @Min(0) @Max(365) annualDays?: number;
  @ApiPropertyOptional() @o() @IsBoolean() requiresApproval?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateLeaveTypeDto extends PartialType(CreateLeaveTypeDto) {}

export class CommissionRuleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional({ enum: ['ALL', 'CATEGORY', 'BRAND', 'PRODUCT_TYPE'] }) @o() @IsIn(['ALL', 'CATEGORY', 'BRAND', 'PRODUCT_TYPE']) scope?: string;
  @ApiPropertyOptional() @o() @IsString() categoryId?: string;
  @ApiPropertyOptional() @o() @IsString() brandId?: string;
  @ApiPropertyOptional({ enum: ['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'] }) @o() @IsIn(['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY']) productType?: string;
  @ApiPropertyOptional({ enum: ['PERCENT', 'FIXED'] }) @o() @IsIn(['PERCENT', 'FIXED']) rateType?: string;
  @ApiProperty({ description: 'Percent of the sale, or a fixed amount per unit' }) @money() value!: number;
  @ApiPropertyOptional({ description: 'Only sales (of the matching items) at or above this amount earn commission' }) @o() @money() minSale?: number;
  @ApiPropertyOptional() @o() @date() startsAt?: Date;
  @ApiPropertyOptional() @o() @date() endsAt?: Date;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateCommissionRuleDto extends PartialType(CommissionRuleDto) {}
export class ListCommissionsDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() employeeId?: string;
  @ApiPropertyOptional() @o() @IsString() orderId?: string;
  @ApiPropertyOptional() @o() @Matches(PERIOD) periodKey?: string;
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'PAID', 'VOID'] }) @o() @IsIn(['PENDING', 'APPROVED', 'PAID', 'VOID']) status?: string;
}

export class AdjustPayslipDto {
  @ApiProperty({ enum: ['BONUS', 'DEDUCTION', 'OVERTIME'] }) @IsIn(['BONUS', 'DEDUCTION', 'OVERTIME']) kind!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) label!: string;
  @ApiProperty() @money() amount!: number;
}
export class ListRunsDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'APPROVED', 'PAID'] }) @o() @IsIn(['DRAFT', 'APPROVED', 'PAID']) status?: string;
}
