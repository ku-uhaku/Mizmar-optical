import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsIn, IsOptional, IsString, Matches, MinLength } from 'class-validator';
import { ALL_PERMISSIONS } from '@mizmar/shared';

export class CreateRoleDto {
  @ApiProperty({ example: 'senior_optician' }) @IsString() @Matches(/^[a-z][a-z0-9_]{1,40}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(2) name!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() description?: string;
  @ApiProperty({ type: [String], example: ['products:read', 'pos:access'] })
  @IsArray() @ArrayUnique() @IsIn(ALL_PERMISSIONS, { each: true }) permissionKeys!: string[];
}

export class UpdateRoleDto extends PartialType(CreateRoleDto) {}
