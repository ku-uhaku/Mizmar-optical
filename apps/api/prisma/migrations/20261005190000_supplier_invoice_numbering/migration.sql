-- Supplier invoices get their own per-store document numbering series.
ALTER TYPE "DocumentType" ADD VALUE 'SUPPLIER_INVOICE';
