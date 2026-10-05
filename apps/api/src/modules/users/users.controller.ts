import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { CurrentUser, Permissions } from '../../common/decorators';
import type { AuthUser } from '../../common/types';
import { CreateUserDto, ListUsersDto, UpdateUserDto } from './dto/user.dto';
import { UsersService } from './users.service';

@ApiTags('users') @ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get() @Permissions('users:read')
  list(@Query() q: ListUsersDto) { return this.users.list(q); }

  @Get(':id') @Permissions('users:read')
  get(@Param('id') id: string) { return this.users.get(id); }

  @Post() @Permissions('users:create')
  create(@Body() dto: CreateUserDto) { return this.users.create(dto); }

  @Patch(':id') @Permissions('users:update')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() actor: AuthUser) { return this.users.update(id, dto, actor); }

  @Delete(':id') @HttpCode(204) @Permissions('users:delete')
  remove(@Param('id') id: string, @CurrentUser() actor: AuthUser) { return this.users.remove(id, actor); }
}
