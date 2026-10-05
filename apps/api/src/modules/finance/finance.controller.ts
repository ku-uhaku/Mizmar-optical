import { Body, Controller, Delete, Get, HttpCode, Injectable, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import { createCrudController } from '../../common/crud/crud.controller';
import { SimpleCrudService } from '../../common/crud/simple-crud.service';
import type { AuthUser } from '../../common/types';
import { PrismaService } from '../../prisma/prisma.service';
import { FinanceService } from './finance.service';
import { FinanceReportsService } from './finance-reports.service';
import * as D from './finance.dto';

@Injectable()
export class ExpenseCategoriesService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'expenseCategory', label: 'Expense category', search: ['name', 'code'], sortable: ['name', 'code'], defaultSort: 'name', unique: ['code'], filters: ['isActive', 'parentId'], inUse: async (p, id) => ((await p.db.expense.count({ where: { categoryId: id } })) ? 'Expenses use this category: deactivate it instead' : null) });
  }
}
@Injectable()
export class BankAccountsService extends SimpleCrudService {
  constructor(prisma: PrismaService) {
    super(prisma, { model: 'bankAccount', label: 'Account', search: ['name', 'bankName'], sortable: ['name'], defaultSort: 'name', filters: ['isActive'], inUse: async (p, id) => ((await p.db.cashFlowEntry.count({ where: { bankAccountId: id } })) ? 'Movements are recorded on this account: deactivate it instead' : null) });
  }
}
export const ExpenseCategoriesController = createCrudController({ path: 'expense-categories', tag: 'finance', module: 'finance', service: ExpenseCategoriesService, create: D.CreateExpenseCategoryDto, update: D.UpdateExpenseCategoryDto });
export const BankAccountsController = createCrudController({ path: 'bank-accounts', tag: 'finance', module: 'finance', service: BankAccountsService, create: D.CreateBankAccountDto, update: D.UpdateBankAccountDto });

@ApiTags('finance') @ApiBearerAuth()
@Controller()
export class FinanceController {
  constructor(private readonly svc: FinanceService, private readonly rep: FinanceReportsService) {}

  @Get('expenses') @Permissions('finance:read') list(@Query() q: D.ListExpensesDto, @CurrentUser() u: AuthUser) { return this.svc.list(q, u); }
  @Get('expenses/summary') @Permissions('finance:read') summary(@Query() q: D.RangeDto, @CurrentUser() u: AuthUser) { return this.svc.expenseSummary(q, u); }
  @Post('expenses') @Permissions('finance:create') create(@Body() dto: D.CreateExpenseDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.svc.create(dto, u, s); }
  @Get('expenses/:id') @Permissions('finance:read') get(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.get(id, u); }
  @Patch('expenses/:id') @Permissions('finance:update') update(@Param('id') id: string, @Body() dto: D.UpdateExpenseDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u); }
  @Delete('expenses/:id') @HttpCode(204) @Permissions('finance:update') remove(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.remove(id, u); }
  @Post('expenses/:id/approve') @HttpCode(200) @Permissions('finance:approve') approve(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.decide(id, true, u); }
  @Post('expenses/:id/reject') @HttpCode(200) @Permissions('finance:approve') reject(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.decide(id, false, u); }
  @Post('expenses/:id/pay') @HttpCode(200) @Permissions('finance:approve') pay(@Param('id') id: string, @Body() dto: D.PayExpenseDto, @CurrentUser() u: AuthUser) { return this.svc.pay(id, dto, u); }

  @Get('finance/summary') @Permissions('finance:read') headline(@Query('storeId') storeId: string | undefined, @CurrentUser() u: AuthUser) { return this.rep.summary(u, storeId); }
  @Get('finance/cash-flow') @Permissions('finance:read') cashFlow(@Query() q: D.RangeDto, @CurrentUser() u: AuthUser) { return this.rep.cashFlow(q, u); }
  @Post('finance/cash-entries') @Permissions('finance:create') addCash(@Body() dto: D.ManualCashDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.svc.addCash(dto, u, s); }
  @Delete('finance/cash-entries/:id') @HttpCode(204) @Permissions('finance:update') removeCash(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.removeCash(id, u); }
  @Get('finance/balances') @Permissions('finance:read') balances(@CurrentUser() u: AuthUser) { return this.svc.accountBalances(u); }
  @Get('finance/vat') @Permissions('finance:read') vat(@Query() q: D.RangeDto, @CurrentUser() u: AuthUser) { return this.rep.vat(q, u); }
  @Get('finance/payments') @Permissions('payments:read') payments(@Query() q: D.ListPaymentsDto, @CurrentUser() u: AuthUser) { return this.rep.payments(q, u); }
  @Get('finance/payments/by-method') @Permissions('payments:read') byMethod(@Query() q: D.RangeDto, @CurrentUser() u: AuthUser) { return this.rep.paymentsByMethod(q, u); }
  @Get('credit-notes') @Permissions('finance:read') creditNotes(@Query() q: D.ListCreditNotesDto, @CurrentUser() u: AuthUser) { return this.rep.creditNotes(q, u); }
}
