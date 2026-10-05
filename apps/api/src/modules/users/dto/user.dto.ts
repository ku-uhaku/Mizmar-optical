import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsEmail, IsEnum, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { LOCALES } from '@mizmar/shared';
import { PaginationDto } from '../../../common/dto/pagination.dto';

export class CreateUserDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
  @ApiProperty() @IsString() @MinLength(1) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) lastName!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() phone?: string;
  @ApiPropertyOptional({ enum: LOCALES }) @IsOptional() @IsIn(LOCALES as unknown as string[]) locale?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INVITED', 'SUSPENDED'] }) @IsOptional() @IsEnum({ ACTIVE: 'ACTIVE', INVITED: 'INVITED', SUSPENDED: 'SUSPENDED' }) status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED';
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) roleIds?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayUnique() @IsString({ each: true }) storeIds?: string[];
}

export class UpdateUserDto extends PartialType(OmitType(CreateUserDto, ['email'] as const)) {
  @ApiPropertyOptional() @IsOptional() @IsEmail() email?: string;
}

export class ListUsersDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() roleId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() storeId?: string;
  @ApiPropertyOptional({ enum: ['ACTIVE', 'INVITED', 'SUSPENDED'] }) @IsOptional() @IsString() status?: string;
}
