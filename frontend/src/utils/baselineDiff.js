// ============================================================================
//  baselineDiff.js — Baseline fark raporunun sunumu ve disa aktarimi (#128).
//
//  SAF yardimcilar: sayfa (pages/Snapshots.jsx) yalnizca bu fonksiyonlari
//  cagirir. Fark HESABI backend'dedir (src/baselines.js) — burasi yalnizca
//  gosterim/bicimlendirme ve CSV/PDF uretimidir.
//
//  NEDEN DISA AKTARIM? Fark raporu bir DENETIM KAYDIDIR: "v1.0 ile v2.0
//  arasinda ne degisti" sorusunun cevabi, uygulamanin disinda da saklanabilir
//  olmali (DO-178C degisiklik yonetimi).
// ============================================================================

const CSV_SEPARATOR = ','

/** Fark durumlari — backend baselines.js DIFF_STATUS ile birebir ayni. */
export const DIFF_STATUS = { ADDED: 'added', REMOVED: 'removed', CHANGED: 'changed' }

/** Varlik tiplerinin gosterim sirasi ve i18n anahtarlari. */
export const DIFF_ENTITY_TYPES = [
  { key: 'requirement', labelKey: 'diff.entity.requirement' },
  { key: 'testcase', labelKey: 'diff.entity.testcase' },
  { key: 'link', labelKey: 'diff.entity.link' },
  // Bir ucu baseline KAPSAMI DISINDA kalan bag (#128): geri yuklenmez ama
  // izlenebilirlik zinciri icin farkta ve raporda yer alir.
  { key: 'externalLink', labelKey: 'diff.entity.externalLink' },
  { key: 'glossary', labelKey: 'diff.entity.glossary' },
  { key: 'attributeDef', labelKey: 'diff.entity.attributeDef' },
]

/**
 * Bir alan degerini rapor icin okunabilir metne cevirir.
 * Uzun metinler KIRPILMAZ (denetim kaydi eksik olmamali); yalnizca yapisal
 * degerler (dizi/nesne/bos) insan okunur hale getirilir.
 */
export function formatDiffValue(value, { emptyLabel = '—' } = {}) {
  if (value === null || value === undefined || value === '') return emptyLabel
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) return value.length === 0 ? emptyLabel : value.join(', ')
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** Bir fark satirindaki alan degisikliklerini "alan: eski -> yeni" olarak birlestirir. */
export function describeFields(fields, { emptyLabel = '—' } = {}) {
  return (fields || [])
    .map(
      (f) =>
        `${f.field}: ${formatDiffValue(f.from, { emptyLabel })} -> ${formatDiffValue(f.to, { emptyLabel })}`,
    )
    .join(' | ')
}

/** Rozet/sayac icin: yalnizca degisiklik iceren tipler. */
export function changedEntityTypes(summary) {
  return DIFF_ENTITY_TYPES.filter((e) => {
    const s = summary?.[e.key]
    return s && (s.added > 0 || s.removed > 0 || s.changed > 0)
  })
}

/** Fark girdilerini duruma gore filtreler ('all' => hepsi). */
export function filterEntries(entries, { status = 'all', entityType = 'all', query = '' } = {}) {
  const q = String(query || '')
    .trim()
    .toLocaleLowerCase('tr')
  return (entries || []).filter((e) => {
    if (status !== 'all' && e.status !== status) return false
    if (entityType !== 'all' && e.entityType !== entityType) return false
    if (!q) return true
    return (
      String(e.label || '')
        .toLocaleLowerCase('tr')
        .includes(q) ||
      (e.fields || []).some((f) => String(f.field).toLocaleLowerCase('tr').includes(q))
    )
  })
}

function csvCell(value) {
  const text = String(value ?? '')
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Fark raporunu CSV'ye cevirir. BOM ile baslar (Excel Turkce karakterleri
 * dogru okusun) ve CRLF kullanir — traceability disa aktarimiyla ayni desen.
 */
export function diffToCsv(diff, { headers, labelOf = (s) => s, emptyLabel = '—' } = {}) {
  const lines = [headers.map(csvCell).join(CSV_SEPARATOR)]
  for (const entry of diff?.entries || []) {
    lines.push(
      [
        labelOf(entry.entityType),
        entry.label,
        labelOf(entry.status),
        describeFields(entry.fields, { emptyLabel }),
      ]
        .map(csvCell)
        .join(CSV_SEPARATOR),
    )
  }
  // BOM KACIS DIZISI olarak yazilir (duz karakter ESLint'in
  // no-irregular-whitespace kuralina takilir); Excel Turkce karakterleri
  // ancak BOM ile dogru okur — utils/components.js ile ayni desen.
  return `\ufeff${lines.join('\r\n')}\r\n`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Yazdirma (PDF) icin bagimsiz HTML belgesi. PDF, tarayicinin "PDF olarak
 * kaydet" hedefiyle uretilir — ek kutuphane bagimliligi getirmemek icin
 * bilincli tercih (bkz. utils/components.js ile ayni yaklasim).
 */
export function buildDiffPrintHtml({
  documentTitle,
  projectName,
  fromLabel,
  toLabel,
  summaryText,
  headers,
  diff,
  labelOf = (s) => s,
  emptyLabel = '—',
  generatedAt = new Date(),
}) {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = (diff?.entries || [])
    .map(
      (entry) =>
        `<tr class="${escapeHtml(entry.status)}">` +
        `<td>${escapeHtml(labelOf(entry.entityType))}</td>` +
        `<td class="mono">${escapeHtml(entry.label)}</td>` +
        `<td class="num">${escapeHtml(labelOf(entry.status))}</td>` +
        `<td>${escapeHtml(describeFields(entry.fields, { emptyLabel }))}</td></tr>`,
    )
    .join('')
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8" />
<title>${escapeHtml(documentTitle)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; font-size: 11px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 10px 0 2px; }
  .meta { color: #64748b; font-size: 10px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #1e293b; color: #fff; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
  tr.added td { background: #ecfdf5; }
  tr.removed td { background: #fef2f2; }
  tr.changed td { background: #fffbeb; }
  .mono { font-family: ui-monospace, "JetBrains Mono", monospace; white-space: nowrap; }
  .num { white-space: nowrap; text-align: center; }
  tr { break-inside: avoid; }
  thead { display: table-header-group; }
</style></head>
<body>
  <h1>${escapeHtml(documentTitle)}</h1>
  <div class="meta">${escapeHtml(projectName || '')} · ${escapeHtml(
    generatedAt.toLocaleString('tr-TR'),
  )}</div>
  <h2>${escapeHtml(fromLabel)} → ${escapeHtml(toLabel)}</h2>
  <div class="meta">${escapeHtml(summaryText)}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`
}

/** Dosya adi icin sadelestirilmis etiket (Turkce harfler ASCII'ye duser). */
export function slugifyLabel(text, fallback = 'fark') {
  // Turkce harfler toLowerCase'DEN ONCE degistirilir: 'İ'.toLowerCase()
  // birlesik noktali bir dizi ('i' + U+0307) uretir ve sonradan yapilan
  // degistirme artik eslesmez — birlesik nokta da ayirica donusup adi bozar.
  const slug = String(text || '')
    .replace(/[İIı]/g, 'i')
    .replace(/[şŞ]/g, 's')
    .replace(/[ğĞ]/g, 'g')
    .replace(/[üÜ]/g, 'u')
    .replace(/[öÖ]/g, 'o')
    .replace(/[çÇ]/g, 'c')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || fallback
}
