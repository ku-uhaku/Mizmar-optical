import type { PaginationDto } from '../dto/pagination.dto';

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

interface Delegate {
  findMany(args: any): PromiseLike<any[]>;
  count(args: any): PromiseLike<any>;
}

/**
 * Generic paginated query. `sortable` whitelists the columns a client may sort by
 * (never pass raw client input to orderBy).
 */
export async function paginate<T = any>(
  delegate: Delegate,
  dto: PaginationDto,
  opts: { where?: object; include?: object; select?: object; sortable?: string[]; defaultSort?: string } = {},
): Promise<Paginated<T>> {
  const { page, limit, sortOrder } = dto;
  const sortable = opts.sortable ?? ['createdAt'];
  const sortBy = dto.sortBy && sortable.includes(dto.sortBy) ? dto.sortBy : (opts.defaultSort ?? 'createdAt');
  const args = { where: opts.where };
  const [data, total] = await Promise.all([
    delegate.findMany({
      ...args,
      include: opts.include,
      select: opts.select,
      orderBy: { [sortBy]: sortOrder },
      skip: (page - 1) * limit,
      take: limit,
    }),
    delegate.count(args) as PromiseLike<number>,
  ]);
  return { data, meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) } };
}

/** Builds an OR/contains filter over text columns for the `search` query param. */
export const searchWhere = (search: string | undefined, fields: string[]) =>
  search?.trim()
    ? { OR: fields.map((f) => ({ [f]: { contains: search.trim(), mode: 'insensitive' as const } })) }
    : {};
