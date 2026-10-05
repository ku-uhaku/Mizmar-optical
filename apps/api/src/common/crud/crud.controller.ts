import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post, Query, Type } from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';
import type { PermissionModule } from '@mizmar/shared';
import { Permissions } from '../decorators';
import { PaginationDto } from '../dto/pagination.dto';
import type { SimpleCrudService } from './simple-crud.service';

/** Union of the exact-match filters any simple resource may expose; each service only honours its own CrudConfig.filters. */
export class CrudListDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() isActive?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() parentId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() lensTypeId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() supplierId?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() kind?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() isLensLab?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() category?: string;
}

/**
 * Builds a controller exposing list/get/create/update/delete for a SimpleCrudService, guarded by `<module>:<action>`.
 * IMPORTANT: DTO classes are registered as `design:paramtypes` so the global ValidationPipe validates + whitelists bodies.
 */
export function createCrudController(opts: { path: string; tag: string; module: PermissionModule; service: Type<SimpleCrudService>; create: Type<any>; update: Type<any> }) {
  const read = `${opts.module}:read` as any, create = `${opts.module}:create` as any, update = `${opts.module}:update` as any, del = `${opts.module}:delete` as any;

  @ApiTags(opts.tag) @ApiBearerAuth() @Controller(opts.path)
  class CrudController {
    constructor(@Inject(opts.service) private readonly service: SimpleCrudService) {}

    @Get() @Permissions(read) list(@Query() q: CrudListDto) { return this.service.list(q, q); }
    @Get(':id') @Permissions(read) get(@Param('id') id: string) { return this.service.get(id); }
    @Post() @Permissions(create) @ApiBody({ type: opts.create }) add(@Body() dto: any) { return this.service.create(dto); }
    @Patch(':id') @Permissions(update) @ApiBody({ type: opts.update }) edit(@Param('id') id: string, @Body() dto: any) { return this.service.update(id, dto); }
    @Delete(':id') @HttpCode(204) @Permissions(del) remove(@Param('id') id: string) { return this.service.remove(id); }
  }
  Reflect.defineMetadata('design:paramtypes', [opts.create], CrudController.prototype, 'add');
  Reflect.defineMetadata('design:paramtypes', [String, opts.update], CrudController.prototype, 'edit');
  return CrudController;
}
