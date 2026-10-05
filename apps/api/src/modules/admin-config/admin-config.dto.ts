import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { SAFE_URL } from './sanitize';

const o = () => IsOptional();
const url = () => Matches(SAFE_URL, { message: 'must be a same-site path or an http(s) URL' });
const date = () => (t: object, k: string) => { Type(() => Date)(t, k); IsDate()(t, k); };
const str = (max: number) => (t: object, k: string) => { IsString()(t, k); MaxLength(max)(t, k); };

// ------------------------------------------------------------------ localization
export class LanguageDto {
  @ApiProperty() @Matches(/^[a-z]{2,3}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) nativeName!: string;
  @ApiPropertyOptional() @o() @IsBoolean() isRtl?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
}
export class UpdateLanguageDto extends PartialType(LanguageDto) {}
export class CurrencyDto {
  @ApiProperty() @Matches(/^[A-Z]{3}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(8) symbol!: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(4) decimals?: number;
  @ApiPropertyOptional({ description: 'Relative to the default currency' }) @o() @IsNumber({ maxDecimalPlaces: 6 }) @Min(0.000001) @Max(1_000_000) exchangeRate?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateCurrencyDto extends PartialType(CurrencyDto) {}
export class TaxRateDto {
  @ApiProperty() @Matches(/^[a-z0-9][a-z0-9_-]{1,29}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) name!: string;
  @ApiProperty({ description: 'Percent, 0-100' }) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) rate!: number;
  @ApiPropertyOptional({ description: 'Shelf prices already include this tax' }) @o() @IsBoolean() isInclusive?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isDefault?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateTaxRateDto extends PartialType(TaxRateDto) {}

// ------------------------------------------------------------------ messaging, payments, documents
export class EmailTemplateDto {
  @ApiProperty() @Matches(/^[a-z][a-z0-9_]{1,39}$/) code!: string;
  @ApiProperty({ enum: ['fr', 'en', 'ar'] }) @IsIn(['fr', 'en', 'ar']) locale!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) subject!: string;
  @ApiProperty({ description: 'HTML with {{variables}}' }) @IsString() @MinLength(1) @MaxLength(50_000) body!: string;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateEmailTemplateDto extends PartialType(EmailTemplateDto) {}
export class SmsTemplateDto {
  @ApiProperty() @Matches(/^[a-z][a-z0-9_]{1,39}$/) code!: string;
  @ApiProperty({ enum: ['fr', 'en', 'ar'] }) @IsIn(['fr', 'en', 'ar']) locale!: string;
  @ApiPropertyOptional({ enum: ['SMS', 'WHATSAPP'] }) @o() @IsIn(['SMS', 'WHATSAPP']) channel?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) body!: string;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateSmsTemplateDto extends PartialType(SmsTemplateDto) {}
export class PaymentMethodDto {
  @ApiProperty() @Matches(/^[a-z0-9][a-z0-9_-]{1,29}$/) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiProperty({ enum: ['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CASH_ON_DELIVERY', 'ONLINE_PROVIDER', 'INSURANCE', 'STORE_CREDIT', 'OTHER'] }) @IsIn(['CASH', 'CARD', 'BANK_TRANSFER', 'CHEQUE', 'CASH_ON_DELIVERY', 'ONLINE_PROVIDER', 'INSURANCE', 'STORE_CREDIT', 'OTHER']) type!: string;
  @ApiPropertyOptional({ description: 'Gateway id for online payments (e.g. demo). Secrets never go here: use environment variables.' }) @o() @Matches(/^[a-z0-9_-]{1,30}$/) provider?: string;
  @ApiPropertyOptional() @o() @IsObject() config?: Record<string, unknown>;
  @ApiPropertyOptional() @o() @IsBoolean() availableOnline?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() availableInPos?: boolean;
  @ApiPropertyOptional({ description: 'Gateway fee in percent' }) @o() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(100) feePct?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdatePaymentMethodDto extends PartialType(PaymentMethodDto) {}
export class DocumentTemplateDto {
  @ApiProperty({ enum: ['RECEIPT', 'INVOICE', 'QUOTE', 'PURCHASE_ORDER', 'JOB_ORDER', 'PAYSLIP'] }) @IsIn(['RECEIPT', 'INVOICE', 'QUOTE', 'PURCHASE_ORDER', 'JOB_ORDER', 'PAYSLIP']) type!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional({ description: 'Empty = every store' }) @o() @IsString() storeId?: string;
  @ApiProperty({ description: 'A full HTML document using {{variables}}, {{#if}} and {{#each}}' }) @IsString() @MinLength(10) @MaxLength(100_000) html!: string;
  @ApiPropertyOptional({ enum: ['A4', 'A5', 'THERMAL_80', 'THERMAL_58'] }) @o() @IsIn(['A4', 'A5', 'THERMAL_80', 'THERMAL_58']) paperSize?: string;
  @ApiPropertyOptional() @o() @IsBoolean() isDefault?: boolean;
}
export class UpdateDocumentTemplateDto extends PartialType(DocumentTemplateDto) {}
export class PreviewTemplateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100_000) html!: string;
  @ApiProperty({ enum: ['RECEIPT', 'INVOICE', 'QUOTE', 'PURCHASE_ORDER', 'JOB_ORDER', 'PAYSLIP'] }) @IsIn(['RECEIPT', 'INVOICE', 'QUOTE', 'PURCHASE_ORDER', 'JOB_ORDER', 'PAYSLIP']) type!: string;
  @ApiPropertyOptional({ enum: ['fr', 'en', 'ar'] }) @o() @IsIn(['fr', 'en', 'ar']) locale?: string;
}
export class SequenceDto {
  @ApiPropertyOptional() @o() @Matches(/^[A-Za-z0-9-]{1,20}$/) prefix?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(1) @Max(10) padding?: number;
  @ApiPropertyOptional({ enum: ['NEVER', 'YEARLY', 'MONTHLY'] }) @o() @IsIn(['NEVER', 'YEARLY', 'MONTHLY']) reset?: string;
}

// ------------------------------------------------------------------ website content
export class BrandingDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) storeName!: string;
  @ApiPropertyOptional() @o() @str(160) tagline?: string;
  @ApiPropertyOptional() @o() @url() logoUrl?: string;
  @ApiPropertyOptional() @o() @url() logoDarkUrl?: string;
  @ApiPropertyOptional() @o() @url() faviconUrl?: string;
  @ApiPropertyOptional({ description: '{ light: { primary, secondary, accent, background, foreground }, dark: {…} } as #hex' }) @o() @IsObject() colors?: { light?: Record<string, string>; dark?: Record<string, string> };
  @ApiPropertyOptional({ description: '{ heading, body } Google Fonts family names' }) @o() @IsObject() fonts?: { heading?: string; body?: string };
  @ApiPropertyOptional() @o() @IsObject() social?: Record<string, string>;
  @ApiPropertyOptional() @o() @IsObject() contact?: { phone?: string; email?: string; address?: string };
  @ApiPropertyOptional({ description: 'Company legal details printed on invoices: legalName, ice, rc, if, patente, cnss' }) @o() @IsObject() legal?: Record<string, string>;
}

export class BannerDto {
  @ApiProperty({ enum: ['HOME_HERO', 'HOME_SECONDARY', 'CATALOG_TOP', 'CHECKOUT', 'POPUP'] }) @IsIn(['HOME_HERO', 'HOME_SECONDARY', 'CATALOG_TOP', 'CHECKOUT', 'POPUP']) placement!: string;
  @ApiPropertyOptional() @o() @str(150) title?: string;
  @ApiPropertyOptional() @o() @str(300) subtitle?: string;
  @ApiProperty() @url() imageUrl!: string;
  @ApiPropertyOptional() @o() @url() mobileImageUrl?: string;
  @ApiPropertyOptional() @o() @url() linkUrl?: string;
  @ApiPropertyOptional() @o() @str(40) ctaLabel?: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional() @o() @date() startsAt?: Date;
  @ApiPropertyOptional() @o() @date() endsAt?: Date;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateBannerDto extends PartialType(BannerDto) {}
export class TestimonialDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) authorName!: string;
  @ApiPropertyOptional() @o() @str(80) authorTitle?: string;
  @ApiPropertyOptional() @o() @url() avatarUrl?: string;
  @ApiProperty() @IsString() @MinLength(3) @MaxLength(1000) content!: string;
  @ApiPropertyOptional() @o() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateTestimonialDto extends PartialType(TestimonialDto) {}
export class CmsPageDto {
  @ApiPropertyOptional({ description: 'Generated from the title when omitted' }) @o() @Matches(/^[a-z0-9][a-z0-9-]{0,78}$/) slug?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) title!: string;
  @ApiProperty({ description: 'Rich text: cleaned on save' }) @IsString() @MaxLength(200_000) content!: string;
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) @o() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']) status?: string;
  @ApiPropertyOptional() @o() @IsBoolean() showInFooter?: boolean;
  @ApiPropertyOptional() @o() @str(150) seoTitle?: string;
  @ApiPropertyOptional() @o() @str(300) seoDescription?: string;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateCmsPageDto extends PartialType(CmsPageDto) {}
export class BlogCategoryDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) name!: string;
  @ApiPropertyOptional() @o() @Matches(/^[a-z0-9][a-z0-9-]{0,78}$/) slug?: string;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateBlogCategoryDto extends PartialType(BlogCategoryDto) {}
export class BlogPostDto {
  @ApiPropertyOptional() @o() @IsString() categoryId?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) title!: string;
  @ApiPropertyOptional() @o() @Matches(/^[a-z0-9][a-z0-9-]{0,78}$/) slug?: string;
  @ApiPropertyOptional() @o() @str(400) excerpt?: string;
  @ApiProperty() @IsString() @MaxLength(200_000) content!: string;
  @ApiPropertyOptional() @o() @url() coverUrl?: string;
  @ApiPropertyOptional({ type: [String] }) @o() @IsArray() @ArrayMaxSize(20) @IsString({ each: true }) tags?: string[];
  @ApiPropertyOptional({ enum: ['DRAFT', 'PUBLISHED', 'ARCHIVED'] }) @o() @IsIn(['DRAFT', 'PUBLISHED', 'ARCHIVED']) status?: string;
  @ApiPropertyOptional() @o() @str(150) seoTitle?: string;
  @ApiPropertyOptional() @o() @str(300) seoDescription?: string;
  @ApiPropertyOptional({ description: 'Schedule a future date; defaults to now when published' }) @o() @date() publishedAt?: Date;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateBlogPostDto extends PartialType(BlogPostDto) {}
export const SECTION_TYPES = ['HERO_BANNER', 'BANNER_GRID', 'FEATURED_PRODUCTS', 'NEW_ARRIVALS', 'BRANDS', 'CATEGORIES', 'PROMO', 'TESTIMONIALS', 'STORES', 'BLOG_LATEST', 'RICH_TEXT', 'NEWSLETTER'];
export class HomeSectionDto {
  @ApiProperty({ enum: SECTION_TYPES }) @IsIn(SECTION_TYPES) type!: string;
  @ApiPropertyOptional() @o() @str(150) title?: string;
  @ApiPropertyOptional() @o() @str(300) subtitle?: string;
  @ApiPropertyOptional({ description: 'Per-type settings: limit (1-24), couponCode, html' }) @o() @IsObject() config?: Record<string, unknown>;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @date() startsAt?: Date;
  @ApiPropertyOptional() @o() @date() endsAt?: Date;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateHomeSectionDto extends PartialType(HomeSectionDto) {}
export class ReorderDto { @ApiProperty({ type: [String] }) @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) ids!: string[] }

export class MenuItemDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) label!: string;
  @ApiPropertyOptional() @o() @url() url?: string;
  @ApiPropertyOptional() @o() @IsBoolean() openInNewTab?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
  @ApiPropertyOptional({ type: () => [MenuItemDto] }) @o() @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MenuItemDto) children?: MenuItemDto[];
}
export class SetMenuDto {
  @ApiPropertyOptional() @o() @str(80) name?: string;
  @ApiProperty({ type: [MenuItemDto], description: 'The whole menu, in order: replaces what was there' }) @IsArray() @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => MenuItemDto) items!: MenuItemDto[];
}

// ------------------------------------------------------------------ modules and custom fields
export class ModuleDto { @ApiProperty() @IsBoolean() isEnabled!: boolean }
export const CF_ENTITIES = ['CUSTOMER', 'PRODUCT', 'PRODUCT_VARIANT', 'ORDER', 'PRESCRIPTION', 'JOB_ORDER', 'SUPPLIER', 'EMPLOYEE', 'APPOINTMENT'];
export const CF_TYPES = ['TEXT', 'TEXTAREA', 'NUMBER', 'DECIMAL', 'BOOLEAN', 'DATE', 'SELECT', 'MULTI_SELECT'];
export class CustomFieldDto {
  @ApiProperty({ enum: CF_ENTITIES }) @IsIn(CF_ENTITIES) entity!: string;
  @ApiProperty({ description: 'Stable machine name' }) @Matches(/^[a-z][a-z0-9_]{1,39}$/) key!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(80) label!: string;
  @ApiProperty({ enum: CF_TYPES }) @IsIn(CF_TYPES) type!: string;
  @ApiPropertyOptional({ type: [String], description: 'Choices for SELECT / MULTI_SELECT' }) @o() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) options?: string[];
  @ApiPropertyOptional() @o() @IsBoolean() isRequired?: boolean;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(999) sortOrder?: number;
  @ApiPropertyOptional() @o() @IsObject() translations?: Record<string, Record<string, string>>;
}
export class UpdateCustomFieldDto extends PartialType(CustomFieldDto) {}
export class SetCustomValuesDto { @ApiProperty({ description: '{ key: value }' }) @IsObject() values!: Record<string, unknown> }
