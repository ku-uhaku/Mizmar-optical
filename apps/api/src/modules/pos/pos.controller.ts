import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { CashMovementDto, CloseSessionDto, DailyReportDto, HoldSaleDto, ListSessionsDto, OpenSessionDto } from './pos.dto';
import { PosService } from './pos.service';
import { SessionsService } from './sessions.service';

@ApiTags('pos') @ApiBearerAuth()
@Controller('pos')
export class PosController {
  constructor(private readonly pos: PosService, private readonly sessions: SessionsService) {}

  @Get('config') @Permissions('pos:access') config(@CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.pos.config(u, s); }
  @Get('lens-options') @Permissions('pos:access') lens() { return this.pos.lensOptions(); }

  // register sessions
  @Get('sessions/current') @Permissions('pos:access')
  async current(@CurrentUser() u: AuthUser, @CurrentStore() s: string | null) {
    const storeId = s ?? u.defaultStoreId;
    const session = storeId ? await this.sessions.currentFor(u, storeId) : null;
    return session ? { session, report: await this.sessions.report(session.id, u) } : { session: null, report: null };
  }
  @Get('sessions') @Permissions('pos:manage_register') list(@Query() q: ListSessionsDto, @CurrentUser() u: AuthUser) { return this.sessions.list(q, u); }
  @Post('sessions') @Permissions('pos:manage_register') open(@Body() dto: OpenSessionDto, @CurrentUser() u: AuthUser) { return this.sessions.open(dto, u); }
  @Get('sessions/:id/report') @Permissions('pos:access') report(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.sessions.report(id, u); }
  @Post('sessions/:id/movements') @Permissions('pos:manage_register') movement(@Param('id') id: string, @Body() dto: CashMovementDto, @CurrentUser() u: AuthUser) { return this.sessions.movement(id, dto, u); }
  @Post('sessions/:id/close') @HttpCode(200) @Permissions('pos:manage_register') close(@Param('id') id: string, @Body() dto: CloseSessionDto, @CurrentUser() u: AuthUser) { return this.sessions.close(id, dto, u); }
  @Get('reports/daily') @Permissions('pos:manage_register') daily(@Query() q: DailyReportDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.sessions.daily(q.storeId, q.date, u, s); }

  // parked sales
  @Get('held') @Permissions('pos:access') held(@CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.pos.listHeld(u, s); }
  @Post('held') @Permissions('pos:access') hold(@Body() dto: HoldSaleDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.pos.hold(dto, u, s); }
  @Delete('held/:id') @HttpCode(204) @Permissions('pos:access') drop(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.pos.dropHeld(id, u); }
}
