#!/usr/bin/env python3
"""
i18n guard for the Next apps. Fails (exit 1) when:
  * a locale file has different keys than fr.json (parity), or
  * source code calls t('ns.key') for a key missing from fr.json (static keys only).
Dynamic keys (t(`types.${x}`)) are listed as prefixes and must have at least one entry.
Usage: python3 scripts/check-i18n.py [--list-missing]
"""
import json, re, sys, glob, os
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
bad = 0

def flat(d, p=""):
    out = {}
    for k, v in d.items():
        out.update(flat(v, f"{p}{k}.") if isinstance(v, dict) else {f"{p}{k}": v})
    return out

for app in ("admin", "web"):
    msgs = {l: flat(json.load(open(f"{root}/apps/{app}/messages/{l}.json"))) for l in ("fr", "en", "ar")}
    for l in ("en", "ar"):
        miss, extra = set(msgs["fr"]) - set(msgs[l]), set(msgs[l]) - set(msgs["fr"])
        for k in sorted(miss): print(f"[{app}] {l}.json missing: {k}"); bad += 1
        for k in sorted(extra): print(f"[{app}] {l}.json extra:   {k}"); bad += 1
    empty = [k for l in msgs for k, v in msgs[l].items() if not str(v).strip()]
    for k in empty: print(f"[{app}] empty translation: {k}"); bad += 1
    used, prefixes = set(), set()
    for f in glob.glob(f"{root}/apps/{app}/src/**/*.ts*", recursive=True):
        src = open(f).read()
        # server: getTranslations('ns') / client: useTranslations('ns')
        for var, ns in re.findall(r"const (\w+) = (?:await )?(?:useTranslations|getTranslations)\('([\w.]+)'\)", src):
            for key in re.findall(rf"\b{var}\('([\w.]+)'", src): used.add(f"{ns}.{key}")
            for pre in re.findall(rf"\b{var}\(`([\w.]+?)\.?\$\{{", src): prefixes.add(f"{ns}.{pre}".rstrip("."))
    for k in sorted(used - set(msgs["fr"])): print(f"[{app}] used but undefined: {k}"); bad += 1
    for p in sorted(prefixes):
        if not any(k.startswith(p + ".") for k in msgs["fr"]): print(f"[{app}] dynamic prefix has no keys: {p}.*"); bad += 1
    print(f"[{app}] {len(msgs['fr'])} keys x 3 locales, {len(used)} static + {len(prefixes)} dynamic references checked")
sys.exit(1 if bad else 0)
