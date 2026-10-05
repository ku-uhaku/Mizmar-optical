-- Customer gender is MALE or FEMALE only. Postgres cannot drop enum values, so recreate the type.
-- Any other value (only ever set by the short-lived 8-option list) becomes "not set".
ALTER TYPE "CustomerGender" RENAME TO "CustomerGender_old";
CREATE TYPE "CustomerGender" AS ENUM ('MALE', 'FEMALE');
ALTER TABLE "Customer"
  ALTER COLUMN "gender" TYPE "CustomerGender"
  USING (CASE "gender"::text WHEN 'MALE' THEN 'MALE' WHEN 'FEMALE' THEN 'FEMALE' ELSE NULL END)::"CustomerGender";
DROP TYPE "CustomerGender_old";
