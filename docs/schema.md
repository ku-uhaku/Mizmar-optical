# Mizmar Optical — Database Schema

_Generated from `apps/api/prisma/schema/*.prisma` by `scripts/gen-schema-doc.py`. Do not edit by hand._

**123 models · 66 enums · PostgreSQL 17 · Prisma 7**

## Conventions (every model)

- `id` cuid · `createdAt` · `updatedAt` · `deletedAt` (soft delete, filtered by the Prisma client extension).
- Money `Decimal(12,2)`; optical measures `Decimal(5,2)`; PD `Decimal(4,1)`.
- Transactional tables carry `storeId` (indexed) → multi-branch scoping. Document numbers are unique per store: `@@unique([storeId, number])`.
- Translatable content: base columns hold French; `translations Json?` holds `{ ar: {…}, en: {…} }`.
- `createdById`-style columns are plain scalars (no FK) to avoid a User back-relation explosion and to survive user soft-deletes.
- Unique business keys (`User.email`, `ProductVariant.sku`) are globally unique; on soft delete the service suffixes the value to release it.
- Order totals are stored (`subtotal/discountTotal/taxTotal/shippingTotal/total/paidTotal/balanceDue`); `balanceDue > 0` models a prescription order with a deposit.
- Snapshots (`prescriptionSnapshot`, line `taxRatePct`, `unitCost`, lens-treatment name/price) keep history stable when catalog data changes.

## PLATFORM & ACCESS

**Enums:** `UserType` (STAFF, CUSTOMER), `UserStatus` (ACTIVE, INVITED, SUSPENDED), `SettingScope` (GLOBAL, STORE), `DocumentType` (ORDER, QUOTE, INVOICE, CREDIT_NOTE, RECEIPT, RETURN, PURCHASE_ORDER, GOODS_RECEIPT, STOCK_TRANSFER, STOCK_ADJUSTMENT, INVENTORY_COUNT, JOB_ORDER, APPOINTMENT, EXPENSE, PAYSLIP, CUSTOMER), `SequenceReset` (NEVER, YEARLY, MONTHLY), `CustomFieldEntity` (CUSTOMER, PRODUCT, PRODUCT_VARIANT, ORDER, PRESCRIPTION, JOB_ORDER, SUPPLIER, EMPLOYEE, APPOINTMENT), `CustomFieldType` (TEXT, TEXTAREA, NUMBER, DECIMAL, BOOLEAN, DATE, SELECT, MULTI_SELECT)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Store** | A branch / shop. Also powers the public store locator. | `code`, `name`, `slug`, `phone`, `email`, `address`, `city`, `region` … | — |
| **User** |  | `email`, `phone`, `passwordHash`, `firstName`, `lastName`, `avatarUrl`, `type`, `status` … | — |
| **Role** |  | `code`, `name`, `description`, `isSystem` | — |
| **Permission** | Catalog row per `module:action` key; seeded from packages/shared so code and DB cannot drift. | `key`, `module`, `action`, `description` | — |
| **RolePermission** |  | <br>unique: (roleId, permissionId) | Role (`role`), Permission (`permission`) |
| **UserRole** |  | `userId`<br>unique: (userId, roleId) | User (`user`), Role (`role`) |
| **UserStore** | Which stores a staff user may work in (multi-branch scoping). | `userId`, `isDefault`<br>unique: (userId, storeId) | User (`user`), Store (`store`) |
| **RefreshToken** | Hashed refresh tokens with rotation; `familyId` lets us revoke the whole chain on reuse. | `userId`, `tokenHash`, `expiresAt`, `revokedAt`, `userAgent`, `ip` | User (`user`) |
| **PasswordReset** |  | `userId`, `tokenHash`, `expiresAt`, `usedAt` | User (`user`) |
| **AuditLog** | Append-only. Application code never soft-deletes rows (deletedAt kept only for uniformity). | `entity`, `action`, `before`, `after`, `ip`, `userAgent` | — |
| **Setting** | Dashboard-editable configuration. `scopeId` = "global" or a storeId, so the unique key works for both scopes (a nullable storeId would not be unique in Postgres). | `scope`, `group`, `key`, `value`, `isPublic`<br>unique: (scope, scopeId, key) | — |
| **Translation** | UI string overrides editable from the dashboard (on top of the static next-intl files). | `locale`, `namespace`, `key`, `value`<br>unique: (locale, namespace, key) | — |
| **Language** |  | `code`, `name`, `nativeName`, `isRtl`, `isDefault`, `isActive`, `sortOrder` | — |
| **Currency** |  | `code`, `name`, `symbol`, `decimals`, `exchangeRate`, `isDefault`, `isActive` | — |
| **CustomFieldDefinition** |  | `entity`, `key`, `label`, `type`, `options`, `isRequired`, `isActive`, `sortOrder` …<br>unique: (entity, key) | — |
| **CustomFieldValue** |  | `entity`, `value`<br>unique: (definitionId, entityId) | CustomFieldDefinition (`definition`) |
| **DocumentSequence** | Per-store, per-document-type numbering (e.g. INV-2026-000123). | `docType`, `prefix`, `padding`, `nextNumber`, `reset`, `periodKey`<br>unique: (storeId, docType, periodKey) | — |
| **MediaAsset** |  | `key`, `url`, `fileName`, `mimeType`, `sizeBytes`, `width`, `height`, `alt` … | — |
| **ModuleToggle** | Enable/disable ERP / storefront modules from the dashboard. | `moduleKey`, `isEnabled`, `config` | — |

## CATALOG

**Enums:** `ProductType` (FRAME, SUNGLASSES, CONTACT_LENS, LENS, ACCESSORY), `ProductStatus` (DRAFT, ACTIVE, ARCHIVED), `Gender` (MEN, WOMEN, UNISEX, KIDS), `RimType` (FULL_RIM, SEMI_RIMLESS, RIMLESS), `LensKind` (SINGLE_VISION, BIFOCAL, PROGRESSIVE, OFFICE, READING, PLANO), `TreatmentCategory` (ANTI_REFLECTIVE, BLUE_LIGHT, PHOTOCHROMIC, POLARIZED, TINT, HARD_COAT, UV, OTHER), `ReviewStatus` (PENDING, APPROVED, REJECTED)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Brand** |  | `name`, `slug`, `logoUrl`, `description`, `website`, `isFeatured`, `isActive`, `sortOrder` … | — |
| **Category** |  | `name`, `slug`, `description`, `imageUrl`, `sortOrder`, `isActive`, `translations` | Category (`parent`) |
| **FrameShape** | Lookup table (editable from the dashboard) used by the shape filter. | `name`, `slug`, `iconUrl`, `sortOrder`, `isActive`, `translations` | — |
| **FrameMaterial** | Lookup table (editable from the dashboard) used by the material filter. | `name`, `slug`, `sortOrder`, `isActive`, `translations` | — |
| **Product** |  | `type`, `name`, `slug`, `shortDescription`, `description`, `gender`, `status`, `isPublished` … | Brand (`brand`), Category (`category`) |
| **ProductVariant** |  | `sku`, `barcode`, `name`, `color`, `colorHex`, `size`, `price`, `compareAtPrice` … | Product (`product`) |
| **ProductImage** |  | `url`, `alt`, `isPrimary`, `sortOrder` | Product (`product`), ProductVariant (`variant`) |
| **Attribute** | Generic attributes (contact-lens base curve, diameter, power, pack size, ...). | `code`, `name`, `sortOrder`, `isFilterable`, `translations` | — |
| **AttributeValue** |  | `value`, `label`, `sortOrder`<br>unique: (attributeId, value) | Attribute (`attribute`) |
| **VariantAttributeValue** |  | <br>unique: (variantId, attributeValueId) | ProductVariant (`variant`), AttributeValue (`attributeValue`) |
| **FrameSpec** | Frame-specific technical data (frames and sunglasses). | `rimType`, `lensWidthMm`, `lensHeightMm`, `bridgeMm`, `templeMm`, `frameWidthMm`, `weightGrams`, `isPolarized` … | Product (`product`), FrameShape (`shape`), FrameMaterial (`material`) |
| **LensType** | Lens family offered in the configurator and POS (single vision, progressive, ...). | `code`, `kind`, `name`, `description`, `basePrice`, `requiresAdd`, `isActive`, `sortOrder` … | — |
| **LensTreatment** |  | `code`, `category`, `name`, `description`, `price`, `isActive`, `sortOrder`, `translations` … | — |
| **LensTypeTreatment** | Which treatments are available for a lens type (with optional price override). | `priceOverride`<br>unique: (lensTypeId, treatmentId) | LensType (`lensType`), LensTreatment (`treatment`) |
| **LensCatalogEntry** | A concrete orderable lens (index, material, power range, price) from a lens lab / supplier. | `sku`, `name`, `refractiveIndex`, `material`, `diameterMm`, `sphMin`, `sphMax`, `cylMin` … | LensType (`lensType`), Supplier (`supplier`) |
| **Review** |  | `authorName`, `rating`, `title`, `body`, `status` | Product (`product`) |

## INVENTORY

**Enums:** `StockMovementType` (INITIAL, PURCHASE_RECEIPT, SALE, SALE_RETURN, TRANSFER_OUT, TRANSFER_IN, ADJUSTMENT, COUNT_CORRECTION, LAB_CONSUMPTION, SUPPLIER_RETURN), `TransferStatus` (DRAFT, IN_TRANSIT, RECEIVED, CANCELLED), `AdjustmentReason` (DAMAGED, LOST, FOUND, EXPIRED, CORRECTION, OTHER), `CountStatus` (DRAFT, IN_PROGRESS, COMPLETED, CANCELLED)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Warehouse** |  | `code`, `name`, `isDefault`, `isActive`, `purchaseOrders`, `goodsReceipts`<br>unique: (storeId, code) | Store (`store`) |
| **StockLevel** |  | `quantity`, `reserved`, `reorderPoint`, `reorderQty`<br>unique: (variantId, warehouseId) | ProductVariant (`variant`), Warehouse (`warehouse`) |
| **StockMovement** | Append-only stock ledger. `quantity` is signed; `balanceAfter` snapshots the level. | `type`, `quantity`, `balanceAfter`, `unitCost`, `refType`, `lotNumber`, `expiryDate`, `note` | ProductVariant (`variant`), Warehouse (`warehouse`) |
| **StockTransfer** |  | `number`, `status`, `note`, `shippedAt`, `receivedAt`<br>unique: (storeId, number) | Warehouse (`fromWarehouse`), Warehouse (`toWarehouse`) |
| **StockTransferLine** |  | `quantity`, `receivedQty` | StockTransfer (`transfer`), ProductVariant (`variant`) |
| **StockAdjustment** |  | `number`, `reason`, `note`<br>unique: (storeId, number) | Warehouse (`warehouse`) |
| **StockAdjustmentLine** |  | `quantityDelta`, `note` | StockAdjustment (`adjustment`), ProductVariant (`variant`) |
| **InventoryCount** |  | `number`, `status`, `note`, `startedAt`, `completedAt`<br>unique: (storeId, number) | Warehouse (`warehouse`) |
| **InventoryCountLine** |  | `expectedQty`, `countedQty`, `note`<br>unique: (countId, variantId) | InventoryCount (`count`), ProductVariant (`variant`) |

## CUSTOMERS (CRM) & PRESCRIPTIONS

**Enums:** `CustomerSource` (POS, ONLINE, IMPORT, APPOINTMENT), `PrescriptionSource` (STORE, UPLOAD, SELF, EXTERNAL)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Customer** |  | `userId`, `code`, `firstName`, `lastName`, `email`, `phone`, `whatsapp`, `gender` … | User (`user`) |
| **CustomerAddress** |  | `label`, `recipient`, `phone`, `line1`, `line2`, `city`, `region`, `postalCode` … | Customer (`customer`) |
| **Prescription** | One row = one full prescription. OD = right eye, OS = left eye. Powers are in diopters, AXIS in degrees (0-180), PD in millimetres. | `source`, `prescriberName`, `issuedAt`, `expiresAt`, `odSph`, `odCyl`, `odAxis`, `odAdd` … | Customer (`customer`) |
| **InsuranceProvider** |  | `name`, `code`, `phone`, `email`, `defaultCoveragePct`, `notes`, `isActive` | — |
| **CustomerInsurance** |  | `policyNumber`, `coveragePct`, `validFrom`, `validTo`, `notes` | Customer (`customer`), InsuranceProvider (`provider`) |
| **CustomerNote** |  | `body`, `isPinned` | Customer (`customer`) |
| **WishlistItem** |  | <br>unique: (customerId, productId) | Customer (`customer`), Product (`product`) |
| **LoyaltyLedger** |  | `points`, `balanceAfter`, `reason` | Customer (`customer`) |

## SALES, PAYMENTS & PROMOTIONS

**Enums:** `OrderChannel` (ONLINE, POS), `OrderStatus` (DRAFT, PENDING, CONFIRMED, PROCESSING, READY, SHIPPED, DELIVERED, COMPLETED, CANCELLED), `OrderPaymentStatus` (UNPAID, PARTIAL, PAID, PARTIALLY_REFUNDED, REFUNDED), `FulfillmentType` (IN_STORE, PICKUP, DELIVERY), `QuoteStatus` (DRAFT, SENT, ACCEPTED, REJECTED, EXPIRED, CONVERTED), `InvoiceStatus` (DRAFT, ISSUED, PARTIALLY_PAID, PAID, VOID), `CreditNoteStatus` (DRAFT, ISSUED, APPLIED, VOID), `PaymentMethodType` (CASH, CARD, BANK_TRANSFER, CHEQUE, CASH_ON_DELIVERY, ONLINE_PROVIDER, INSURANCE, STORE_CREDIT, OTHER), `PaymentKind` (PAYMENT, DEPOSIT, REFUND), `PaymentTxStatus` (PENDING, AUTHORIZED, CAPTURED, FAILED, CANCELLED, REFUNDED), `ReturnStatus` (REQUESTED, APPROVED, RECEIVED, REFUNDED, REJECTED), `ItemCondition` (NEW, OPENED, DAMAGED), `CouponType` (PERCENT, FIXED, FREE_SHIPPING), `ShipmentStatus` (PENDING, IN_TRANSIT, DELIVERED, RETURNED)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **TaxRate** |  | `code`, `name`, `rate`, `isInclusive`, `isDefault`, `isActive` | — |
| **PaymentMethodConfig** | Pluggable payment methods (cash, card, COD, online providers). Shown per channel. | `code`, `name`, `type`, `provider`, `config`, `availableOnline`, `availableInPos`, `feePct` … | — |
| **ShippingMethod** |  | `code`, `name`, `description`, `price`, `freeOverAmount`, `estimatedDaysMin`, `estimatedDaysMax`, `zones` … | — |
| **Coupon** |  | `code`, `description`, `type`, `value`, `minSubtotal`, `maxDiscount`, `usageLimit`, `perCustomerLimit` … | — |
| **Order** |  | `number`, `channel`, `status`, `paymentStatus`, `fulfillment`, `currency`, `subtotal`, `discountTotal` …<br>unique: (storeId, number) | Customer (`customer`), Coupon (`coupon`), ShippingMethod (`shippingMethod`), CashSession (`cashSession`) |
| **OrderLine** |  | `sku`, `description`, `quantity`, `unitPrice`, `unitCost`, `discount`, `taxRatePct`, `taxAmount` … | Order (`order`), ProductVariant (`variant`), LensCatalogEntry (`lensEntry`), TaxRate (`taxRate`) |
| **OrderLineLensConfig** | Lens configuration chosen for a frame line (configurator or POS). Snapshots keep history stable if the prescription or catalog prices change later. | `prescriptionSnapshot`, `lensPrice`, `treatmentsPrice`, `notes` | OrderLine (`orderLine`), LensType (`lensType`), Prescription (`prescription`) |
| **OrderLineLensTreatment** |  | `name`, `price`<br>unique: (configId, treatmentId) | OrderLineLensConfig (`config`), LensTreatment (`treatment`) |
| **Quote** |  | `number`, `status`, `validUntil`, `subtotal`, `discountTotal`, `taxTotal`, `total`, `notes`<br>unique: (storeId, number) | Customer (`customer`) |
| **QuoteLine** |  | `description`, `quantity`, `unitPrice`, `discount`, `taxRatePct`, `taxAmount`, `lineTotal`, `lensConfig` … | Quote (`quote`), ProductVariant (`variant`) |
| **Invoice** |  | `number`, `status`, `issuedAt`, `dueAt`, `subtotal`, `discountTotal`, `taxTotal`, `total` …<br>unique: (storeId, number) | Order (`order`), Customer (`customer`), DocumentTemplate (`template`) |
| **InvoiceLine** |  | `description`, `quantity`, `unitPrice`, `discount`, `taxRatePct`, `taxAmount`, `lineTotal`, `sortOrder` | Invoice (`invoice`) |
| **CreditNote** |  | `number`, `status`, `reason`, `subtotal`, `taxTotal`, `total`, `issuedAt`<br>unique: (storeId, number) | Invoice (`invoice`), Return (`return`), Customer (`customer`) |
| **CreditNoteLine** |  | `description`, `quantity`, `unitPrice`, `taxRatePct`, `taxAmount`, `lineTotal` | CreditNote (`creditNote`) |
| **Payment** | Money movement tied to an order and/or invoice. Deposits are `kind = DEPOSIT`. | `kind`, `status`, `amount`, `currency`, `reference`, `providerPayload`, `paidAt`, `note` | Order (`order`), Invoice (`invoice`), Customer (`customer`), PaymentMethodConfig (`method`), CashSession (`cashSession`) |
| **Return** |  | `number`, `status`, `reason`, `refundTotal`, `processedAt`<br>unique: (storeId, number) | Order (`order`), Customer (`customer`) |
| **ReturnLine** |  | `quantity`, `condition`, `restock`, `refundAmount` | Return (`return`), OrderLine (`orderLine`) |
| **Refund** |  | `amount`, `status`, `reference`, `reason`, `refundedAt` | Order (`order`), Return (`return`), Payment (`payment`) |
| **CouponRedemption** |  | `amount` | Coupon (`coupon`), Order (`order`) |
| **Shipment** |  | `carrier`, `trackingNumber`, `trackingUrl`, `status`, `address`, `shippedAt`, `deliveredAt` | Order (`order`) |

## POINT OF SALE

**Enums:** `CashSessionStatus` (OPEN, CLOSED), `CashMovementType` (SALE, DEPOSIT, REFUND, CASH_IN, CASH_OUT)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **CashRegister** |  | `code`, `name`, `isActive`<br>unique: (storeId, code) | — |
| **CashSession** | One shift on a register: open with a float, close with a counted amount and a daily report. | `status`, `openedAt`, `closedAt`, `openingFloat`, `expectedCash`, `countedCash`, `variance`, `closingReport` … | CashRegister (`register`) |
| **CashMovement** |  | `type`, `amount`, `reason` | CashSession (`session`) |
| **PosHeldSale** | Parked POS cart so the cashier can serve another customer and resume later. | `label`, `cart` | CashRegister (`register`) |

## PURCHASING (ACHAT)

**Enums:** `PurchaseOrderStatus` (DRAFT, SENT, PARTIALLY_RECEIVED, RECEIVED, CANCELLED), `ReceiptStatus` (DRAFT, POSTED, VOID), `SupplierInvoiceStatus` (UNPAID, PARTIALLY_PAID, PAID, VOID)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Supplier** |  | `code`, `name`, `contactName`, `email`, `phone`, `address`, `city`, `country` … | — |
| **PurchaseOrder** |  | `number`, `status`, `currency`, `orderedAt`, `expectedAt`, `subtotal`, `taxTotal`, `total` …<br>unique: (storeId, number) | Warehouse (`warehouse`), Supplier (`supplier`) |
| **PurchaseOrderLine** |  | `description`, `qtyOrdered`, `qtyReceived`, `unitCost`, `taxRatePct`, `lineTotal` | PurchaseOrder (`purchaseOrder`), ProductVariant (`variant`) |
| **GoodsReceipt** |  | `number`, `status`, `deliveryNoteRef`, `receivedAt`, `note`<br>unique: (storeId, number) | Warehouse (`warehouse`), PurchaseOrder (`purchaseOrder`), Supplier (`supplier`) |
| **GoodsReceiptLine** |  | `quantity`, `unitCost`, `lotNumber`, `expiryDate` | GoodsReceipt (`receipt`), PurchaseOrderLine (`purchaseOrderLine`), ProductVariant (`variant`) |
| **SupplierInvoice** |  | `number`, `supplierRef`, `status`, `issuedAt`, `dueAt`, `subtotal`, `taxTotal`, `total` …<br>unique: (storeId, number); (supplierId, supplierRef) | Supplier (`supplier`), PurchaseOrder (`purchaseOrder`) |
| **SupplierInvoiceLine** |  | `description`, `quantity`, `unitCost`, `taxRatePct`, `lineTotal` | SupplierInvoice (`invoice`), GoodsReceipt (`goodsReceipt`), GoodsReceiptLine (`goodsReceiptLine`) |
| **SupplierPayment** |  | `amount`, `status`, `reference`, `paidAt`, `note` | Supplier (`supplier`), SupplierInvoice (`invoice`), BankAccount (`bankAccount`) |

## WORKSHOP / LAB (FABRICATION)

**Enums:** `JobOrderStatus` (PENDING, LENSES_ORDERED, LENSES_RECEIVED, CUTTING_MOUNTING, QUALITY_CHECK, READY, DELIVERED, ON_HOLD, CANCELLED), `JobPriority` (NORMAL, HIGH, URGENT), `FrameSource` (STORE_STOCK, CUSTOMER_OWN), `TaskStatus` (TODO, IN_PROGRESS, DONE), `LabLensOrderStatus` (TO_ORDER, ORDERED, RECEIVED, DEFECTIVE, CANCELLED)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **JobOrder** |  | `number`, `frameSource`, `frameDescription`, `treatments`, `fitting`, `status`, `priority`, `promisedAt` …<br>unique: (storeId, number) | Order (`order`), OrderLine (`orderLine`), Customer (`customer`), Prescription (`prescription`), ProductVariant (`frameVariant`), User (`technician`) |
| **JobOrderStatusHistory** |  | `fromStatus`, `toStatus`, `note`, `notified` | JobOrder (`jobOrder`) |
| **JobOrderTask** |  | `name`, `status`, `startedAt`, `completedAt`, `sortOrder` | JobOrder (`jobOrder`) |
| **LabLensOrder** | A lens blank ordered from an outside lab for a job order. | `status`, `reference`, `cost`, `orderedAt`, `expectedAt`, `receivedAt`, `notes` | JobOrder (`jobOrder`), Supplier (`supplier`), PurchaseOrder (`purchaseOrder`) |

## APPOINTMENTS (EYE EXAMS)

**Enums:** `AppointmentStatus` (PENDING, CONFIRMED, CHECKED_IN, COMPLETED, CANCELLED, NO_SHOW), `AppointmentSource` (ONLINE, STAFF, PHONE)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **AppointmentType** |  | `code`, `name`, `description`, `durationMin`, `bufferMin`, `price`, `color`, `bookableOnline` … | — |
| **PractitionerAvailability** | Weekly recurring availability of an optometrist in a store. weekday: 0 = Sunday … 6 = Saturday. | `weekday`, `startTime`, `endTime`, `validFrom`, `validTo`, `isActive` | User (`practitioner`) |
| **PractitionerTimeOff** |  | `startsAt`, `endsAt`, `reason` | User (`practitioner`) |
| **Appointment** |  | `number`, `status`, `source`, `startsAt`, `endsAt`, `guestName`, `guestEmail`, `guestPhone` …<br>unique: (storeId, number) | AppointmentType (`type`), User (`practitioner`), Customer (`customer`) |

## HUMAN RESOURCES

**Enums:** `EmployeeStatus` (ACTIVE, ON_LEAVE, TERMINATED), `ContractType` (CDI, CDD, ANAPEC, INTERNSHIP, FREELANCE), `SalaryPeriod` (MONTHLY, HOURLY), `AttendanceStatus` (PRESENT, LATE, ABSENT, LEAVE, HOLIDAY), `LeaveStatus` (PENDING, APPROVED, REJECTED, CANCELLED), `CommissionRateType` (PERCENT, FIXED), `CommissionScope` (ALL, CATEGORY, BRAND, PRODUCT_TYPE), `CommissionStatus` (PENDING, APPROVED, PAID, VOID), `PayrollStatus` (DRAFT, APPROVED, PAID), `PayslipLineKind` (EARNING, DEDUCTION, CONTRIBUTION, TAX)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Employee** |  | `userId`, `employeeNumber`, `firstName`, `lastName`, `socialSecurityNo`, `birthDate`, `hireDate`, `terminationDate` … | User (`user`), Employee (`manager`) |
| **EmploymentContract** |  | `type`, `startDate`, `endDate`, `baseSalary`, `salaryPeriod`, `hoursPerWeek`, `probationEnd`, `documentUrl` … | Employee (`employee`) |
| **AttendanceRecord** |  | `date`, `checkIn`, `checkOut`, `breakMinutes`, `workedMinutes`, `status`, `note`<br>unique: (employeeId, date) | Employee (`employee`) |
| **LeaveType** |  | `code`, `name`, `isPaid`, `annualDays`, `requiresApproval`, `isActive` | — |
| **LeaveRequest** |  | `startDate`, `endDate`, `days`, `status`, `reason`, `decidedAt`, `decisionNote` | Employee (`employee`), LeaveType (`leaveType`) |
| **CommissionRule** |  | `name`, `scope`, `productType`, `rateType`, `value`, `minSale`, `startsAt`, `endsAt` … | — |
| **CommissionEntry** |  | `baseAmount`, `amount`, `status`, `periodKey` | Employee (`employee`), CommissionRule (`rule`), Payslip (`payslip`) |
| **PayrollRun** |  | `periodKey`, `periodStart`, `periodEnd`, `status`, `totalGross`, `totalNet`, `approvedAt`, `paidAt` | — |
| **Payslip** |  | `number`, `baseSalary`, `commissions`, `bonuses`, `overtime`, `deductions`, `socialContrib`, `incomeTax` …<br>unique: (runId, employeeId); (number) | PayrollRun (`run`), Employee (`employee`) |
| **PayslipLine** |  | `kind`, `label`, `amount`, `sortOrder` | Payslip (`payslip`) |

## FINANCE

**Enums:** `ExpenseStatus` (DRAFT, APPROVED, PAID, REJECTED), `CashFlowDirection` (IN, OUT)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **ExpenseCategory** |  | `code`, `name`, `isActive` | ExpenseCategory (`parent`) |
| **BankAccount** |  | `name`, `bankName`, `iban`, `currency`, `openingBalance`, `isCashAccount`, `isActive`, `supplierPayments` | — |
| **Expense** |  | `number`, `description`, `amount`, `taxAmount`, `status`, `incurredAt`, `paidAt`, `attachmentUrl`<br>unique: (storeId, number) | ExpenseCategory (`category`), Supplier (`supplier`), BankAccount (`bankAccount`) |
| **CashFlowEntry** | Denormalised cash-flow ledger written whenever a payment / expense / refund is posted. | `direction`, `amount`, `source`, `refType`, `description`, `occurredAt` | BankAccount (`bankAccount`) |

## STOREFRONT CONTENT, BRANDING & TEMPLATES

**Enums:** `MenuItemType` (URL, PAGE, CATEGORY, BRAND, PRODUCT), `PublishStatus` (DRAFT, PUBLISHED, ARCHIVED), `HomeSectionType` (HERO_BANNER, BANNER_GRID, FEATURED_PRODUCTS, NEW_ARRIVALS, BRANDS, CATEGORIES, PROMO, TESTIMONIALS, STORES, BLOG_LATEST, RICH_TEXT, NEWSLETTER), `BannerPlacement` (HOME_HERO, HOME_SECONDARY, CATALOG_TOP, CHECKOUT, POPUP), `ContactMessageStatus` (NEW, READ, REPLIED, SPAM), `NotificationChannel` (IN_APP, EMAIL, SMS, WHATSAPP, PUSH)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Menu** |  | `code`, `name` | — |
| **MenuItem** |  | `type`, `label`, `url`, `openInNewTab`, `sortOrder`, `isActive`, `translations` | Menu (`menu`), MenuItem (`parent`) |
| **CmsPage** |  | `slug`, `title`, `content`, `status`, `template`, `showInFooter`, `seoTitle`, `seoDescription` … | — |
| **HomeSection** | Ordered, typed blocks that compose the storefront home page. | `type`, `title`, `subtitle`, `config`, `sortOrder`, `isActive`, `startsAt`, `endsAt` … | — |
| **Banner** |  | `placement`, `title`, `subtitle`, `imageUrl`, `mobileImageUrl`, `linkUrl`, `ctaLabel`, `sortOrder` … | — |
| **Testimonial** |  | `authorName`, `authorTitle`, `avatarUrl`, `content`, `rating`, `sortOrder`, `isActive`, `translations` | — |
| **BlogCategory** |  | `name`, `slug`, `translations` | — |
| **BlogPost** |  | `title`, `slug`, `excerpt`, `content`, `coverUrl`, `tags`, `status`, `seoTitle` … | BlogCategory (`category`) |
| **NewsletterSubscriber** |  | `email`, `locale`, `isActive`, `subscribedAt`, `unsubscribedAt` | — |
| **ContactMessage** |  | `name`, `email`, `phone`, `subject`, `message`, `status`, `repliedAt` | — |
| **BrandingSetting** | Single-row table (key = "default") holding the white-label brand identity. | `key`, `storeName`, `tagline`, `logoUrl`, `logoDarkUrl`, `faviconUrl`, `colors`, `fonts` … | — |
| **EmailTemplate** |  | `code`, `locale`, `subject`, `body`, `variables`, `isActive`<br>unique: (code, locale) | — |
| **SmsTemplate** | SMS and WhatsApp message templates. | `code`, `locale`, `channel`, `body`, `variables`, `isActive`<br>unique: (code, locale, channel) | — |
| **DocumentTemplate** | Invoice / receipt / quote layouts editable from the dashboard. | `type`, `name`, `locale`, `html`, `css`, `paperSize`, `settings`, `isDefault` … | — |

## OPERATIONS (notifications, outbox, scheduled jobs)

**Enums:** `NotificationStatus` (PENDING, SENT, FAILED, READ), `OutboxStatus` (PENDING, PROCESSING, DONE, FAILED)

| Model | Purpose | Key fields | References (FK) |
|---|---|---|---|
| **Notification** |  | `userId`, `channel`, `type`, `title`, `body`, `data`, `status`, `error` … | — |
| **OutboxMessage** | Transactional outbox: written in the same DB transaction as the business change, then relayed to BullMQ, so emails/SMS are never lost or sent for rolled-back work. | `queue`, `payload`, `dedupeKey`, `status`, `attempts`, `availableAt`, `processedAt`, `lastError` | — |
| **ScheduledJobLog** |  | `jobName`, `status`, `startedAt`, `finishedAt`, `durationMs`, `result`, `error` | — |
