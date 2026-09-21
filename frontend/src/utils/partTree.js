// ============================================================================
//  partTree.js — Bilesen (parca) agaci icin SAF yardimcilar (Issue #135).
//
//  Sayfa (pages/ComponentTree.jsx) yalnizca bu fonksiyonlari cagirir: agac
//  kurulumu, arama ve tutarlilik rozetleri burada birim testlenebilir halde
//  durur. DOM/React bagimliligi YOKTUR.
//
//  NEDEN TUM AGAC TEK SEFERDE? PBS gereksinim agaci (useTreeNodes) lazy-load
//  edilir cunku binlerce gereksinim olabilir. Bilesen agaci ise urun
//  kirilimidir — yuzler mertebesindedir ve ARAMA ile TUTARLILIK RAPORU zaten
//  tum dugumleri gormek zorundadir. Bu yuzden tek liste cekilip burada
//  agaclanir.
// ============================================================================

/** Ayni ust altindaki kardesleri sabit bir siraya koyar: once order, sonra Parca No. */
const bySortKey = (a, b) =>
  (a.order ?? 0) - (b.order ?? 0) ||
  String(a.partNo || '').localeCompare(String(b.partNo || '')) ||
  String(a.name || '').localeCompare(String(b.name || ''), 'tr')

/**
 * Duz listeden agac kurar.
 * Ustu listede BULUNMAYAN dugumler (orphan) KAYBOLMAZ — kok seviyede
 * gosterilirler; aksi halde tutarlilik raporunun isaret ettigi kayit
 * ekranda hic gorunmezdi.
 * @param {Array} rows
 * @returns {Array} kok dugumler ({ ...row, children: [] })
 */
export function buildComponentTree(rows) {
  const nodes = new Map((rows || []).map((r) => [r.id, { ...r, children: [] }]))
  const roots = []
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : null
    if (parent && parent.id !== node.id) parent.children.push(node)
    else roots.push(node)
  }
  const sortDeep = (list) => {
    list.sort(bySortKey)
    for (const n of list) sortDeep(n.children)
    return list
  }
  return sortDeep(roots)
}

/** Bir dugum arama metnine uyuyor mu? Ad VEYA Parca No uzerinden. */
export function matchesQuery(row, query) {
  const q = String(query || '')
    .trim()
    .toLocaleLowerCase('tr')
  if (!q) return true
  return (
    String(row.name || '')
      .toLocaleLowerCase('tr')
      .includes(q) ||
    String(row.partNo || '')
      .toLocaleLowerCase('tr')
      .includes(q)
  )
}

/**
 * Aramayi agac uzerinde uygular. Eslesen dugumun USTLERI de korunur (yoksa
 * sonuc baglamsiz kalirdi) ve eslesen dugumun ALTI oldugu gibi durur.
 * @returns {Array} filtrelenmis kok dugumler
 */
export function filterComponentTree(roots, query) {
  const q = String(query || '').trim()
  if (!q) return roots
  const walk = (node) => {
    const children = node.children.map(walk).filter(Boolean)
    if (matchesQuery(node, q) || children.length > 0) {
      return { ...node, children: matchesQuery(node, q) ? node.children : children }
    }
    return null
  }
  return (roots || []).map(walk).filter(Boolean)
}

/**
 * Agaci ekranda cizilecek SIRALI satir listesine acar. Kapali dugumlerin
 * altlari atlanir.
 * @param {Array} roots
 * @param {Set<string>} expanded acik dugum id'leri
 * @returns {Array<{node, depth, hasChildren}>}
 */
export function flattenComponentTree(roots, expanded) {
  const out = []
  const walk = (node, depth) => {
    const hasChildren = node.children.length > 0
    out.push({ node, depth, hasChildren })
    if (hasChildren && expanded?.has(node.id)) {
      for (const child of node.children) walk(child, depth + 1)
    }
  }
  for (const root of roots || []) walk(root, 0)
  return out
}

/** Agactaki TUM dugum id'leri (hepsini ac/kapat icin). */
export function allNodeIds(roots) {
  const ids = []
  const walk = (n) => {
    ids.push(n.id)
    n.children.forEach(walk)
  }
  ;(roots || []).forEach(walk)
  return ids
}

/**
 * Tutarlilik bulgularini dugum bazinda gruplar (satir rozeti icin).
 * @param {Array} issues checkComponentTree yanitindaki issues
 * @returns {Map<string, Array>}
 */
export function issuesByComponent(issues) {
  const map = new Map()
  for (const issue of issues || []) {
    if (!issue.componentId) continue
    const list = map.get(issue.componentId) || []
    list.push(issue)
    map.set(issue.componentId, list)
  }
  return map
}

/** Bir dugumun rozet seviyesi: en agir bulgu kazanir (error > warn > info). */
export function severityOf(issues) {
  if (!issues || issues.length === 0) return null
  if (issues.some((i) => i.severity === 'error')) return 'error'
  if (issues.some((i) => i.severity === 'warn')) return 'warn'
  return 'info'
}

/**
 * Bir dugumun kokten kendisine kadar olan ad zinciri ("Sistem / STC / GY1").
 * Ayni adli bilesenleri ayirt etmek icin liste gorunumunde kullanilir.
 */
export function pathLabel(row, rowsById) {
  const parts = []
  let cursor = row
  const seen = new Set()
  while (cursor && !seen.has(cursor.id)) {
    seen.add(cursor.id)
    parts.unshift(cursor.name)
    cursor = cursor.parentId ? rowsById.get(cursor.parentId) : null
  }
  return parts.join(' / ')
}
