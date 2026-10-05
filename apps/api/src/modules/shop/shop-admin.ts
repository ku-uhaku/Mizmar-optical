import { Body, Controller, Get, HttpCode, Injectable, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsDate, IsIn, IsInt, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import { Permissions } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { paginate } from '../../common/utils/paginate';
import { PrismaService } from '../../prisma/prisma.service';

const o = () => IsOptional();
const money = () => (t: object, k: string) => { IsNumber({ maxDecimalPlaces: 2 })(t, k); Min(0)(t, k); Max(9_999_999)(t, k); };

// ------------------------------------------------------------------ coupons
export class CreateCouponDto {
  @ApiProperty({ example: 'BIENVENUE10' }) @IsString() @Matches(/^[A-Z0-9][A-Z0-9_-]{2,29}$/, { message: 'code: 3-30 characters, A-Z, 0-9, _ or -' }) code!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(200) description?: string;
  @ApiProperty({ enum: ['PERCENT', 'FIXED', 'FREE_SHIPPING'] }) @IsIn(['PERCENT', 'FIXED', 'FREE_SHIPPING']) type!: string;
  @ApiPropertyOptional({ description: 'Percent (0-100) or amount' }) @o() @money() value?: number;
  @ApiPropertyOptional() @o() @money() minSubtotal?: number;
  @ApiPropertyOptional() @o() @money() maxDiscount?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(1) usageLimit?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(1) perCustomerLimit?: number;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() startsAt?: Date;
  @ApiPropertyOptional() @o() @Type(() => Date) @IsDate() endsAt?: Date;
  @ApiPropertyOptional({ description: '{ categoryIds, brandIds, productIds }' }) @o() @IsObject() appliesTo?: Record<string, string[]>;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateCouponDto extends PartialType(CreateCouponDto) {}

@Injectable()
export class CouponsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: 'coupon', label: 'Coupon', search: ['code', 'description'], sortable: ['code', 'createdAt', 'usedCount'], defaultSort: 'createdAt', unique: ['code'], filters: ['isActive', 'type'],
      inUse: async (p, id) => ((await p.db.couponRedemption.count({ where: { couponId: id } })) ? 'This coupon was used: deactivate it instead' : null),
    });
  }
}
export const CouponsController = createCrudController({ path: 'coupons', tag: 'shop', module: 'coupons', service: CouponsService, create: CreateCouponDto, update: UpdateCouponDto });

// ------------------------------------------------------------------ shipping methods
export class CreateShippingMethodDto {
  @ApiProperty() @IsString() @Matches(/^[a-z0-9][a-z0-9_-]{1,29}$/, { message: 'code: lowercase letters, digits, - or _' }) code!: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @ApiPropertyOptional() @o() @IsString() @MaxLength(300) description?: string;
  @ApiPropertyOptional() @o() @money() price?: number;
  @ApiPropertyOptional({ description: 'Free when the discounted cart reaches this amount' }) @o() @money() freeOverAmount?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(60) estimatedDaysMin?: number;
  @ApiPropertyOptional() @o() @IsInt() @Min(0) @Max(60) estimatedDaysMax?: number;
  @ApiPropertyOptional({ type: [String], description: 'Cities served; empty = everywhere' }) @o() @IsArray() @ArrayMaxSize(200) @IsString({ each: true }) zones?: string[];
  @ApiPropertyOptional() @o() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @o() @IsBoolean() isActive?: boolean;
}
export class UpdateShippingMethodDto extends PartialType(CreateShippingMethodDto) {}

@Injectable()
export class ShippingMethodsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, {
      model: 'shippingMethod', label: 'Shipping method', search: ['name', 'code'], sortable: ['sortOrder', 'name', 'price'], defaultSort: 'sortOrder', unique: ['code'], filters: ['isActive'],
      inUse: async (p, id) => ((await p.db.order.count({ where: { shippingMethodId: id } })) ? 'Orders used this method: deactivate it instead' : null),
    });
  }
}
export const ShippingMethodsController = createCrudController({ path: 'shipping-methods', tag: 'shop', module: 'shipping', service: ShippingMethodsService, create: CreateShippingMethodDto, update: UpdateShippingMethodDto });

// ------------------------------------------------------------------ moderation inbox: reviews and contact messages
export class ListReviewsDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) @o() @IsIn(['PENDING', 'APPROVED', 'REJECTED']) status?: string;
}
export class ListMessagesDto extends PaginationDto {
  @ApiPropertyOptional({ enum: ['NEW', 'READ', 'REPLIED', 'SPAM'] }) @o() @IsIn(['NEW', 'READ', 'REPLIED', 'SPAM']) status?: string;
}
export class MessageStatusDto { @ApiProperty({ enum: ['NEW', 'READ', 'REPLIED', 'SPAM'] }) @IsIn(['NEW', 'READ', 'REPLIED', 'SPAM']) status!: string }

@ApiTags('shop') @ApiBearerAuth()
@Controller()
export class ModerationController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('reviews') @Permissions('cms:read')
  reviews(@Query() q: ListReviewsDto) { return paginate(this.prisma.db.review, q, { where: q.status ? { status: q.status } : {}, include: { product: { select: { name: true, slug: true } } }, sortable: ['createdAt', 'rating'] }); }

  @Post('reviews/:id/:decision') @HttpCode(200) @Permissions('cms:publish')
  async decide(@Param('id') id: string, @Param('decision') decision: string) {
    const status = decision === 'approve' ? 'APPROVED' : 'REJECTED';
    return this.prisma.raw.review.update({ where: { id }, data: { status } });
  }

  @Get('contact-messages') @Permissions('cms:read')
  messages(@Query() q: ListMessagesDto) { return paginate(this.prisma.db.contactMessage, q, { where: q.status ? { status: q.status } : {}, sortable: ['createdAt'] }); }

  @Post('contact-messages/:id/status') @HttpCode(200) @Permissions('cms:update')
  setStatus(@Param('id') id: string, @Body() dto: MessageStatusDto) { return this.prisma.raw.contactMessage.update({ where: { id }, data: { status: dto.status as 'NEW', ...(dto.status === 'REPLIED' && { repliedAt: new Date() }) } }); }
}
