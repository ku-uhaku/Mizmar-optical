import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const PHONE = /^\+?[0-9 ().-]{6,20}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['PENDING', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export class CreateAppointmentTypeDto {
  @ApiProperty({ example: 'EYE_EXAM' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{1,29}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) description?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(10) @Max(480) durationMin?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(120) bufferMin?: number;
  @ApiPropertyOptional() @o() @Min(0) @Max(100000) price?: number;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(20) color?: string;
  @ApiPropertyOptional() @o() @IsBoolean() bookableOnline?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateAppointmentTypeDto extends PartialType(CreateAppointmentTypeDto) {}

export class SlotsQueryDto {
  @ApiProperty() @IsString() typeId!: string;
  @ApiProperty() @IsString() storeId!: string;
  @ApiProperty({ example: '2026-10-12' }) @Matches(DAY) from!: string;
  @ApiPropertyOptional({ example: '2026-10-18', description: 'Defaults to 7 days from `from` (max 31)' }) @o() @Matches(DAY) to?: string;
  @ApiPropertyOptional() @o() @IsString() practitionerId?: string;
}
export class PractitionersQueryDto { @ApiProperty() @IsString() storeId!: string }

export class GuestDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @Matches(PHONE) phone!: string;
}
export class BookDto {
  @ApiProperty() @IsString() typeId!: string;
  @ApiProperty() @IsString() storeId!: string;
  @ApiProperty({ description: 'A start time returned by /slots' }) @Type(() => Date) @IsDate() startsAt!: Date;
  @ApiPropertyOptional({ description: 'Omit to let the store pick whoever is free' }) @o() @IsString() practitionerId?: string;
  @ApiPropertyOptional({ type: GuestDto, description: 'Required when not signed in' }) @o() @ValidateNested() @Type(() => GuestDto) guest?: GuestDto;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
}
export class StaffBookDto {
  @ApiProperty() @IsString() typeId!: string;
  @ApiProperty() @IsString() storeId!: string;
  @ApiProperty() @Type(() => Date) @IsDate() startsAt!: Date;
  @ApiPropertyOptional() @o() @IsString() practitionerId?: string;
  @ApiPropertyOptional() @o() @IsString() customerId?: string;
  @ApiPropertyOptional({ type: GuestDto }) @o() @ValidateNested() @Type(() => GuestDto) guest?: GuestDto;
  @ApiPropertyOptional({ enum: ['STAFF', 'PHONE'] }) @o() @IsIn(['STAFF', 'PHONE']) source?: 'STAFF' | 'PHONE';
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
}
export class UpdateAppointmentDto {
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() startsAt?: Date;
  @ApiPropertyOptional() @o() @IsString() practitionerId?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) reason?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
}
export class AppointmentStatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) to!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(300) reason?: string;
  @ApiPropertyOptional({ description: 'On COMPLETED: the prescription issued at this visit' }) @o() @IsString() resultPrescriptionId?: string;
}
export class ListAppointmentsDto extends PaginationDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() practitionerId?: string;
  @ApiPropertyOptional() @o() @IsString() customerId?: string;
  @ApiPropertyOptional({ enum: STATUSES }) @o() @IsIn(STATUSES) status?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() to?: Date;
}
export class CalendarQueryDto {
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @IsString() practitionerId?: string;
  @ApiProperty() @Type(() => Date) @IsDate() from!: Date;
  @ApiProperty({ description: 'At most 35 days after `from`' }) @Type(() => Date) @IsDate() to!: Date;
}
export class LookupDto {
  @ApiProperty() @IsString() @MaxLength(40) number!: string;
  @ApiProperty({ description: 'The email or phone used to book' }) @IsString() @MaxLength(160) contact!: string;
}

export class RuleDto {
  @ApiProperty({ description: '0 = Sunday … 6 = Saturday' }) @IsInt() @Min(0) @Max(6) weekday!: number;
  @ApiProperty({ example: '09:00' }) @Matches(HHMM) startTime!: string;
  @ApiProperty({ example: '12:30' }) @Matches(HHMM) endTime!: string;
}
export class SetAvailabilityDto {
  @ApiProperty() @IsString() storeId!: string;
  @ApiProperty({ type: [RuleDto], description: 'The complete weekly schedule for this store: replaces what was there' }) @IsArray() @ArrayMaxSize(40) @ValidateNested({ each: true }) @Type(() => RuleDto) rules!: RuleDto[];
}
export class TimeOffDto {
  @ApiProperty() @Type(() => Date) @IsDate() startsAt!: Date;
  @ApiProperty() @Type(() => Date) @IsDate() endsAt!: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) reason?: string;
}
