#!/usr/bin/env bash
# Swotly pre-commit checks: per-file tsc syntax + import/export guard
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
KNOWN='TS2307|TS2792|TS2591|TS7006|TS7016|TS18046|TS2741|TS7053|TS7031|TS2339'
for f in App.tsx src/*.ts src/components/*.tsx src/screens/*.tsx; do
  OUT=$(npx tsc --noEmit --skipLibCheck --jsx react-native --esModuleInterop \
    --target es2020 --moduleResolution bundler --module esnext "$f" 2>&1 \
    | grep -E "\.tsx?\(" | grep -vE "$KNOWN" | grep -v "Type '{ key: string")
  if [ -n "$OUT" ]; then echo "$OUT"; FAIL=1; fi
done
python3 - <<'EOF' || FAIL=1
import re, os, glob, sys
files = glob.glob('src/**/*.ts*', recursive=True) + ['App.tsx']
exports = {}
for f in files:
    src = open(f).read(); mod = os.path.splitext(f)[0]
    names = set(re.findall(r'export (?:async )?(?:function|const|class|type|interface|enum) (\w+)', src))
    for grp in re.findall(r'export \{([^}]+)\}', src):
        names |= {n.strip().split(' as ')[-1] for n in grp.split(',') if n.strip()}
    if re.search(r'export default', src): names.add('default')
    exports[mod] = names
bad = 0
for f in files:
    src = open(f).read()
    for m in re.finditer(r'import\s+(?:(\w+)\s*,\s*)?\{([^}]*)\}\s+from\s+"(\.[^"]+)"|import\s+(\w+)\s+from\s+"(\.[^"]+)"', src):
        d1, named, p1, d2, p2 = m.groups(); path = p1 or p2
        target = os.path.normpath(os.path.join(os.path.dirname(f), path))
        if target not in exports: continue
        if named:
            for n in [x.strip().split(' as ')[0] for x in named.split(',') if x.strip()]:
                if n not in exports[target]: print(f"MISSING: {f} imports {n} from {path}"); bad += 1
        if (d1 or d2) and 'default' not in exports[target]: print(f"MISSING default: {f} <- {path}"); bad += 1
print("export-guard:", "OK" if bad == 0 else f"{bad} problems")
sys.exit(1 if bad else 0)
EOF
[ $FAIL -eq 0 ] && echo "✅ checks passed" || { echo "❌ checks FAILED"; exit 1; }
