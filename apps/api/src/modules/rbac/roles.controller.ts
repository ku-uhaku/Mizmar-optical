import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Permissions } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { CreateRoleDto, UpdateRoleDto } from './dto/role.dto';
import { RolesService } from './roles.service';

@ApiTags('roles') @ApiBearerAuth()
@Controller()
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  @Get('permissions') @Permissions('roles:read')
  catalog() { return this.roles.catalog(); }

  @Get('roles') @Permissions('roles:read')
  list(@Query() q: PaginationDto) { return this.roles.list(q); }

  @Get('roles/:id') @Permissions('roles:read')
  get(@Param('id') id: string) { return this.roles.get(id); }

  @Post('roles') @Permissions('roles:create')
  create(@Body() dto: CreateRoleDto) { return this.roles.create(dto); }

  @Patch('roles/:id') @Permissions('roles:update')
  update(@Param('id') id: string, @Body() dto: UpdateRoleDto) { return this.roles.update(id, dto); }

  @Delete('roles/:id') @HttpCode(204) @Permissions('roles:delete')
  remove(@Param('id') id: string) { return this.roles.remove(id); }
}
