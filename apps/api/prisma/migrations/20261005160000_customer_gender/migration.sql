-- Customers get their own, inclusive, optional gender list (the old column reused the PRODUCT audience enum).
CREATE TYPE "CustomerGender" AS ENUM ('MALE', 'FEMALE', 'NON_BINARY', 'TRANS_MAN', 'TRANS_WOMAN', 'GENDERQUEER', 'OTHER', 'PREFER_NOT_TO_SAY');

-- Convert in place, keeping existing data: MEN -> MALE, WOMEN -> FEMALE. UNISEX / KIDS were never meaningful for a person, so they become "not set".
ALTER TABLE "Customer"
  ALTER COLUMN "gender" TYPE "CustomerGender"
  USING (CASE "gender"::text WHEN 'MEN' THEN 'MALE' WHEN 'WOMEN' THEN 'FEMALE' ELSE NULL END)::"CustomerGender";
