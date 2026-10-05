#!/usr/bin/env python3
"""Generate docs/schema.md from apps/api/prisma/schema/*.prisma (run: python3 scripts/gen-schema-doc.py)."""
import re, glob, os

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
files = sorted(glob.glob(f"{root}/apps/api/prisma/schema/[0-9][0-9]_*.prisma"))
SYSTEM = {"id", "createdAt", "updatedAt", "deletedAt"}
out = []
tot_models = tot_enums = 0
sections = []

for f in files:
    src = open(f).read()
    title = re.search(r"// \d+\. (.+)", src)
    if not title:
        continue
    title = title.group(1).strip()
    enums = re.findall(r"^enum (\w+) \{(.*?)^\}", src, re.S | re.M)
    models = re.findall(r"((?:^///[^\n]*\n)*)^model (\w+) \{(.*?)^\}", src, re.S | re.M)
    tot_models += len(models); tot_enums += len(enums)
    names = {m[1] for m in re.findall(r"((?:^///.*\n)*)^model (\w+) \{", src, re.M)}
    sec = [f"## {title}\n"]
    if enums:
        sec.append("**Enums:** " + ", ".join(
            f"`{n}` ({', '.join(v.split()[0] for v in body.strip().splitlines() if v.strip() and not v.strip().startswith('//'))})"
            for n, body in enums) + "\n")
    sec.append("| Model | Purpose | Key fields | References (FK) |\n|---|---|---|---|")
    for doc, name, body in models:
        purpose = " ".join(l[3:].strip() for l in doc.strip().splitlines()) or ""
        fields, rels = [], []
        for line in body.splitlines():
            line = line.split("//")[0].strip()
            if not line or line.startswith("@@"):
                continue
            parts = line.split()
            if len(parts) < 2:
                continue
            fname, ftype = parts[0], parts[1]
            if "@relation" in line and "fields:" in line:
                rels.append(f"{ftype.rstrip('?')} (`{fname}`)")
            elif fname not in SYSTEM and not ftype.rstrip("?[]") in names and "@relation" not in line:
                if not fname.endswith("Id") or fname in ("userId",):
                    fields.append(fname)
        key = ", ".join(f"`{x}`" for x in fields[:8]) + (" …" if len(fields) > 8 else "")
        uniq = re.findall(r"@@unique\(\[(.*?)\]\)", body)
        if uniq:
            key += "<br>unique: " + "; ".join(f"({u})" for u in uniq)
        out_rels = ", ".join(rels) if rels else "—"
        sec.append(f"| **{name}** | {purpose} | {key} | {out_rels} |")
    sections.append("\n".join(sec) + "\n")

header = f"""# Mizmar Optical — Database Schema

_Generated from `apps/api/prisma/schema/*.prisma` by `scripts/gen-schema-doc.py`. Do not edit by hand._

**{tot_models} models · {tot_enums} enums · PostgreSQL 17 · Prisma 7**

## Conventions (every model)

- `id` cuid · `createdAt` · `updatedAt` · `deletedAt` (soft delete, filtered by the Prisma client extension).
- Money `Decimal(12,2)`; optical measures `Decimal(5,2)`; PD `Decimal(4,1)`.
- Transactional tables carry `storeId` (indexed) → multi-branch scoping. Document numbers are unique per store: `@@unique([storeId, number])`.
- Translatable content: base columns hold French; `translations Json?` holds `{{ ar: {{…}}, en: {{…}} }}`.
- `createdById`-style columns are plain scalars (no FK) to avoid a User back-relation explosion and to survive user soft-deletes.
- Unique business keys (`User.email`, `ProductVariant.sku`) are globally unique; on soft delete the service suffixes the value to release it.
- Order totals are stored (`subtotal/discountTotal/taxTotal/shippingTotal/total/paidTotal/balanceDue`); `balanceDue > 0` models a prescription order with a deposit.
- Snapshots (`prescriptionSnapshot`, line `taxRatePct`, `unitCost`, lens-treatment name/price) keep history stable when catalog data changes.

"""
open(f"{root}/docs/schema.md", "w").write(header + "\n".join(sections))
print(tot_models, "models", tot_enums, "enums")
