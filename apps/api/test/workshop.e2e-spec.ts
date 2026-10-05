import { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { createTestApp } from './app';
import { setupSales } from './sales-helpers';
import { PrismaService } from '../src/prisma/prisma.service';

type F = Awaited<ReturnType<typeof setupSales>>;

describe('Workshop: jobs from sales, workflow, QC, lab orders, delivery (e2e)', () => {
  let app: INestApplication;
  let f: F;
  let prisma: PrismaService;
  beforeAll(async () => { app = await createTestApp(); f = await setupSales(app); prisma = app.get(PrismaService); });
  afterAll(async () => { await app.close(); });

  /** Sells a frame + lenses (deposit only unless `full`) and returns the order and its job. */
  async function sellWithLens(full = false) {
    const session = await f.openCashier(100);
    try {
      const frame = await f.newProduct({ price: 500, type: 'FRAME', lens: true });
      const { customer, rx } = await f.customerWithRx();
      const lens = (await f.lensOptions()).find((l) => !l.requiresAdd)!;
      const preview = (await f.cashier.post('/pos/price', { customerId: customer.id, lines: [{ variantId: frame.variantId, quantity: 1, lens: { lensTypeId: lens.id, prescriptionId: rx.id } }] }).expect(200)).body;
      const amount = full ? preview.total : preview.minimumPayment;
      const order = (await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), customerId: customer.id, lines: [{ variantId: frame.variantId, quantity: 1, lens: { lensTypeId: lens.id, prescriptionId: rx.id } }], payments: [{ methodId: f.method('cash'), amount }] }).expect(201)).body;
      const jobs = (await f.admin.get(`/jobs?search=${order.number}`).expect(200)).body.data;
      return { order, job: jobs[0], customer };
    } finally { await f.closeSession(f.cashier, session.session.id, 100); }
  }

  const walk = async (id: string) => {
    await f.admin.post(`/jobs/${id}/status`, { to: 'LENSES_RECEIVED' }).expect(200);
  };
  const readyUp = async (id: string, techId: string) => {
    await walk(id);
    await f.admin.post(`/jobs/${id}/assign`, { technicianId: techId }).expect(200);
    await f.admin.post(`/jobs/${id}/status`, { to: 'CUTTING_MOUNTING' }).expect(200);
    const job = (await f.admin.get(`/jobs/${id}`)).body;
    for (const t of job.tasks) await f.admin.patch(`/jobs/${id}/tasks/${t.id}`, { status: 'DONE' }).expect(200);
    await f.admin.post(`/jobs/${id}/status`, { to: 'QUALITY_CHECK' }).expect(200);
  };

  it('a prescription sale creates exactly one pending job with tasks and a promised date; plain sales create none', async () => {
    const { order, job } = await sellWithLens();
    expect(job).toBeTruthy();
    expect(job).toMatchObject({ status: 'PENDING', orderId: order.id });
    const full = (await f.admin.get(`/jobs/${job.id}`).expect(200)).body;
    expect(full.tasks.length).toBeGreaterThan(0);
    expect(full.promisedAt).toBeTruthy();
    expect(full.history[0].toStatus).toBe('PENDING');
    const plain = await f.newProduct();
    const s = await f.openCashier(50);
    const o2 = (await f.cashier.post('/pos/checkout', { clientRef: randomUUID(), lines: [{ variantId: plain.variantId, quantity: 1 }], payments: [{ methodId: f.method('cash'), amount: 100 }] }).expect(201)).body;
    await f.closeSession(f.cashier, s.session.id, 150);
    expect((await f.admin.get(`/jobs?search=${o2.number}`)).body.data).toHaveLength(0);
  });

  it('follows the workflow: invalid jumps refused, technician and tasks required, QC fail loops back', async () => {
    const { job } = await sellWithLens();
    const bad = await f.admin.post(`/jobs/${job.id}/status`, { to: 'READY' }).expect(409);
    expect(bad.body.code).toBe('INVALID_TRANSITION');
    await walk(job.id);
    expect((await f.admin.post(`/jobs/${job.id}/status`, { to: 'CUTTING_MOUNTING' }).expect(409)).body.code).toBe('TECHNICIAN_REQUIRED');
    const tech = f.technician.user.id;
    await f.technician.post(`/jobs/${job.id}/assign`, { technicianId: f.cashier.user.id }).expect(403); // may only take a job themselves
    await f.technician.post(`/jobs/${job.id}/assign`, { technicianId: tech }).expect(200);
    await f.admin.post(`/jobs/${job.id}/status`, { to: 'CUTTING_MOUNTING' }).expect(200);
    expect((await f.admin.post(`/jobs/${job.id}/status`, { to: 'QUALITY_CHECK' }).expect(409)).body.code).toBe('TASKS_OPEN');
    const tasks = (await f.admin.get(`/jobs/${job.id}`)).body.tasks;
    for (const t of tasks) await f.technician.patch(`/jobs/${job.id}/tasks/${t.id}`, { status: 'DONE' }).expect(200);
    await f.technician.post(`/jobs/${job.id}/status`, { to: 'QUALITY_CHECK' }).expect(200);
    await f.cashier.post(`/jobs/${job.id}/quality-check`, { passed: true }).expect(403);
    await f.technician.post(`/jobs/${job.id}/quality-check`, { passed: false }).expect(400); // needs notes
    const failed = (await f.technician.post(`/jobs/${job.id}/quality-check`, { passed: false, notes: 'Axis off by 5°' }).expect(200)).body;
    expect(failed.status).toBe('CUTTING_MOUNTING');
    expect(failed.qcPassed).toBe(false);
    expect(failed.tasks.every((t: { status: string }) => t.status === 'TODO')).toBe(true);
  });

  it('on hold resumes where it was; QC pass makes it ready and queues customer notifications', async () => {
    const { job, customer } = await sellWithLens();
    await f.admin.post(`/jobs/${job.id}/status`, { to: 'ON_HOLD', note: 'Customer away' }).expect(200);
    await f.admin.post(`/jobs/${job.id}/status`, { to: 'LENSES_RECEIVED' }).expect(409);
    expect((await f.admin.post(`/jobs/${job.id}/resume`, {}).expect(200)).body.status).toBe('PENDING');
    await readyUp(job.id, f.technician.user.id);
    const ready = (await f.technician.post(`/jobs/${job.id}/quality-check`, { passed: true }).expect(200)).body;
    expect(ready).toMatchObject({ status: 'READY', qcPassed: true });
    expect(ready.readyAt).toBeTruthy();
    const rows = await prisma.raw.notification.findMany({ where: { customerId: customer.id, type: 'job_ready' } });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(ready.customerNotifiedAt).toBeTruthy();
    const again = (await f.admin.post(`/jobs/${job.id}/notify`).expect(200)).body;
    expect(again.status).toBe('READY');
    expect(await prisma.raw.notification.count({ where: { customerId: customer.id, type: 'job_ready' } })).toBeGreaterThan(rows.length);
  });

  it('lab lens orders drive the job: ordered → received, defective sends it back', async () => {
    const { job } = await sellWithLens();
    const lab = (await prisma.raw.supplier.findFirstOrThrow({ where: { isLensLab: true } })).id;
    const withLab = (await f.admin.post(`/jobs/${job.id}/lens-orders`, { supplierId: lab, reference: 'LAB-1', cost: 80 }).expect(201)).body;
    const labId = withLab.labLensOrders[0].id;
    await f.admin.patch(`/jobs/${job.id}/lens-orders/${labId}`, { status: 'RECEIVED' }).expect(409); // must be ordered first
    expect((await f.admin.patch(`/jobs/${job.id}/lens-orders/${labId}`, { status: 'ORDERED' }).expect(200)).body.status).toBe('LENSES_ORDERED');
    expect((await f.admin.patch(`/jobs/${job.id}/lens-orders/${labId}`, { status: 'RECEIVED' }).expect(200)).body.status).toBe('LENSES_RECEIVED');
    const back = (await f.admin.patch(`/jobs/${job.id}/lens-orders/${labId}`, { status: 'DEFECTIVE', notes: 'Scratched' }).expect(200)).body;
    expect(back.status).toBe('PENDING');
  });

  it('hand-over needs the job ready and the balance paid; delivering the order delivers its jobs', async () => {
    const { order, job } = await sellWithLens();
    expect((await f.admin.post(`/orders/${order.id}/deliver`).expect(409)).body.code).toBe('BALANCE_DUE'); // deposit only
    const s = await f.openCashier(0);
    await f.cashier.post(`/orders/${order.id}/payments`, { methodId: f.method('cash'), amount: Number(order.balanceDue) }).expect(201);
    expect((await f.admin.post(`/orders/${order.id}/deliver`).expect(409)).body.code).toBe('JOBS_NOT_READY');
    expect((await f.admin.post(`/jobs/${job.id}/deliver`).expect(409)).body.code).toBe('INVALID_STATE');
    await readyUp(job.id, f.technician.user.id);
    await f.technician.post(`/jobs/${job.id}/quality-check`, { passed: true }).expect(200);
    await f.admin.post(`/orders/${order.id}/deliver`).expect(200);
    const done = (await f.admin.get(`/jobs/${job.id}`)).body;
    expect(done.status).toBe('DELIVERED');
    await f.closeSession(f.cashier, s.session.id, 1_000_000);
  });

  it('job deliver is blocked while the order has a balance; cancelling the order cancels its jobs', async () => {
    const a = await sellWithLens();
    await readyUp(a.job.id, f.technician.user.id);
    await f.technician.post(`/jobs/${a.job.id}/quality-check`, { passed: true }).expect(200);
    expect((await f.admin.post(`/jobs/${a.job.id}/deliver`).expect(409)).body.code).toBe('BALANCE_DUE');

    const b = await sellWithLens();
    const s = await f.openManager(5000);
    await f.manager.post(`/orders/${b.order.id}/cancel`, { reason: 'Changed mind', refund: { methodId: f.method('cash') } }).expect(200);
    await f.closeSession(f.manager, s.session.id, 1000);
    expect((await f.admin.get(`/jobs/${b.job.id}`).expect(200)).body.status).toBe('CANCELLED');
  });

  it('manual job for the customer\'s own frame, ticket renders, summary and filters work', async () => {
    const { customer, rx } = await f.customerWithRx();
    await f.admin.post('/jobs', { customerId: customer.id, prescriptionId: rx.id }).expect(400); // frame required
    const job = (await f.admin.post('/jobs', { customerId: customer.id, prescriptionId: rx.id, frameDescription: 'Ray-Ban vintage, black', priority: 'URGENT' }).expect(201)).body;
    expect(job).toMatchObject({ frameSource: 'CUSTOMER_OWN', priority: 'URGENT', status: 'PENDING' });
    const doc = (await f.admin.get(`/jobs/${job.id}/document?locale=fr`).expect(200)).body;
    expect(doc.html).toContain(job.number);
    expect(doc.html).toContain('Ray-Ban vintage');
    const sum = (await f.admin.get('/jobs/summary').expect(200)).body;
    expect(sum.counts.PENDING).toBeGreaterThanOrEqual(1);
    expect((await f.admin.get(`/jobs?customerId=${customer.id}&active=true`).expect(200)).body.data).toHaveLength(1);
    await f.cashier.get('/jobs').expect(403);
    await f.technician.get('/jobs').expect(200);
  });
});
