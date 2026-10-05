import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { CreateStoreDto, ListStoresDto, UpdateStoreDto } from './dto/store.dto';
import { StoresService } from './stores.service';

@ApiTags('stores')
@Controller('stores')
export class StoresController {
  constructor(private readonly stores: StoresService) {}

  @Get() @ApiBearerAuth() @Permissions('stores:read')
  list(@Query() q: ListStoresDto, @CurrentUser() u: AuthUser) { return this.stores.list(q, u); }

  @Get(':id') @ApiBearerAuth() @Permissions('stores:read')
  get(@Param('id') id: string) { return this.stores.get(id); }

  @Post() @ApiBearerAuth() @Permissions('stores:create')
  create(@Body() dto: CreateStoreDto) { return this.stores.create(dto); }

  @Patch(':id') @ApiBearerAuth() @Permissions('stores:update')
  update(@Param('id') id: string, @Body() dto: UpdateStoreDto) { return this.stores.update(id, dto); }

  @Delete(':id') @HttpCode(204) @ApiBearerAuth() @Permissions('stores:delete')
  remove(@Param('id') id: string) { return this.stores.remove(id); }
}
