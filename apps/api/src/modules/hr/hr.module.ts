import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { SettingsModule } from '../settings/settings.module';
import { CommissionRulesController, CommissionRulesService, HrController, LeaveTypesController, LeaveTypesService } from './hr.controller';
import { HrService } from './hr.service';
import { CommissionsService, PayrollService } from './payroll.service';

@Module({
  imports: [SettingsModule, DocumentsModule],
  controllers: [LeaveTypesController, CommissionRulesController, HrController],
  providers: [HrService, CommissionsService, PayrollService, LeaveTypesService, CommissionRulesService],
  exports: [HrService],
})
export class HrModule {}
