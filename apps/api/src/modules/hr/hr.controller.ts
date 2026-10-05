import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import { CurrentUser, Permissions } from '../../common/decorators';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { DocumentsService } from '../documents/documents.service';
import { DocumentQueryDto } from '../sales/sales.dto';
import { HrService } from './hr.service';
import { CommissionsService, PayrollService } from './payroll.service';
import * as D from './hr.dto';

class PayDto { @IsOptional() @IsString() bankAccountId?: string }

@Injectable()
export class LeaveTypesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'leaveType', label: 'Leave type', search: ['name', 'code'], sortable: ['name', 'code'], defaultSort: 'name', unique: ['code'], filters: ['isActive'], inUse: async (p, id) => ((await p.db.leaveRequest.count({ where: { leaveTypeId: id } })) ? 'Leave requests use this type: deactivate it instead' : null) });
  }
}
@Injectable()
export class CommissionRulesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'commissionRule', label: 'Commission rule', search: ['name'], sortable: ['name', 'createdAt'], defaultSort: 'createdAt', filters: ['isActive'], inUse: async (p, id) => ((await p.db.commissionEntry.count({ where: { ruleId: id } })) ? 'Commissions were earned with this rule: deactivate it instead' : null) });
  }
}
export const LeaveTypesController = createCrudController({ path: 'leave-types', tag: 'hr', module: 'hr', service: LeaveTypesService, create: D.CreateLeaveTypeDto, update: D.UpdateLeaveTypeDto });
export const CommissionRulesController = createCrudController({ path: 'commission-rules', tag: 'hr', module: 'hr', service: CommissionRulesService, create: D.CommissionRuleDto, update: D.UpdateCommissionRuleDto });

@ApiTags('hr') @ApiBearerAuth()
@Controller()
export class HrController {
  constructor(private readonly hr: HrService, private readonly comm: CommissionsService, private readonly payroll: PayrollService, private readonly docs: DocumentsService) {}

  // ---- employees
  @Get('employees') @Permissions('hr:read') list(@Query() q: D.ListEmployeesDto, @CurrentUser() u: AuthUser) { return this.hr.list(q, u); }
  @Post('employees') @Permissions('hr:create') create(@Body() dto: D.CreateEmployeeDto, @CurrentUser() u: AuthUser) { return this.hr.create(dto, u); }
  @Get('employees/:id') @Permissions('hr:read') get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.hr.get(id, u); }
  @Patch('employees/:id') @Permissions('hr:update') update(@Param('id') id: string, @Body() dto: D.UpdateEmployeeDto, @CurrentUser() u: AuthUser) { return this.hr.update(id, dto, u); }
  @Delete('employees/:id') @HttpCode(204) @Permissions('hr:delete') remove(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.hr.remove(id, u); }
  @Post('employees/:id/contracts') @Permissions('hr:payroll') contract(@Param('id') id: string, @Body() dto: D.ContractDto, @CurrentUser() u: AuthUser) { return this.hr.addContract(id, dto, u); }
  @Get('employees/:id/leave-balances') @Permissions('hr:read') balances(@Param('id') id: string, @Query('year') year: string | undefined, @CurrentUser() u: AuthUser) { return this.hr.balances(id, u, Number(year) || undefined); }

  // ---- self-service (any signed-in staff member linked to an employee record)
  @Get('hr/me') me(@CurrentUser() u: AuthUser) { return this.hr.me(u); }
  @Get('hr/me/today') today(@CurrentUser() u: AuthUser) { return this.hr.today(u); }
  @Get('hr/me/leave') myLeave(@CurrentUser() u: AuthUser) { return this.hr.myLeave(u); }
  @Get('hr/me/leave-balances') async myBalances(@Query('year') year: string | undefined, @CurrentUser() u: AuthUser) { return this.hr.balances((await this.hr.me(u)).id, u, Number(year) || undefined); }
  @Post('hr/clock/in') @HttpCode(200) clockIn(@Body() dto: D.ClockDto, @CurrentUser() u: AuthUser) { return this.hr.clock(u, 'in', dto.note); }
  @Post('hr/clock/out') @HttpCode(200) clockOut(@Body() dto: D.ClockDto, @CurrentUser() u: AuthUser) { return this.hr.clock(u, 'out', dto.note); }

  // ---- attendance
  @Get('attendance') @Permissions('hr:read') attendance(@Query() q: D.ListAttendanceDto, @CurrentUser() u: AuthUser) { return this.hr.listAttendance(q, u); }
  @Get('attendance/summary') @Permissions('hr:read') summary(@Query() q: D.PeriodDto, @CurrentUser() u: AuthUser) { return this.hr.attendanceSummary(q, u); }
  @Post('attendance') @Permissions('hr:update') manual(@Body() dto: D.AttendanceManualDto, @CurrentUser() u: AuthUser) { return this.hr.manual(dto, u); }

  // ---- leave
  @Get('leave-requests') @Permissions('hr:read') leave(@Query() q: D.ListLeaveDto, @CurrentUser() u: AuthUser) { return this.hr.listLeave(q, u); }
  @Post('leave-requests') request(@Body() dto: D.CreateLeaveDto, @CurrentUser() u: AuthUser) { return this.hr.requestLeave(dto, u); }
  @Post('leave-requests/:id/approve') @HttpCode(200) @Permissions('hr:update') approve(@Param('id') id: string, @Body() dto: D.DecideLeaveDto, @CurrentUser() u: AuthUser) { return this.hr.decide(id, true, dto, u); }
  @Post('leave-requests/:id/reject') @HttpCode(200) @Permissions('hr:update') reject(@Param('id') id: string, @Body() dto: D.DecideLeaveDto, @CurrentUser() u: AuthUser) { return this.hr.decide(id, false, dto, u); }
  @Post('leave-requests/:id/cancel') @HttpCode(200) cancel(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.hr.cancelLeave(id, u); }

  // ---- commissions
  @Get('commissions') @Permissions('hr:payroll') commissions(@Query() q: D.ListCommissionsDto, @CurrentUser() u: AuthUser) { return this.comm.list(q, u); }
  @Post('commissions/calculate') @HttpCode(200) @Permissions('hr:payroll') calculate(@Body() dto: D.PeriodDto) { return this.comm.calculate(dto.periodKey); }
  @Post('commissions/approve') @HttpCode(200) @Permissions('hr:payroll') approveAll(@Body() dto: D.PeriodDto) { return this.comm.approve(dto.periodKey); }
  @Post('commissions/:id/void') @HttpCode(200) @Permissions('hr:payroll') voidOne(@Param('id') id: string) { return this.comm.void(id); }

  // ---- payroll
  @Get('payroll/runs') @Permissions('hr:payroll') runs(@Query() q: D.ListRunsDto, @CurrentUser() u: AuthUser) { return this.payroll.list(q, u); }
  @Post('payroll/runs') @Permissions('hr:payroll') createRun(@Body() dto: D.PeriodDto, @CurrentUser() u: AuthUser) { return this.payroll.create(dto, u); }
  @Get('payroll/runs/:id') @Permissions('hr:payroll') run(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payroll.get(id, u); }
  @Delete('payroll/runs/:id') @HttpCode(204) @Permissions('hr:payroll') removeRun(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payroll.remove(id, u); }
  @Post('payroll/runs/:id/payslips/:pid/adjust') @HttpCode(200) @Permissions('hr:payroll') adjust(@Param('id') id: string, @Param('pid') pid: string, @Body() dto: D.AdjustPayslipDto, @CurrentUser() u: AuthUser) { return this.payroll.adjust(id, pid, dto, u); }
  @Delete('payroll/runs/:id/payslips/:pid/adjustments/:lid') @Permissions('hr:payroll') removeAdjust(@Param('id') id: string, @Param('pid') pid: string, @Param('lid') lid: string, @CurrentUser() u: AuthUser) { return this.payroll.removeAdjustment(id, pid, lid, u); }
  @Post('payroll/runs/:id/approve') @HttpCode(200) @Permissions('hr:payroll') approveRun(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.payroll.approve(id, u); }
  @Post('payroll/runs/:id/pay') @HttpCode(200) @Permissions('hr:payroll') payRun(@Param('id') id: string, @Body() dto: PayDto, @CurrentUser() u: AuthUser) { return this.payroll.pay(id, dto.bankAccountId, u); }
  @Get('payslips/:id/document') @Permissions('hr:payroll') payslipDoc(@Param('id') id: string, @Query() q: DocumentQueryDto, @CurrentUser() u: AuthUser) { return this.docs.payslip(id, u, (q.locale ?? 'fr') as 'fr' | 'en' | 'ar'); }
}
