import { Module } from '@nestjs/common';
import { BankAccountsController, BankAccountsService, ExpenseCategoriesController, ExpenseCategoriesService, FinanceController } from './finance.controller';
import { FinanceReportsService } from './finance-reports.service';
import { FinanceService } from './finance.service';

@Module({
  controllers: [ExpenseCategoriesController, BankAccountsController, FinanceController],
  providers: [FinanceService, FinanceReportsService, ExpenseCategoriesService, BankAccountsService],
  exports: [FinanceReportsService],
})
export class FinanceModule {}
