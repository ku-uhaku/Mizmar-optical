import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsOptional, IsString } from 'class-validator';
import { Permissions } from '../../common/decorators';
import { PaginationDto } from '../../common/dto/pagination.dto';
import { paginate, searchWhere } from '../../common/utils/paginate';
import { PrismaService } from '../../prisma/prisma.service';

class ListAuditDto extends PaginationDto {
  @ApiPropertyOptional() @IsOptional() @IsString() entity?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() action?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() actorId?: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() from?: Date;
  @ApiPropertyOptional() @IsOptional() @Type(() => Date) @IsDate() to?: Date;
}

@ApiTags('audit') @ApiBearerAuth()
@Controller('audit-logs')
export class AuditController {
  constructor(private readonly prisma: PrismaService) {}

  @Get() @Permissions('audit:read')
  list(@Query() q: ListAuditDto) {
    const where = {
      ...searchWhere(q.search, ['entity', 'entityId', 'action']),
      ...(q.entity ? { entity: q.entity } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.actorId ? { actorId: q.actorId } : {}),
      ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}),
    };
    return paginate(this.prisma.db.auditLog, q, { where, sortable: ['createdAt', 'entity', 'action'] });
  }
}
