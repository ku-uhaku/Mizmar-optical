import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsDate, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { CustomerSource, Gender, PrescriptionSource } from '../../generated/prisma/client';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const vals = <T extends object>(e: T) => Object.values(e) as string[];
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));
const trim = () => Transform(({ value }) => (typeof value === 'string' ? value.trim() : value));
/** Moroccan-friendly but international: digits, spaces, +, -, () — 6 to 20 chars. */
const PHONE = /^\+?[0-9 ()\-.]{6,20}$/;

export class CreateCustomerDto {
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @ApiProperty() @trim() @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @ApiPropertyOptional() @o() @trim() @IsEmail() email?: string;
  @ApiPropertyOptional() @o() @trim() @Matches(PHONE, { message: 'phone is not a valid number' }) phone?: string;
  @ApiPropertyOptional() @o() @trim() @Matches(PHONE, { message: 'whatsapp is not a valid number' }) whatsapp?: string;
  @ApiPropertyOptional({ enum: vals(Gender) }) @o() @IsIn(vals(Gender)) gender?: string;
  @ApiPropertyOptional({ example: '1985-03-21' }) @o() @Type(() => Date) @IsDate() dateOfBirth?: Date;
  @ApiPropertyOptional() @o() @trim() @IsString() @MaxLength(30) nationalId?: string;
  @ApiPropertyOptional() @o() @IsString() preferredStoreId?: string;
  @ApiPropertyOptional({ enum: vals(CustomerSource) }) @o() @IsIn(vals(CustomerSource)) source?: string;
  @ApiPropertyOptional() @o() @IsBoolean() marketingOptIn?: boolean;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ description: 'Create even if a customer with the same phone/email exists' }) @o() @IsBoolean() allowDuplicate?: boolean;
}
export class UpdateCustomerDto extends PartialType(CreateCustomerDto) {}

export class ListCustomersDto extends PaginationDto {
  @ApiPropertyOptional({ enum: vals(Gender) }) @o() @IsIn(vals(Gender)) gender?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() marketingOptIn?: boolean;
}

export class AddressDto {
  @ApiPropertyOptional() @o() @IsString() label?: string;
  @ApiPropertyOptional() @o() @IsString() recipient?: string;
  @ApiPropertyOptional() @o() @Matches(PHONE) phone?: string;
  @ApiProperty() @IsString() @MinLength(2) line1!: string;
  @ApiPropertyOptional() @o() @IsString() line2?: string;
  @ApiProperty() @IsString() @MinLength(2) city!: string;
  @ApiPropertyOptional() @o() @IsString() region?: string;
  @ApiPropertyOptional() @o() @IsString() postalCode?: string;
  @ApiPropertyOptional({ default: 'MA' }) @o() @Matches(/^[A-Z]{2}$/) country?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isDefaultShipping?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isDefaultBilling?: boolean;
}
export class UpdateAddressDto extends PartialType(AddressDto) {}

export class NoteDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(2000) body!: string;
  @ApiPropertyOptional() @o() @IsBoolean() isPinned?: boolean;
}
export class UpdateNoteDto extends PartialType(NoteDto) {}

export class InsuranceDto {
  @ApiProperty() @IsString() providerId!: string;
  @ApiPropertyOptional() @o() @IsString() policyNumber?: string;
  @ApiPropertyOptional() @o() @IsString() memberId?: string;
  @ApiPropertyOptional({ description: 'Percent covered, 0-100' }) @o() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) coveragePct?: number;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() validFrom?: Date;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() validTo?: Date;
  @ApiPropertyOptional() @o() @IsString() notes?: string;
}
export class UpdateInsuranceDto extends PartialType(InsuranceDto) {}

export class CreateInsuranceProviderDto {
  @ApiProperty() @IsString() @MinLength(1) name!: string;
  @ApiPropertyOptional() @o() @IsString() code?: string;
  @ApiPropertyOptional() @o() @IsString() phone?: string;
  @ApiPropertyOptional() @o() @IsEmail() email?: string;
  @ApiPropertyOptional() @o() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) defaultCoveragePct?: number;
  @ApiPropertyOptional() @o() @IsString() notes?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateInsuranceProviderDto extends PartialType(CreateInsuranceProviderDto) {}

// ---------------------------------------------------------------- prescriptions
const diopter = (min: number, max: number) => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(min)(t, k); Max(max)(t, k); };

export class PrescriptionDto {
  @ApiPropertyOptional({ enum: vals(PrescriptionSource) }) @o() @IsIn(vals(PrescriptionSource)) source?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(120) prescriberName?: string;
  @ApiProperty({ example: '2026-06-15' }) @Type(() => Date) @IsDate() issuedAt!: Date;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() expiresAt?: Date;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;

  // OD = right eye
  @ApiPropertyOptional({ description: 'Sphere (dioptres), -20..+20 in 0.25 steps' }) @o() @diopter(-20, 20) odSph?: number;
  @ApiPropertyOptional() @o() @diopter(-10, 10) odCyl?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(180) odAxis?: number;
  @ApiPropertyOptional({ description: 'Near addition, 0..+4' }) @o() @diopter(0, 4) odAdd?: number;
  @ApiPropertyOptional({ description: 'Monocular PD in mm' }) @o() @IsNumber({ maxDecimalPlaces: 1 }) @Min(20) @Max(45) odPd?: number;
  @ApiPropertyOptional() @o() @diopter(0, 10) odPrism?: number;
  @ApiPropertyOptional() @o() @IsIn(['UP', 'DOWN', 'IN', 'OUT']) odBase?: string;
  // OS = left eye
  @ApiPropertyOptional() @o() @diopter(-20, 20) osSph?: number;
  @ApiPropertyOptional() @o() @diopter(-10, 10) osCyl?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(180) osAxis?: number;
  @ApiPropertyOptional() @o() @diopter(0, 4) osAdd?: number;
  @ApiPropertyOptional() @o() @IsNumber({ maxDecimalPlaces: 1 }) @Min(20) @Max(45) osPd?: number;
  @ApiPropertyOptional() @o() @diopter(0, 10) osPrism?: number;
  @ApiPropertyOptional() @o() @IsIn(['UP', 'DOWN', 'IN', 'OUT']) osBase?: string;

  @ApiPropertyOptional({ description: 'Binocular PD in mm' }) @o() @IsNumber({ maxDecimalPlaces: 1 }) @Min(40) @Max(80) pdTotal?: number;
  @ApiPropertyOptional({ description: 'Uploaded scan (see POST /media?folder=prescriptions)' }) @o() @Matches(/^(https?:\/\/|\/)[^\s]+$/) attachmentUrl?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(2000) notes?: string;
  @ApiPropertyOptional({ description: 'Mark this the current prescription and deactivate the others (default true)' }) @o() @IsBoolean() makeCurrent?: boolean;
}
export class UpdatePrescriptionDto extends PartialType(PrescriptionDto) {
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
