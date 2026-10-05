import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsNumber, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

const o = () => IsOptional();
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));
const STATUSES = ['PENDING', 'LENSES_ORDERED', 'LENSES_RECEIVED', 'CUTTING_MOUNTING', 'QUALITY_CHECK', 'READY', 'DELIVERED', 'ON_HOLD', 'CANCELLED'];
const PRIORITIES = ['NORMAL', 'HIGH', 'URGENT'];

export class ListJobsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: STATUSES }) @o() @IsIn(STATUSES) status?: string;
  @ApiPropertyOptional({ description: 'Only jobs not yet ready or delivered' }) @o() @bool() @IsBoolean() active?: boolean;
  @ApiPropertyOptional() @o() @IsString() technicianId?: string;
  @ApiPropertyOptional() @o() @IsString() customerId?: string;
  @ApiPropertyOptional() @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ description: 'Past their promised date and not yet ready' }) @o() @bool() @IsBoolean() overdue?: boolean;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() mine?: boolean;
}

export class CreateJobDto {
  @ApiProperty() @IsString() customerId!: string;
  @ApiPropertyOptional({ description: 'The frame the customer brought' }) @o() @IsString() @MaxLength(200) frameDescription?: string;
  @ApiPropertyOptional() @o() @IsString() frameVariantId?: string;
  @ApiPropertyOptional() @o() @IsString() lensTypeId?: string;
  @ApiPropertyOptional() @o() @IsString() lensEntryId?: string;
  @ApiPropertyOptional() @o() @IsString() prescriptionId?: string;
  @ApiPropertyOptional({ type: [String] }) @o() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) treatmentIds?: string[];
  @ApiPropertyOptional() @o() @IsObject() fitting?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: PRIORITIES }) @o() @IsIn(PRIORITIES) priority?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() promisedAt?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
}

export class UpdateJobDto {
  @ApiPropertyOptional() @o() @IsObject() fitting?: Record<string, unknown>;
  @ApiPropertyOptional({ enum: PRIORITIES }) @o() @IsIn(PRIORITIES) priority?: string;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() promisedAt?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(1000) notes?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) frameDescription?: string;
}

export class JobStatusDto {
  @ApiProperty({ enum: STATUSES }) @IsIn(STATUSES) to!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) note?: string;
}
export class NoteDto { @ApiPropertyOptional() @o() @IsString() @MaxLength(500) note?: string }
export class AssignDto { @ApiProperty({ nullable: true, description: 'User id, or null to unassign' }) @IsOptional() @IsString() technicianId!: string | null }
export class QualityCheckDto {
  @ApiProperty() @IsBoolean() passed!: boolean;
  @ApiPropertyOptional({ description: 'Required when the check fails' }) @o() @IsString() @MaxLength(500) notes?: string;
}
export class TaskDto { @ApiProperty() @IsString() @MaxLength(100) name!: string }
export class TaskStatusDto { @ApiProperty({ enum: ['TODO', 'IN_PROGRESS', 'DONE'] }) @IsIn(['TODO', 'IN_PROGRESS', 'DONE']) status!: string }

export class CreateLabOrderDto {
  @ApiProperty() @IsString() supplierId!: string;
  @ApiPropertyOptional() @o() @IsString() lensEntryId?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(100) reference?: string;
  @ApiPropertyOptional() @o() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) cost?: number;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() expectedAt?: Date;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) notes?: string;
}
export class LabOrderStatusDto {
  @ApiProperty({ enum: ['ORDERED', 'RECEIVED', 'DEFECTIVE', 'CANCELLED'] }) @IsIn(['ORDERED', 'RECEIVED', 'DEFECTIVE', 'CANCELLED']) status!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) notes?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(100) reference?: string;
}
void ValidateNested;
