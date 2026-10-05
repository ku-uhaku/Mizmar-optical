import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../generated/prisma/client';

/** The client handed to `prisma.raw.$transaction(async (tx) => …)`; pass it to helpers that must run in the caller's transaction. */
export type Tx = Prisma.TransactionClient;
import type { Env } from '../config/env';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/**
 * Two clients on one connection pool:
 *  - `db`  : soft-delete aware. Reads hide rows with deletedAt set; `delete`/`deleteMany`
 *            become soft deletes. Use this everywhere in application code.
 *  - `raw` : plain client (includes soft-deleted rows, real deletes). Seeds / maintenance only.
 */
@Injectable()
export class PrismaService implements OnModuleInit, OnModuleDestroy {
  readonly raw: PrismaClient;
  readonly db: ReturnType<PrismaService['extend']>;

  constructor(config: ConfigService<Env, true>) {
    this.raw = new PrismaClient({
      adapter: new PrismaPg({ connectionString: config.get('DATABASE_URL', { infer: true }) }),
    });
    this.db = this.extend();
  }

  private extend() {
    const raw = this.raw;
    const hideDeleted = ({ args, query }: { args: any; query: (a: any) => Promise<any> }) => {
      args.where = args.where?.deletedAt === undefined ? { ...args.where, deletedAt: null } : args.where;
      return query(args);
    };
    return raw.$extends({
      name: 'soft-delete',
      query: {
        $allModels: {
          findMany: hideDeleted,
          findFirst: hideDeleted,
          findFirstOrThrow: hideDeleted,
          findUnique: hideDeleted,
          findUniqueOrThrow: hideDeleted,
          count: hideDeleted,
          aggregate: hideDeleted,
          groupBy: hideDeleted,
          updateMany: hideDeleted,
          async delete({ model, args }: { model: string; args: any }) {
            return (raw as any)[lowerFirst(model)].update({ where: args.where, data: { deletedAt: new Date() } });
          },
          async deleteMany({ model, args }: { model: string; args: any }) {
            return (raw as any)[lowerFirst(model)].updateMany({
              where: { ...args.where, deletedAt: null },
              data: { deletedAt: new Date() },
            });
          },
        },
      },
    });
  }

  async onModuleInit() {
    await this.raw.$connect();
  }

  async onModuleDestroy() {
    await this.raw.$disconnect();
  }
}
