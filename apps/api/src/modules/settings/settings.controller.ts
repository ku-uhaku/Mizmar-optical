import { Body, Controller, Get, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, Permissions, Public } from '../../common/decorators';
import { BulkUpsertSettingsDto } from './dto/setting.dto';
import { SettingsService } from './settings.service';

@ApiTags('settings')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Public() @Get('public')
  publicSettings() { return this.settings.publicSettings(); }

  @Get() @ApiBearerAuth() @Permissions('settings:read')
  list(@Query('group') group: string | undefined, @CurrentStore() storeId: string | null) { return this.settings.list({ group, storeId }); }

  @Put() @ApiBearerAuth() @Permissions('settings:update')
  upsert(@Body() dto: BulkUpsertSettingsDto) { return this.settings.upsertMany(dto.items); }
}
