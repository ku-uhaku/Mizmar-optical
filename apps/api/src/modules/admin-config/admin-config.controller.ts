import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { AdminConfigService } from './admin-config.service';
import { ModuleToggleService } from './modules-toggle.service';
import * as D from './admin-config.dto';

@ApiTags('settings') @ApiBearerAuth()
@Controller()
export class AdminConfigController {
  constructor(private readonly svc: AdminConfigService, private readonly modules: ModuleToggleService) {}

  @Get('branding') @Permissions('settings:read') branding() { return this.svc.branding(); }
  @Put('branding') @Permissions('settings:update') setBranding(@Body() dto: D.BrandingDto) { return this.svc.setBranding(dto); }

  @Get('menus') @Permissions('cms:read') menus() { return this.svc.menus(); }
  @Put('menus/:code') @Permissions('cms:update') setMenu(@Param('code') code: string, @Body() dto: D.SetMenuDto) { return this.svc.setMenu(code, dto); }
  @Post('home-sections/reorder') @HttpCode(200) @Permissions('cms:update') reorderSections(@Body() dto: D.ReorderDto) { return this.svc.reorder('homeSection', dto.ids); }
  @Post('banners/reorder') @HttpCode(200) @Permissions('cms:update') reorderBanners(@Body() dto: D.ReorderDto) { return this.svc.reorder('banner', dto.ids); }

  /** Every signed-in user may ask which modules are on (the dashboard hides the rest); changing them needs settings:update. */
  @Get('modules') list() { return this.modules.list(); }
  @Put('modules/:key') @Permissions('settings:update') setModule(@Param('key') key: string, @Body() dto: D.ModuleDto) { return this.modules.set(key, dto.isEnabled); }

  @Post('document-templates/preview') @HttpCode(200) @Permissions('config:read') preview(@Body() dto: D.PreviewTemplateDto) { return this.svc.preview(dto); }
  @Get('document-sequences') @Permissions('config:read') sequences(@Query('storeId') storeId?: string) { return this.svc.sequences(storeId); }
  @Patch('document-sequences/:id') @Permissions('config:update') setSequence(@Param('id') id: string, @Body() dto: D.SequenceDto) { return this.svc.setSequence(id, dto); }

  @Get('custom-fields/:entity/:id') customValues(@Param('entity') entity: string, @Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.customValues(entity, id, u); }
  @Put('custom-fields/:entity/:id') setCustomValues(@Param('entity') entity: string, @Param('id') id: string, @Body() dto: D.SetCustomValuesDto, @CurrentUser() u: AuthUser) { return this.svc.setCustomValues(entity, id, dto, u); }
}
