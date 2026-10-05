import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import * as D from './inventory.dto';
import { InventoryService } from './inventory.service';

@ApiTags('inventory') @ApiBearerAuth()
@Controller()
export class InventoryController {
  constructor(private readonly inv: InventoryService) {}

  // warehouses
  @Get('warehouses') @Permissions('inventory:read') warehouses(@CurrentUser() u: AuthUser) { return this.inv.listWarehouses(u); }
  @Post('warehouses') @Permissions('stores:create') createWarehouse(@Body() dto: D.CreateWarehouseDto) { return this.inv.createWarehouse(dto); }
  @Patch('warehouses/:id') @Permissions('stores:update') updateWarehouse(@Param('id') id: string, @Body() dto: D.UpdateWarehouseDto) { return this.inv.updateWarehouse(id, dto); }
  @Delete('warehouses/:id') @HttpCode(204) @Permissions('stores:delete') removeWarehouse(@Param('id') id: string) { return this.inv.removeWarehouse(id); }

  // stock views
  @Get('inventory/stock') @Permissions('inventory:read') stock(@Query() q: D.StockQueryDto, @CurrentUser() u: AuthUser) { return this.inv.stockList(q, u); }
  @Get('inventory/summary') @Permissions('inventory:read') summary(@Query() q: D.StoreFilterDto, @CurrentUser() u: AuthUser) { return this.inv.summary(u, q.storeId); }
  @Patch('inventory/stock/:id') @Permissions('inventory:adjust') level(@Param('id') id: string, @Body() dto: D.UpdateStockLevelDto, @CurrentUser() u: AuthUser) { return this.inv.updateLevel(id, dto, u); }
  @Get('inventory/movements') @Permissions('inventory:read') movements(@Query() q: D.MovementQueryDto, @CurrentUser() u: AuthUser) { return this.inv.movements(q, u); }

  // adjustments
  @Get('inventory/adjustments') @Permissions('inventory:read') adjustments(@Query() q: D.ListDocsDto, @CurrentUser() u: AuthUser) { return this.inv.listAdjustments(q, u); }
  @Get('inventory/adjustments/:id') @Permissions('inventory:read') adjustment(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.getAdjustment(id, u); }
  @Post('inventory/adjustments') @Permissions('inventory:adjust') createAdjustment(@Body() dto: D.CreateAdjustmentDto, @CurrentUser() u: AuthUser) { return this.inv.createAdjustment(dto, u); }

  // transfers
  @Get('inventory/transfers') @Permissions('inventory:read') transfers(@Query() q: D.ListDocsDto, @CurrentUser() u: AuthUser) { return this.inv.listTransfers(q, u); }
  @Get('inventory/transfers/:id') @Permissions('inventory:read') transfer(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.getTransfer(id, u); }
  @Post('inventory/transfers') @Permissions('inventory:transfer') createTransfer(@Body() dto: D.CreateTransferDto, @CurrentUser() u: AuthUser) { return this.inv.createTransfer(dto, u); }
  @Post('inventory/transfers/:id/ship') @HttpCode(200) @Permissions('inventory:transfer') ship(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.shipTransfer(id, u); }
  @Post('inventory/transfers/:id/receive') @HttpCode(200) @Permissions('inventory:transfer') receive(@Param('id') id: string, @Body() dto: D.ReceiveTransferDto, @CurrentUser() u: AuthUser) { return this.inv.receiveTransfer(id, dto, u); }
  @Post('inventory/transfers/:id/cancel') @HttpCode(200) @Permissions('inventory:transfer') cancelTransfer(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.cancelTransfer(id, u); }

  // counts
  @Get('inventory/counts') @Permissions('inventory:read') counts(@Query() q: D.ListDocsDto, @CurrentUser() u: AuthUser) { return this.inv.listCounts(q, u); }
  @Get('inventory/counts/:id') @Permissions('inventory:read') count(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.getCount(id, u); }
  @Post('inventory/counts') @Permissions('inventory:count') createCount(@Body() dto: D.CreateCountDto, @CurrentUser() u: AuthUser) { return this.inv.createCount(dto, u); }
  @Put('inventory/counts/:id/lines') @Permissions('inventory:count') saveLines(@Param('id') id: string, @Body() dto: D.SaveCountLinesDto, @CurrentUser() u: AuthUser) { return this.inv.saveCountLines(id, dto, u); }
  @Post('inventory/counts/:id/complete') @HttpCode(200) @Permissions('inventory:count') complete(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.completeCount(id, u); }
  @Post('inventory/counts/:id/cancel') @HttpCode(200) @Permissions('inventory:count') cancelCount(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.inv.cancelCount(id, u); }
}
