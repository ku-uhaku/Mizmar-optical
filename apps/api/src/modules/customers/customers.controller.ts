import { Body, Controller, Delete, Get, Header, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentStore, CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import * as D from './customers.dto';
import { CustomersService } from './customers.service';

@ApiTags('customers') @ApiBearerAuth()
@Controller()
export class CustomersController {
  constructor(private readonly svc: CustomersService) {}

  // customers
  @Get('customers') @Permissions('customers:read') list(@Query() q: D.ListCustomersDto) { return this.svc.list(q); }
  @Get('customers/export.csv') @Permissions('customers:export') @Header('Content-Type', 'text/csv; charset=utf-8') @Header('Content-Disposition', 'attachment; filename="customers.csv"') export() { return this.svc.exportCsv(); }
  @Get('customers/:id') @Permissions('customers:read') get(@Param('id') id: string) { return this.svc.get(id); }
  @Post('customers') @Permissions('customers:create') create(@Body() dto: D.CreateCustomerDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.svc.create(dto, u, s); }
  @Patch('customers/:id') @Permissions('customers:update') update(@Param('id') id: string, @Body() dto: D.UpdateCustomerDto, @CurrentUser() u: AuthUser) { return this.svc.update(id, dto, u); }
  @Delete('customers/:id') @HttpCode(204) @Permissions('customers:delete') remove(@Param('id') id: string) { return this.svc.remove(id); }

  // addresses / notes / insurance
  @Post('customers/:id/addresses') @Permissions('customers:update') addAddress(@Param('id') id: string, @Body() dto: D.AddressDto) { return this.svc.addAddress(id, dto); }
  @Patch('customers/addresses/:addressId') @Permissions('customers:update') updateAddress(@Param('addressId') id: string, @Body() dto: D.UpdateAddressDto) { return this.svc.updateAddress(id, dto); }
  @Delete('customers/addresses/:addressId') @HttpCode(204) @Permissions('customers:update') removeAddress(@Param('addressId') id: string) { return this.svc.removeAddress(id); }

  @Post('customers/:id/notes') @Permissions('customers:update') addNote(@Param('id') id: string, @Body() dto: D.NoteDto, @CurrentUser() u: AuthUser) { return this.svc.addNote(id, dto, u); }
  @Patch('customers/notes/:noteId') @Permissions('customers:update') updateNote(@Param('noteId') id: string, @Body() dto: D.UpdateNoteDto) { return this.svc.updateNote(id, dto); }
  @Delete('customers/notes/:noteId') @HttpCode(204) @Permissions('customers:update') removeNote(@Param('noteId') id: string) { return this.svc.removeNote(id); }

  @Post('customers/:id/insurances') @Permissions('customers:update') addInsurance(@Param('id') id: string, @Body() dto: D.InsuranceDto) { return this.svc.addInsurance(id, dto); }
  @Patch('customers/insurances/:insuranceId') @Permissions('customers:update') updateInsurance(@Param('insuranceId') id: string, @Body() dto: D.UpdateInsuranceDto) { return this.svc.updateInsurance(id, dto); }
  @Delete('customers/insurances/:insuranceId') @HttpCode(204) @Permissions('customers:update') removeInsurance(@Param('insuranceId') id: string) { return this.svc.removeInsurance(id); }

  // prescriptions
  @Get('customers/:id/prescriptions') @Permissions('prescriptions:read') listRx(@Param('id') id: string) { return this.svc.listPrescriptions(id); }
  @Post('customers/:id/prescriptions') @Permissions('prescriptions:create') addRx(@Param('id') id: string, @Body() dto: D.PrescriptionDto, @CurrentUser() u: AuthUser, @CurrentStore() s: string | null) { return this.svc.addPrescription(id, dto, u, s); }
  @Get('prescriptions/:id') @Permissions('prescriptions:read') getRx(@Param('id') id: string) { return this.svc.getPrescription(id); }
  @Patch('prescriptions/:id') @Permissions('prescriptions:update') updateRx(@Param('id') id: string, @Body() dto: D.UpdatePrescriptionDto, @CurrentUser() u: AuthUser) { return this.svc.updatePrescription(id, dto, u); }
  @Post('prescriptions/:id/verify') @HttpCode(200) @Permissions('prescriptions:update') verifyRx(@Param('id') id: string, @CurrentUser() u: AuthUser) { return this.svc.verifyPrescription(id, u); }
  @Delete('prescriptions/:id') @HttpCode(204) @Permissions('prescriptions:delete') removeRx(@Param('id') id: string) { return this.svc.removePrescription(id); }
}
