// ============================================================================
//  components.js  —  Issue #129: "Bileşenler" (bileşen bazli gorunum) icin
//  SAF yardimcilar. Sayfa (pages/Components.jsx) yalnizca bu fonksiyonlari
//  cagirir; hesap burada tek yerde durur ve kolayca test edilir.
//
//  BILESEN NEREDEN GELIR?
//    Issue notunda "Alan (field) mi, ayri bir oznitelik mi, yoksa PBS agaci
//    mi?" sorusu uygulama sirasinda netlesecekti. Karar: BIRINCIL KAYNAK PBS
//    AGACIDIR (Requirement.parentId) — urun kirilimi zaten orada tutuluyor ve
//    "Su Pompasi Unitesi" gibi bir dugumun ALTINDAKI her sey, hiyerarsi
//    seviyesinden bagimsiz olarak, o bilesenin gereksinimidir. Yeni bir alan
//    ya da migration GEREKMEZ.
//    Ikincil kaynak: ALAN (field). Urun agaci kurulmamis projelerde (tum
//    kayitlar kok seviyede) PBS hic bilesen uretmez; orada disiplin/alan
//    bazli gruplama ayni ekrani calisir halde tutar. Kullanici iki kaynak
//    arasinda gecebilir.
//
//  TID NO: PbsTree ile AYNI anahat numarasi (1, 2.1, 2.1.2.1 ...). Kardesler
//  backend tree.js ile ayni sekilde text_id'ye gore siralanir, boylece agac
//  sayfasindaki numara ile bu sayfadaki numara BIREBIR ortusur.
// ============================================================================
import { LINK_TYPE } from './constants.js'
import { getDisplayLabel, stripHtml, truncate } from './format.js'
import { VERIFICATION, verificationOf } from './verification.js'

export const ROOT_KEY = '__root__'

/** Bilesen listesinin turetildigi kaynak. */
export const COMPONENT_SOURCE = { PBS: 'pbs', FIELD: 'field' }

/** Alani (disiplini) bos olan kayitlarin toplandigi sanal bilesen anahtari. */
export const FIELD_NONE_KEY = '__nofield__'

// --- Dogrulama yontemi (T / M / D / A / CoC) --------------------------------
//  TID tablosunun son sutunu. Proje bazli modular bir oznitelikte (orn.
//  "Doğrulama Yöntemi") tutuluyorsa ORADAN okunur; tanimli degilse kayda
//  bagli test senaryolarindan TURETILIR (test varsa yontem = T) ve UI bunu
//  "türetilmiş" olarak isaretler. Uydurma yapilmaz: ikisi de yoksa bos kalir.
export const VERIFICATION_METHODS = ['T', 'M', 'D', 'A', 'CoC']

export const VERIFICATION_METHOD_LABEL_KEY = {
  T: 'comp.method.T',
  M: 'comp.method.M',
  D: 'comp.method.D',
  A: 'comp.method.A',
  CoC: 'comp.method.CoC',
}

const METHOD_ALIASES = new Map([
  ['t', 'T'],
  ['test', 'T'],
  ['testing', 'T'],
  ['deney', 'T'],
  ['m', 'M'],
  ['muayene', 'M'],
  ['inspection', 'M'],
  ['inceleme', 'M'],
  ['d', 'D'],
  ['demo', 'D'],
  ['demonstrasyon', 'D'],
  ['demonstration', 'D'],
  ['gosterim', 'D'],
  ['a', 'A'],
  ['analiz', 'A'],
  ['analysis', 'A'],
  ['benzetim', 'A'],
  ['coc', 'CoC'],
  ['cofc', 'CoC'],
  ['uygunlukbeyani', 'CoC'],
  ['certificateofconformance', 'CoC'],
])

/** Karsilastirma icin sadelestirir: kucuk harf + Turkce harfler + yalniz [a-z0-9]. */
function normalizeToken(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]/g, '')
}

const EXACT_METHOD_KEYS = new Set([
  'verificationmethod',
  'methodofverification',
  'dogrulamayontemi',
  'dogrulamametodu',
  'verifikasyonyontemi',
])
const METHOD_SUBJECT_WORDS = ['verification', 'dogrulama', 'verifikasyon']
const METHOD_NOUN_WORDS = ['method', 'yontem', 'metod', 'metot']

/**
 * Bir oznitelik tanimi "dogrulama yontemi" mi? Hem anahtar hem etiket
 * denenir; "Doğrulama Durumu" gibi yakin ama ALAKASIZ tanimlar elenir
 * (hem konu hem de "yöntem" sozcugu bulunmalidir).
 */
function isMethodDef(def) {
  const key = normalizeToken(def?.key)
  const label = normalizeToken(def?.label)
  if (EXACT_METHOD_KEYS.has(key) || EXACT_METHOD_KEYS.has(label)) return true
  const looksLikeMethod = (s) =>
    Boolean(s) &&
    METHOD_SUBJECT_WORDS.some((w) => s.includes(w)) &&
    METHOD_NOUN_WORDS.some((w) => s.includes(w))
  return looksLikeMethod(key) || looksLikeMethod(label)
}

/** Projede tanimliysa dogrulama yontemi ozniteliklerinin anahtarlari. */
export function methodAttributeKeys(attributeDefs) {
  return (attributeDefs || [])
    .filter((d) => d?.entityType === 'requirement' || d?.entityType === 'both')
    .filter(isMethodDef)
    .map((d) => d.key)
}

/** Serbest metni standart koda cevirir ("Muayene" -> 'M'); taninmazsa null. */
export function methodCodeOf(value) {
  const token = normalizeToken(value)
  if (!token) return null
  return METHOD_ALIASES.get(token) || null
}

/**
 * Bir gereksinimin dogrulama yontemi.
 * @returns {{code:string, raw:string|null, derived:boolean}|null}
 *   derived=true: oznitelik yok, bagli test senaryolarindan turetildi.
 */
export function verificationMethodOf(row, { methodKeys = [], verification = null } = {}) {
  const bag = row?.attributes || {}
  for (const key of methodKeys) {
    const raw = bag[key] ?? row?.[key]
    const code = methodCodeOf(raw)
    if (code) return { code, raw: raw == null ? null : String(raw), derived: false }
  }
  if (verification && verification.total > 0) return { code: 'T', raw: null, derived: true }
  return null
}

// --- PBS agaci (duz `requirements` listesinden) -----------------------------

const byTextId = (a, b) =>
  String(a.text_id || '').localeCompare(String(b.text_id || ''), undefined, { numeric: true })

/**
 * Duz gereksinim listesinden tek-ebeveynli PBS agacini kurar ve her dugum
 * icin anahat (TID) numarasi + derinlik hesaplar.
 *
 * Ebeveyni listede OLMAYAN kayit (silinmis ya da ABAC ile gizlenmis ust)
 * KOK sayilir — aksi halde gorunmez bir ust yuzunden hic listelenemezdi.
 *
 * @returns {{byId:Map, childrenOf:Map, infoById:Map, roots:Array}}
 *   infoById: id -> { outline, depth, parentKey }
 */
export function buildRequirementTree(requirements) {
  const list = requirements || []
  const byId = new Map(list.map((r) => [r.id, r]))
  const childrenOf = new Map()
  for (const r of list) {
    const parentKey =
      r.parentId && byId.has(r.parentId) && r.parentId !== r.id ? r.parentId : ROOT_KEY
    if (!childrenOf.has(parentKey)) childrenOf.set(parentKey, [])
    childrenOf.get(parentKey).push(r)
  }
  for (const nodes of childrenOf.values()) nodes.sort(byTextId)

  const infoById = new Map()
  const walk = (key, depth, prefix) => {
    const nodes = childrenOf.get(key) || []
    nodes.forEach((node, i) => {
      // Dongu koruyucusu: bozuk parentId zinciri sonsuz ozyinelemeye dusmesin.
      if (infoById.has(node.id)) return
      const outline = prefix ? `${prefix}.${i + 1}` : String(i + 1)
      infoById.set(node.id, { outline, depth, parentKey: key })
      walk(node.id, depth + 1, outline)
    })
  }
  walk(ROOT_KEY, 0, '')

  return { byId, childrenOf, infoById, roots: childrenOf.get(ROOT_KEY) || [] }
}

/** Bir dugum + TUM alt kirilimi, anahat sirasinda (agactaki gorunus sirasi). */
export function subtreeRows(tree, nodeId) {
  const out = []
  const seen = new Set()
  const walk = (id) => {
    if (seen.has(id)) return
    seen.add(id)
    const node = tree.byId.get(id)
    if (node) out.push(node)
    for (const child of tree.childrenOf.get(id) || []) walk(child.id)
  }
  walk(nodeId)
  return out
}

// --- Bilesen listesi --------------------------------------------------------

/**
 * Secilebilir bilesenler.
 *
 * PBS kaynagi: ALT KIRILIMI OLAN her dugum bir bilesendir ("Basınç Pompası
 * Ünitesi" gibi). Bilesenin gereksinimleri = dugumun KENDISI + tum alt agaci
 * (User / System / Sub-system hepsi bir arada — istenen tam olarak budur).
 * Alan kaynagi: her Alan (disiplin) degeri bir bilesendir.
 *
 * @returns {Array<{key,label,outline,depth,node,rows}>}
 */
export function buildComponents(requirements, { source = COMPONENT_SOURCE.PBS, tree } = {}) {
  const t = tree || buildRequirementTree(requirements)
  if (source === COMPONENT_SOURCE.FIELD) return fieldComponents(requirements, t)

  const out = []
  const walk = (key) => {
    for (const node of t.childrenOf.get(key) || []) {
      const children = t.childrenOf.get(node.id) || []
      if (children.length > 0) {
        const info = t.infoById.get(node.id)
        out.push({
          key: node.id,
          label: getDisplayLabel(node).text || node.text_id,
          outline: info?.outline || '',
          depth: info?.depth ?? 0,
          node,
          rows: subtreeRows(t, node.id),
        })
        walk(node.id)
      }
    }
  }
  walk(ROOT_KEY)
  return out
}

function fieldComponents(requirements, tree) {
  const groups = new Map()
  for (const r of requirements || []) {
    const name = String(r.field || '').trim()
    const key = name || FIELD_NONE_KEY
    if (!groups.has(key))
      groups.set(key, { key, label: name, outline: '', depth: 0, node: null, rows: [] })
    groups.get(key).rows.push(r)
  }
  const outlineOf = (r) => tree.infoById.get(r.id)?.outline || ''
  const list = [...groups.values()]
  for (const g of list) {
    g.rows.sort((a, b) => {
      const oa = outlineOf(a)
      const ob = outlineOf(b)
      if (oa && ob && oa !== ob) return compareOutline(oa, ob)
      return byTextId(a, b)
    })
  }
  // Alansizlar her zaman en sonda; digerleri ada gore.
  return list.sort((a, b) => {
    if (a.key === FIELD_NONE_KEY) return 1
    if (b.key === FIELD_NONE_KEY) return -1
    return a.label.localeCompare(b.label, 'tr')
  })
}

/** "2.10" > "2.9" olacak sekilde anahat numarasi karsilastirmasi. */
export function compareOutline(a, b) {
  const pa = String(a).split('.').map(Number)
  const pb = String(b).split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const va = pa[i] ?? -1
    const vb = pb[i] ?? -1
    if (va !== vb) return va - vb
  }
  return 0
}

// --- Bagli SGD (izlenebilirlik baglari) -------------------------------------

/**
 * Satisfies baglarindan gereksinim -> { up, down } id indeksi.
 * Depolama yonu sabittir: fromId = UST gereksinim, toId = ALT gereksinim.
 */
export function buildSatisfiesIndex(links) {
  const index = new Map()
  const slot = (id) => {
    if (!index.has(id)) index.set(id, { up: [], down: [] })
    return index.get(id)
  }
  for (const l of links || []) {
    if (l?.type !== LINK_TYPE.SATISFIES) continue
    slot(l.toId).up.push(l.fromId)
    slot(l.fromId).down.push(l.toId)
  }
  return index
}

/** Bagli ust/alt kayitlarin text_id listeleri (yalnizca bu projede duranlar). */
export function linkedTextIds(index, id, byId) {
  const entry = index?.get(id)
  const map = (ids) =>
    [...new Set(ids || [])]
      .map((rid) => byId.get(rid)?.text_id)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  return { up: map(entry?.up), down: map(entry?.down) }
}

// --- Tablo satirlari + ozet -------------------------------------------------

/** Gereksinim metni onizlemesi (HTML'den arindirilmis, kisaltilmis). */
const TEXT_PREVIEW_MAX = 220

/**
 * Bilesen tablosunun satirlari — TID tablosu duzeni:
 * TID No / Text ID / Baslik / Gereksinim Metni / Bagli SGD / Dogrulama yontemi.
 */
export function buildComponentViewRows(rows, ctx) {
  const { tree, satisfiesIndex, verificationIndex, methodKeys = [] } = ctx || {}
  return (rows || []).map((r) => {
    const verification = verificationOf(verificationIndex, r.id)
    const linked = linkedTextIds(satisfiesIndex, r.id, tree.byId)
    const label = getDisplayLabel(r)
    const plain = stripHtml(r.description || '')
    return {
      id: r.id,
      row: r,
      outline: tree.infoById.get(r.id)?.outline || '',
      text_id: r.text_id || '',
      title: label.isFallback ? '' : label.text,
      titleIsFallback: label.isFallback,
      text: plain,
      textPreview: truncate(plain, TEXT_PREVIEW_MAX),
      linkedUp: linked.up,
      linkedDown: linked.down,
      linkedText: [...linked.up.map((x) => `↑ ${x}`), ...linked.down.map((x) => `↓ ${x}`)].join(
        ', ',
      ),
      verification,
      method: verificationMethodOf(r, { methodKeys, verification }),
    }
  })
}

/** Bilesen basligindaki ozet: "12 gereksinim · 8 doğrulandı". */
export function summarizeComponent(rows, verificationIndex) {
  let verified = 0
  for (const r of rows || []) {
    if (verificationOf(verificationIndex, r.id).state === VERIFICATION.VERIFIED) verified += 1
  }
  return { total: (rows || []).length, verified }
}

// --- Disa aktarim -----------------------------------------------------------

const CSV_SEPARATOR = ','

function csvCell(value) {
  const text = String(value ?? '')
  return /["\n\r,;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/**
 * Bilesen listesini CSV'ye cevirir. Basina BOM eklenir: Excel dosyayi
 * UTF-8 olarak acsin (aksi halde Turkce karakterler bozulur).
 */
export function componentRowsToCsv(viewRows, { headers, methodLabel = (c) => c } = {}) {
  const lines = [headers.map(csvCell).join(CSV_SEPARATOR)]
  for (const v of viewRows || []) {
    lines.push(
      [
        v.outline,
        v.text_id,
        v.title,
        v.text,
        v.linkedText,
        v.method ? methodLabel(v.method.code) : '',
      ]
        .map(csvCell)
        .join(CSV_SEPARATOR),
    )
  }
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
 * kaydet" yazdirma hedefiyle uretilir — ek bir kutuphane bagimliligi
 * getirmemek icin bilincli bir tercih (bkz. MindMap PNG/SVG disa aktarimi).
 */
export function buildComponentPrintHtml({
  documentTitle,
  projectName,
  componentLabel,
  summary,
  headers,
  viewRows,
  methodLabel = (c) => c,
  generatedAt = new Date(),
}) {
  const head = headers.map((h) => `<th>${escapeHtml(h)}</th>`).join('')
  const body = (viewRows || [])
    .map(
      (v) =>
        `<tr><td class="num">${escapeHtml(v.outline)}</td><td class="mono">${escapeHtml(
          v.text_id,
        )}</td><td>${escapeHtml(v.title)}</td><td>${escapeHtml(v.text)}</td><td class="mono">${escapeHtml(
          v.linkedText,
        )}</td><td class="num">${escapeHtml(v.method ? methodLabel(v.method.code) : '—')}</td></tr>`,
    )
    .join('')
  return `<!doctype html>
<html lang="tr"><head><meta charset="utf-8" />
<title>${escapeHtml(documentTitle)} — ${escapeHtml(componentLabel)}</title>
<style>
  @page { size: A4 landscape; margin: 14mm; }
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; font-size: 11px; }
  h1 { font-size: 16px; margin: 0 0 2px; }
  h2 { font-size: 13px; margin: 10px 0 2px; }
  .meta { color: #64748b; font-size: 10px; margin-bottom: 10px; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #cbd5e1; padding: 4px 6px; text-align: left; vertical-align: top; }
  th { background: #f1f5f9; font-size: 10px; text-transform: uppercase; letter-spacing: .03em; }
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
  <h2>${escapeHtml(componentLabel)}</h2>
  <div class="meta">${escapeHtml(summary)}</div>
  <table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>
</body></html>`
}

/** Dosya adi icin sadelestirilmis etiket (Turkce harfler ASCII'ye duser). */
export function slugify(text, fallback = 'bilesen') {
  const slug = String(text || '')
    .toLowerCase()
    .replace(/İ/g, 'i')
    .replace(/ı/g, 'i')
    .replace(/ş/g, 's')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || fallback
}
