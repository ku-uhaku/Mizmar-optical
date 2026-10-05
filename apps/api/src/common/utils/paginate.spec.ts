import { paginate, searchWhere } from './paginate';

const dto = (o: object = {}) => ({ page: 1, limit: 20, sortOrder: 'desc' as const, ...o });
const delegate = (rows: unknown[], total: number) => ({ findMany: jest.fn().mockResolvedValue(rows), count: jest.fn().mockResolvedValue(total) });

describe('paginate', () => {
  it('computes skip/take and meta', async () => {
    const d = delegate([{ id: 1 }], 45);
    const res = await paginate(d, dto({ page: 3, limit: 10 }));
    expect(d.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
    expect(res.meta).toEqual({ page: 3, limit: 10, total: 45, totalPages: 5 });
  });

  it('reports at least one page when empty', async () => {
    const res = await paginate(delegate([], 0), dto());
    expect(res.meta.totalPages).toBe(1);
  });

  it('only sorts by whitelisted columns', async () => {
    const d = delegate([], 0);
    await paginate(d, dto({ sortBy: 'passwordHash' }), { sortable: ['email'], defaultSort: 'email' });
    expect(d.findMany).toHaveBeenCalledWith(expect.objectContaining({ orderBy: { email: 'desc' } }));
    await paginate(d, dto({ sortBy: 'email', sortOrder: 'asc' }), { sortable: ['email'] });
    expect(d.findMany).toHaveBeenLastCalledWith(expect.objectContaining({ orderBy: { email: 'asc' } }));
  });

  it('applies the same where to the count', async () => {
    const d = delegate([], 0);
    await paginate(d, dto(), { where: { type: 'STAFF' } });
    expect(d.count).toHaveBeenCalledWith({ where: { type: 'STAFF' } });
  });
});

describe('searchWhere', () => {
  it('returns an empty filter for blank search', () => {
    expect(searchWhere('  ', ['name'])).toEqual({});
    expect(searchWhere(undefined, ['name'])).toEqual({});
  });
  it('builds a case-insensitive OR over the fields', () => {
    expect(searchWhere(' ray ', ['name', 'sku'])).toEqual({
      OR: [{ name: { contains: 'ray', mode: 'insensitive' } }, { sku: { contains: 'ray', mode: 'insensitive' } }],
    });
  });
});
