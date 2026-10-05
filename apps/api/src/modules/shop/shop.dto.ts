import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { PrescriptionDto } from '../customers/customers.dto';

const o = () => IsOptional();
const bool = () => Transform(({ value }) => (value === 'true' ? true : value === 'false' ? false : value));
const PHONE = /^\+?[0-9 ().-]{6,20}$/;

// ------------------------------------------------------------------ accounts
export class RegisterDto {
  @ApiProperty() @IsEmail() @MaxLength(160) email!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(100) password!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) lastName!: string;
  @ApiPropertyOptional() @o() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
  @ApiPropertyOptional() @o() @IsBoolean() marketingOptIn?: boolean;
}
export class UpdateProfileDto {
  @ApiPropertyOptional() @o() @IsString() @MinLength(1) @MaxLength(60) firstName?: string;
  @ApiPropertyOptional() @o() @IsString() @MinLength(1) @MaxLength(60) lastName?: string;
  @ApiPropertyOptional() @o() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
  @ApiPropertyOptional() @o() @IsBoolean() marketingOptIn?: boolean;
}
export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(8) currentPassword!: string;
  @ApiProperty({ minLength: 8 }) @IsString() @MinLength(8) @MaxLength(100) newPassword!: string;
}
export class AddressDto {
  @ApiPropertyOptional() @o() @IsString() @MaxLength(40) label?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) recipient!: string;
  @ApiProperty() @Matches(PHONE) phone!: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(200) line1!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) line2?: string;
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(80) city!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(80) region?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(20) postalCode?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isDefaultShipping?: boolean;
}
export class SelfPrescriptionDto extends PrescriptionDto {}
export class ReviewDto {
  @ApiProperty() @IsString() productId!: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating!: number;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(120) title?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(2000) body?: string;
}

// ------------------------------------------------------------------ catalog
export class ListShopProductsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY'] }) @o() @IsIn(['FRAME', 'SUNGLASSES', 'CONTACT_LENS', 'LENS', 'ACCESSORY']) type?: string;
  @ApiPropertyOptional({ description: 'Brand slug' }) @o() @IsString() brand?: string;
  @ApiPropertyOptional({ description: 'Category slug (includes sub-categories)' }) @o() @IsString() category?: string;
  @ApiPropertyOptional({ enum: ['MEN', 'WOMEN', 'UNISEX', 'KIDS'] }) @o() @IsString() gender?: string;
  @ApiPropertyOptional({ description: 'Shape slug' }) @o() @IsString() shape?: string;
  @ApiPropertyOptional({ description: 'Material slug' }) @o() @IsString() material?: string;
  @ApiPropertyOptional() @o() @IsString() color?: string;
  @ApiPropertyOptional() @o() @IsString() size?: string;
  @ApiPropertyOptional() @o() @Type(() => Number) @IsNumber() @Min(0) minPrice?: number;
  @ApiPropertyOptional() @o() @Type(() => Number) @IsNumber() @Min(0) maxPrice?: number;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() inStock?: boolean;
  @ApiPropertyOptional() @o() @bool() @IsBoolean() featured?: boolean;
  @ApiPropertyOptional({ enum: ['newest', 'price_asc', 'price_desc', 'name'] }) @o() @IsIn(['newest', 'price_asc', 'price_desc', 'name']) sort?: string;
}

// ------------------------------------------------------------------ cart / checkout
export class ShopLensDto {
  @ApiProperty() @IsString() lensTypeId!: string;
  @ApiPropertyOptional() @o() @IsString() lensEntryId?: string;
  @ApiPropertyOptional({ type: [String] }) @o() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) treatmentIds?: string[];
  @ApiPropertyOptional({ description: "One of the signed-in customer's saved prescriptions (typed or uploaded)" }) @o() @IsString() prescriptionId?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) notes?: string;
}
export class ShopLineDto {
  @ApiProperty() @IsString() variantId!: string;
  @ApiProperty() @IsInt() @Min(1) @Max(20) quantity!: number;
  @ApiPropertyOptional({ type: ShopLensDto }) @o() @ValidateNested() @Type(() => ShopLensDto) lens?: ShopLensDto;
}
export class QuoteDto {
  @ApiProperty({ type: [ShopLineDto] }) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => ShopLineDto) lines!: ShopLineDto[];
  @ApiPropertyOptional() @o() @IsString() @MaxLength(40) couponCode?: string;
  @ApiPropertyOptional({ enum: ['PICKUP', 'DELIVERY'] }) @o() @IsIn(['PICKUP', 'DELIVERY']) fulfillment?: 'PICKUP' | 'DELIVERY';
  @ApiPropertyOptional() @o() @IsString() shippingMethodId?: string;
  @ApiPropertyOptional({ description: 'Pickup store' }) @o() @IsString() storeId?: string;
  @ApiPropertyOptional({ description: 'Delivery city (zone check)' }) @o() @IsString() @MaxLength(80) city?: string;
}
export class ContactDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) firstName!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) lastName!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiProperty() @Matches(PHONE) phone!: string;
}
export class CheckoutDto extends QuoteDto {
  @ApiPropertyOptional({ type: ContactDto, description: 'Required for guests' }) @o() @ValidateNested() @Type(() => ContactDto) contact?: ContactDto;
  @ApiPropertyOptional({ type: AddressDto, description: 'Required for delivery' }) @o() @ValidateNested() @Type(() => AddressDto) address?: AddressDto;
  @ApiProperty({ description: 'PaymentMethodConfig.code, see GET /public/payment-methods' }) @IsString() paymentMethod!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(500) note?: string;
  @ApiPropertyOptional({ description: 'Unique per checkout attempt: retrying returns the original order' }) @o() @IsString() @MaxLength(64) clientRef?: string;
  @ApiPropertyOptional({ description: 'Locale for the confirmation message' }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
}
export class TrackDto {
  @ApiProperty() @IsString() @MaxLength(40) number!: string;
  @ApiProperty({ description: 'The email or phone used on the order' }) @IsString() @MaxLength(160) contact!: string;
}
export class CancelOnlineOrderDto { @ApiPropertyOptional() @o() @IsString() @MaxLength(300) reason?: string }

// ------------------------------------------------------------------ content
export class ContactMessageDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional() @o() @Matches(PHONE) phone?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(150) subject?: string;
  @ApiProperty() @IsString() @MinLength(5) @MaxLength(4000) message!: string;
  @ApiPropertyOptional({ description: 'Honeypot: real visitors leave this empty' }) @o() @IsString() @MaxLength(200) website?: string;
}
export class NewsletterDto {
  @ApiProperty() @IsEmail() email!: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
}
export class ListBlogDto extends PaginationDto {
  @ApiPropertyOptional({ description: 'Category slug' }) @o() @IsString() category?: string;
}

// ------------------------------------------------------------------ staff: online fulfilment
export class ConfirmPaymentDto {
  @ApiProperty() @IsString() methodId!: string;
  @ApiPropertyOptional({ description: 'Defaults to the full balance' }) @o() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount?: number;
  @ApiPropertyOptional({ description: 'Transfer reference, cheque number…' }) @o() @IsString() @MaxLength(100) reference?: string;
}
export class ShipDto {
  @ApiPropertyOptional() @o() @IsString() @MaxLength(60) carrier?: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(80) trackingNumber?: string;
  @ApiPropertyOptional() @o() @Matches(/^https?:\/\/[^\s]+$/) trackingUrl?: string;
}
export class DeliveredDto {
  @ApiPropertyOptional({ description: 'Cash on delivery: the courier collected the balance' }) @o() @IsBoolean() collected?: boolean;
}
