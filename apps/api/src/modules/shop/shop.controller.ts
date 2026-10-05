import { Body, CallHandler, Controller, ExecutionContext, Injectable, NestInterceptor, Delete, Get, Header, HttpCode, Param, Patch, Post, Put, Query, Req, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { memoryStorage } from 'multer';
import { AllowCustomer, CurrentUser, CustomerOnly, OptionalAuth, Permissions, Public, RequiresModule, SkipAudit } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { MAX_UPLOAD_BYTES } from '../media/media.service';
import { AccountService } from './account.service';
import { FulfillmentService } from './fulfillment.service';
import { ShopCatalogService } from './shop-catalog.service';
import { ShopCheckoutService } from './shop-checkout.service';
import { ShopContentService } from './content.service';
import * as D from './shop.dto';

const Cached = () => Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');
const NoStore = () => Header('Cache-Control', 'no-store');

/** Personal data must never be cached by a browser or proxy. */
@Injectable()
class NoStoreInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler) { ctx.switchToHttp().getResponse().setHeader('Cache-Control', 'no-store'); return next.handle(); }
}

/** Public storefront API: catalog, cart pricing, checkout, tracking, content. Nothing here needs an account (checkout may use one). */
@ApiTags('shop')
@Public() @RequiresModule('storefront')
@Controller('public')
export class ShopController {
  constructor(private readonly catalog: ShopCatalogService, private readonly checkout: ShopCheckoutService, private readonly content: ShopContentService, private readonly account: AccountService) {}

  @Cached() @Get('products') products(@Query() q: D.ListShopProductsDto) { return this.catalog.list(q); }
  @Cached() @Get('facets') facets() { return this.catalog.facets(); }
  @Cached() @Get('products/:slug') product(@Param('slug') slug: string) { return this.catalog.get(slug); }
  @Cached() @Get('lens-options') lensOptions() { return this.catalog.lensOptions(); }
  @Cached() @Get('payment-methods') paymentMethods() { return this.checkout.paymentMethods(); }
  @Cached() @Get('shipping-methods') shippingMethods() { return this.checkout.shippingMethods(); }

  @RequiresModule('blog') @Cached() @Get('blog') blog(@Query() q: D.ListBlogDto) { return this.content.blog(q); }
  @RequiresModule('blog') @Cached() @Get('blog-categories') blogCategories() { return this.content.blogCategories(); }
  @RequiresModule('blog') @Cached() @Get('blog/:slug') blogPost(@Param('slug') slug: string) { return this.content.blogPost(slug); }
  @Post('contact') @HttpCode(201) contact(@Body() dto: D.ContactMessageDto) { return this.content.contact(dto); }
  @Post('newsletter') @HttpCode(201) newsletter(@Body() dto: D.NewsletterDto) { return this.content.subscribe(dto); }

  @Post('auth/register') @HttpCode(201) @SkipAudit() register(@Body() dto: D.RegisterDto, @Req() req: Request) { return this.account.register(dto, { ip: req.ip, userAgent: req.header('user-agent') }); }

  @OptionalAuth() @AllowCustomer() @NoStore() @Post('cart/quote') @HttpCode(200)
  quote(@Body() dto: D.QuoteDto, @CurrentUser() u?: AuthUser) { return this.checkout.quote(dto, u ?? null); }

  @OptionalAuth() @AllowCustomer() @NoStore() @Post('checkout') @HttpCode(201)
  place(@Body() dto: D.CheckoutDto, @CurrentUser() u?: AuthUser) { return this.checkout.place(dto, u ?? null); }

  @NoStore() @Post('orders/track') @HttpCode(200) track(@Body() dto: D.TrackDto) { return this.checkout.track(dto); }
}

/** The signed-in customer's own data. Staff tokens are refused (CustomerOnly); customer tokens are refused on every other route. */
@ApiTags('account') @ApiBearerAuth()
@CustomerOnly() @RequiresModule('storefront') @UseInterceptors(NoStoreInterceptor)
@Controller('account')
export class AccountController {
  constructor(private readonly svc: AccountService) {}

  @Get('profile') profile(@CurrentUser() u: AuthUser) { return this.svc.profile(u); }
  @Patch('profile') update(@CurrentUser() u: AuthUser, @Body() dto: D.UpdateProfileDto) { return this.svc.updateProfile(u, dto); }
  @Post('password') @HttpCode(204) @SkipAudit() password(@CurrentUser() u: AuthUser, @Body() dto: D.ChangePasswordDto) { return this.svc.changePassword(u, dto); }

  @Get('addresses') addresses(@CurrentUser() u: AuthUser) { return this.svc.addresses(u); }
  @Post('addresses') addAddress(@CurrentUser() u: AuthUser, @Body() dto: D.AddressDto) { return this.svc.addAddress(u, dto); }
  @Patch('addresses/:id') updateAddress(@CurrentUser() u: AuthUser, @Param('id') id: string, @Body() dto: D.AddressDto) { return this.svc.updateAddress(u, id, dto); }
  @Delete('addresses/:id') @HttpCode(204) removeAddress(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removeAddress(u, id); }

  @Get('wishlist') wishlist(@CurrentUser() u: AuthUser) { return this.svc.wishlist(u); }
  @Get('wishlist/ids') wishlistIds(@CurrentUser() u: AuthUser) { return this.svc.wishlistIds(u); }
  @Put('wishlist/:productId') @HttpCode(204) addWishlist(@CurrentUser() u: AuthUser, @Param('productId') id: string) { return this.svc.addWishlist(u, id); }
  @Delete('wishlist/:productId') @HttpCode(204) removeWishlist(@CurrentUser() u: AuthUser, @Param('productId') id: string) { return this.svc.removeWishlist(u, id); }

  @Get('prescriptions') prescriptions(@CurrentUser() u: AuthUser) { return this.svc.prescriptions(u); }
  @Post('prescriptions') addPrescription(@CurrentUser() u: AuthUser, @Body() dto: D.SelfPrescriptionDto) { return this.svc.addPrescription(u, dto); }
  @Post('prescriptions/upload') @SkipAudit() @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_UPLOAD_BYTES, files: 1 } }))
  upload(@CurrentUser() u: AuthUser, @UploadedFile() file: Express.Multer.File | undefined) { return this.svc.upload(u, file); }
  @Delete('prescriptions/:id') @HttpCode(204) removePrescription(@CurrentUser() u: AuthUser, @Param('id') id: string) { return this.svc.removePrescription(u, id); }

  @Get('orders') orders(@CurrentUser() u: AuthUser) { return this.svc.myOrders(u); }
  @Get('orders/:number') order(@CurrentUser() u: AuthUser, @Param('number') n: string) { return this.svc.myOrder(u, n); }
  @Post('orders/:number/cancel') @HttpCode(200) cancel(@CurrentUser() u: AuthUser, @Param('number') n: string, @Body() dto: D.CancelOnlineOrderDto) { return this.svc.cancelOrder(u, n, dto); }

  @Post('reviews') @HttpCode(201) review(@CurrentUser() u: AuthUser, @Body() dto: D.ReviewDto) { return this.svc.review(u, dto); }
}

/** Staff handling of online orders (the order list itself is the normal /orders screen, filter channel=ONLINE). */
@ApiTags('shop') @ApiBearerAuth()
@Controller('orders')
export class FulfillmentController {
  constructor(private readonly svc: FulfillmentService) {}

  @Post(':id/confirm-payment') @HttpCode(200) @Permissions('orders:update') confirm(@Param('id') id: string, @Body() dto: D.ConfirmPaymentDto, @CurrentUser() u: AuthUser) { return this.svc.confirmPayment(id, dto, u); }
  @Post(':id/ship') @HttpCode(200) @Permissions('orders:update') ship(@Param('id') id: string, @Body() dto: D.ShipDto, @CurrentUser() u: AuthUser) { return this.svc.ship(id, dto, u); }
  @Post(':id/shipment-delivered') @HttpCode(200) @Permissions('orders:update') delivered(@Param('id') id: string, @Body() dto: D.DeliveredDto, @CurrentUser() u: AuthUser) { return this.svc.delivered(id, dto, u); }
  @Post(':id/ready-for-pickup') @HttpCode(200) @Permissions('orders:update') ready(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.readyForPickup(id, u); }
}
