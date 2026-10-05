import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { DocumentsService } from '../documents/documents.service';
import { DocumentQueryDto } from '../sales/sales.dto';
import { StoreFilterDto } from '../purchasing/purchasing.dto';
import { WorkshopService } from './workshop.service';
import * as D from './workshop.dto';

@ApiTags('workshop') @ApiBearerAuth()
@Controller('jobs')
export class WorkshopController {
  constructor(private readonly svc: WorkshopService, private readonly docs: DocumentsService) {}

  @Get() @Permissions('workshop:read') list(@Query() q: D.ListJobsDto, @CurrentUser() u: AuthUser) { return this.svc.list(q, u); }
  @Get('summary') @Permissions('workshop:read') summary(@Query() q: StoreFilterDto, @CurrentUser() u: AuthUser) { return this.svc.summary(u, q.storeId); }
  @Post() @Permissions('workshop:create') create(@Body() dto: D.CreateJobDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.svc.create(dto, u, s); }
  @Get(':id') @Permissions('workshop:read') get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.get(id, u); }
  @Patch(':id') @Permissions('workshop:update') update(@Param('id') id: string, @Body() dto: D.UpdateJobDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u); }
  @Post(':id/assign') @HttpCode(200) @Permissions('workshop:update') assign(@Param('id') id: string, @Body() dto: D.AssignDto, @CurrentUser() u: AuthUser) { return this.svc.assign(id, dto, u); }
  @Post(':id/status') @HttpCode(200) @Permissions('workshop:update') status(@Param('id') id: string, @Body() dto: D.JobStatusDto, @CurrentUser() u: AuthUser) { return this.svc.status(id, dto, u); }
  @Post(':id/resume') @HttpCode(200) @Permissions('workshop:update') resume(@Param('id') id: string, @Body() dto: D.NoteDto, @CurrentUser() u: AuthUser) { return this.svc.resume(id, dto, u); }
  @Post(':id/quality-check') @HttpCode(200) @Permissions('workshop:quality_check') qc(@Param('id') id: string, @Body() dto: D.QualityCheckDto, @CurrentUser() u: AuthUser) { return this.svc.qualityCheck(id, dto, u); }
  @Post(':id/deliver') @HttpCode(200) @Permissions('workshop:update') deliver(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.deliver(id, u); }
  @Post(':id/notify') @HttpCode(200) @Permissions('workshop:update') notify(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.notify(id, u); }

  @Post(':id/tasks') @Permissions('workshop:update') addTask(@Param('id') id: string, @Body() dto: D.TaskDto, @CurrentUser() u: AuthUser) { return this.svc.addTask(id, dto, u); }
  @Patch(':id/tasks/:taskId') @Permissions('workshop:update') setTask(@Param('id') id: string, @Param('taskId') t: string, @Body() dto: D.TaskStatusDto, @CurrentUser() u: AuthUser) { return this.svc.setTask(id, t, dto, u); }
  @Delete(':id/tasks/:taskId') @Permissions('workshop:update') removeTask(@Param('id') id: string, @Param('taskId') t: string, @CurrentUser() u: AuthUser) { return this.svc.removeTask(id, t, u); }

  @Post(':id/lens-orders') @Permissions('workshop:update') addLab(@Param('id') id: string, @Body() dto: D.CreateLabOrderDto, @CurrentUser() u: AuthUser) { return this.svc.addLabOrder(id, dto, u); }
  @Patch(':id/lens-orders/:labId') @Permissions('workshop:update') setLab(@Param('id') id: string, @Param('labId') l: string, @Body() dto: D.LabOrderStatusDto, @CurrentUser() u: AuthUser) { return this.svc.setLabOrder(id, l, dto, u); }

  @Get(':id/document') @Permissions('workshop:read') document(@Param('id') id: string, @Query() q: DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.jobTicket(id, u, (q.locale ?? 'fr') as 'fr' | 'en' | 'ar'); }
}
