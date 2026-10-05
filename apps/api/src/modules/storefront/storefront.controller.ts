import { Controller, Get, Header, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators';
import { StorefrontService } from './storefront.service';

const Cached = () => Header('Cache-Control', 'public, max-age=30, stale-while-revalidate=300');

/** Everything here is public and cacheable; the website revalidates it on its own schedule. */
@ApiTags('storefront')
@Public()
@Controller('public')
export class StorefrontController {
  constructor(private readonly s: StorefrontService) {}

  @Cached() @Get('branding') branding() { return this.s.branding(); }
  @Cached() @Get('menus/:code') menu(@Param('code') code: string) { return this.s.menu(code); }
  @Cached() @Get('home') home() { return this.s.home(); }
  @Cached() @Get('pages') footerPages() { return this.s.footerPages(); }
  @Cached() @Get('pages/:slug') page(@Param('slug') slug: string) { return this.s.page(slug); }
  @Cached() @Get('stores') stores() { return this.s.stores(); }
  @Cached() @Get('sitemap') sitemap() { return this.s.sitemap(); }
}
