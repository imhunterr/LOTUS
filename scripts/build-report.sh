#!/usr/bin/env bash
# Builds docs/LOTUS_Report.pdf and docs/LOTUS_Report.docx from docs/REPORT.md (needs pandoc + Chromium via Playwright).
set -euo pipefail
cd "$(dirname "$0")/../docs"
BODY=$(mktemp --suffix=.md)
# The cover page replaces the markdown title block (everything before the first '---').
awk 'f{print} /^---$/{f=1}' REPORT.md > "$BODY"
pandoc "$BODY" -f gfm -t html5 -s --toc --toc-depth=2 --metadata title="LOTUS Project Report" --metadata toc-title="Contents" \
  --css report.css --include-before-body report-cover.html --resource-path=. --embed-resources \
  -V pagetitle="LOTUS Project Report" -o LOTUS_Report.html
sed -i 's#<header id="title-block-header">.*</header>##; /<header id="title-block-header">/,/<\/header>/d' LOTUS_Report.html
node ../scripts/html-to-pdf.mjs LOTUS_Report.html LOTUS_Report.pdf
pandoc REPORT.md -f gfm -t docx --toc --resource-path=. -o LOTUS_Report.docx
rm -f "$BODY" LOTUS_Report.html
echo "Built docs/LOTUS_Report.pdf and docs/LOTUS_Report.docx"
