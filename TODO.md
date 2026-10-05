You are a senior full-stack engineer. Build a complete, production-ready web application for an OPTICAL STORE (eyewear shop). It has 2 parts: a public e-commerce storefront (vitrine) and an admin dashboard (ERP) to manage the whole business. Everything must be fully customizable from the dashboard, without touching code.

Install any packages, libraries, or tools you need. Work in phases, and make sure each phase runs before moving to the next.

## TECH STACK
- Monorepo: pnpm + Turborepo (apps/api, apps/web, apps/admin, packages/shared)
- Backend: NestJS + TypeScript + PostgreSQL + Prisma ORM
- Frontend: Next.js (App Router) + TypeScript + Tailwind CSS + shadcn/ui
- State/data: TanStack Query, React Hook Form + Zod
- Auth: JWT access + refresh tokens, bcrypt, RBAC with permissions
- Cache/queues: Redis + BullMQ (emails, SMS, notifications)
- File storage: S3-compatible (MinIO locally)
- API docs: Swagger
- i18n: multi-language with RTL support (next-intl)
- DevOps: Docker + docker-compose, .env config, seed data
- Tests: Jest (backend), basic e2e for critical flows

## 1. STOREFRONT (public website)
- Modern, fast, responsive, SEO-optimized site
- Home page built from sections that are editable in the dashboard (banners, featured products, brands, promos, testimonials)
- Catalog: eyeglasses, sunglasses, contact lenses, lenses, accessories
- Filters: brand, gender, shape, material, color, size, price
- Product page: gallery, variants (color/size), stock status, related products
- Lens configurator: choose lens type (single vision, progressive, etc.), treatments (anti-blue, anti-reflect, photochromic), enter or upload a prescription
- Cart, checkout, payment (pluggable providers + cash on delivery), coupons
- Customer account: orders, order tracking, saved prescriptions, wishlist, addresses
- Online appointment booking for eye exams
- Store locator, contact page, blog, CMS pages (about, FAQ, policies)

## 2. ADMIN DASHBOARD (ERP)
### Users & Roles
- Users, custom roles, granular permissions per module/action
- Multi-store / multi-branch support
- Audit log of all actions

### Customers (CRM)
- Customer profiles, purchase history, prescription history (OD/OS: SPH, CYL, AXIS, ADD, PD), insurance info, notes

### POS (Point of Sale)
- Fast in-store sales screen, barcode scanning
- Prescription orders with deposit + remaining balance
- Multiple payment methods, receipts/invoice printing
- Cash register open/close, daily closing report

### Products & Inventory
- Products, variants, brands, categories, barcodes
- Stock per store/warehouse, transfers, adjustments, low-stock alerts, inventory count

### Purchasing (Achat)
- Suppliers, purchase orders, goods reception, supplier invoices and payments

### Workshop / Fabrication (lab)
- Job orders: frame + lenses + prescription
- Status workflow: pending → lenses ordered → received → cutting/mounting → quality check → ready → delivered
- Assign technician, notify customer when ready (SMS/email/WhatsApp)

### Sales & Orders
- Online + POS orders, quotes, invoices, returns, refunds

### Appointments
- Calendar per optometrist, booking management

### HR
- Employees, contracts, attendance, leave requests, sales commissions, basic payroll

### Finance
- Payments, expenses, cash flow, taxes, credit notes

### Reports & Dashboard
- KPIs, sales by period/store/employee, best sellers, stock value, profits, export to Excel/PDF

### Settings (full customization)
- Brand: name, logo, colors, fonts, favicon
- Storefront content: menus, home sections, pages, banners
- Languages, currency, taxes, units
- Invoice/receipt templates, document numbering
- Email/SMS templates, payment and shipping methods
- Enable/disable modules
- Custom fields on main entities

## REQUIREMENTS
- Clean architecture, modular NestJS modules, DTO validation, error handling
- Pagination, search, and filters on all lists
- Soft delete and timestamps on all tables
- Secure: rate limiting, CORS, helmet, input validation
- Responsive admin UI with light/dark mode
- Seed script with demo data and a default super-admin
- README with setup and run instructions

## BUILD ORDER
1. Monorepo setup, Docker, database schema, auth + roles
2. Products, inventory, customers, prescriptions
3. POS + sales + invoices
4. Purchasing + workshop/fabrication
5. Storefront + checkout + appointments
6. HR + finance + reports
7. Settings/customization + i18n + polish + tests

Start with phase 1 and show me the database schema before continuing.