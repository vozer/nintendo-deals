#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/.."
requirements="docs/requirements.md"
use_cases="docs/use_cases.puml"
entities="docs/entity_model.md"

for file in "$requirements" "$use_cases" "$entities"; do
  [[ -s "$file" ]] || { echo "Missing AIUP artifact: $file" >&2; exit 1; }
done

awk -F'|' '
  /^\| (FR|NFR|C)-[0-9][0-9][0-9] \|/ {
    id=$2; gsub(/^[[:space:]]+|[[:space:]]+$/, "", id)
    if (seen[id]++) { print "Duplicate requirement ID: " id > "/dev/stderr"; failed=1 }
    count++
  }
  END { if (!count) { print "No stable requirement IDs found" > "/dev/stderr"; failed=1 }; exit failed }
' "$requirements"

grep -q '^@startuml' "$use_cases" && grep -q '^@enduml' "$use_cases" || {
  echo "Use-case diagram has no complete PlantUML boundary" >&2
  exit 1
}
grep -q '^```mermaid$' "$entities" && grep -q '^    GAME ' "$entities" || {
  echo "Entity model has no Mermaid ER diagram" >&2
  exit 1
}

base_ref="${AIUP_BASE_REF:-origin/main}"
if git rev-parse --verify "$base_ref" >/dev/null 2>&1; then
  changed_files="$({ git diff --name-only "$base_ref"; git diff --cached --name-only; git ls-files --others --exclude-standard; } | sort -u)"
  has_behavior=0
  has_docs=0
  while IFS= read -r file; do
    case "$file" in
      app/*|automation/*|components/*|lib/*|scripts/*) has_behavior=1 ;;
      docs/*) has_docs=1 ;;
    esac
  done <<< "$changed_files"
  if (( has_behavior && !has_docs )); then
    echo "Behavior changes detected without a docs/ specification update" >&2
    exit 1
  fi
fi

echo "AIUP docs check passed."
