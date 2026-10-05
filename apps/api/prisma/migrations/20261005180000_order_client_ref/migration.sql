-- Idempotent POS checkout: the same clientRef within a store maps to one order.
ALTER TABLE "Order" ADD COLUMN "clientRef" TEXT;
CREATE UNIQUE INDEX "Order_storeId_clientRef_key" ON "Order"("storeId", "clientRef");
