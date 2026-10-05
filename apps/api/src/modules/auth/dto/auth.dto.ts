import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@mizmar.local' }) @IsEmail() email!: string;
  @ApiProperty() @IsString() @MinLength(8) password!: string;
}

export class RefreshDto {
  @ApiProperty() @IsString() @MinLength(10) refreshToken!: string;
}

export class ForgotPasswordDto {
  @ApiProperty() @IsEmail() email!: string;
}

export class ResetPasswordDto {
  @ApiProperty() @IsString() @MinLength(10) token!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) password!: string;
}
