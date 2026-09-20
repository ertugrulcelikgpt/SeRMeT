// ============================================================================
//  mindMap.js  —  Zihin haritasi (mind map) gorunumunun SAF cekirdegi.
//  Uc is burada yapilir; React bilesenleri yalnizca ciktilari cizer:
//
//    1) buildMindMapGraph : gereksinim + test + bag koleksiyonlarindan yonlu
//       bir agac/orman (forest) kurar. Yon, izlenebilirlik deposunun kendi
//       yonudur (bkz. constants.js): fromId = UST, toId = ALT. Dolayisiyla
//       "cocuk" = bu kaydi karsilayan (Satisfies) alt gereksinim veya onu
//       dogrulayan (Verifies) test.
//    2) layoutMindMap     : ACIK olan dallari klasik yatay mind map duzenine
//       yerlestirir (yaprak satirlari sirayla, ust dugum cocuklarinin ortasi).
//       KAPALI dallar hic dolasilmaz — 500+ dugumlu projelerde maliyet
//       gorunen dugum sayisi kadardir ("kademeli yukleme").
//    3) buildMindMapSvg   : ayni duzenden bagimsiz (stil gomulu) bir SVG
//       metni uretir; PNG/SVG disa aktarimi bunun uzerinden yapilir.
//
//  Saf tutulmasinin sebebi: hem test edilebilir olmasi, hem de ekranda
//  cizilen harita ile disa aktarilan goruntunun TEK kaynaktan uretilmesi.
// ============================================================================
import { LINK_TYPE, REQ_TYPE, TEST_TYPE, TYPE_SUFFIX } from './constants.js'
import { getDisplayLabel, truncate } from './format.js'

// --- Seviyeler --------------------------------------------------------------
//  Dal renkleri TIPE degil SEVIYEYE baglidir (User / System / Sub-system /
//  Test). Software ve Hardware ayni seviyenin iki tipidir; ayrimi dugumdeki
//  kisa tip eki (SW / HW) tasir.
export const MIND_MAP_LEVELS = ['user', 'system', 'subsystem', 'test']

const LEVEL_OF_TYPE = {
  [REQ_TYPE.USER]: 'user',
  [REQ_TYPE.SYSTEM]: 'system',
  [REQ_TYPE.SOFTWARE]: 'subsystem',
  [REQ_TYPE.HARDWARE]: 'subsystem',
  [REQ_TYPE.TEST_CASE]: 'test',
  [TEST_TYPE.ACCEPTANCE]: 'test',
  [TEST_TYPE.SYSTEM]: 'test',
  [TEST_TYPE.SUBSYSTEM]: 'test',
}

/** Bir kaydin tipini mind map seviyesine cevirir (bilinmeyen tip -> 'system'). */
export function levelOfType(type) {
  return LEVEL_OF_TYPE[type] || 'system'
}

// Kok siralamasi ve kardes siralamasi icin seviye agirligi.
const LEVEL_RANK = { user: 0, system: 1, subsystem: 2, test: 3 }

// Dal renkleri — koyu ve acik temada da okunur orta tonlar.
export const MIND_MAP_BRANCH_COLORS = {
  user: '#6366f1', // indigo-500
  system: '#a855f7', // purple-500
  subsystem: '#32a1ff', // brand-500
  test: '#ec4899', // pink-500
}

/** Tema yuzeyleri (arka plan / dugum govdesi / metin). */
export function mindMapTheme(theme) {
  if (theme === 'light') {
    return {
      bg: '#f8fafc',
      nodeBg: '#ffffff',
      nodeText: '#0f172a',
      subText: '#64748b',
      dotBg: '#ffffff',
    }
  }
  return {
    bg: '#0b1220',
    nodeBg: '#111a2b',
    nodeText: '#e2e8f0',
    subText: '#94a3b8',
    dotBg: '#0b1220',
  }
}

// --- Duzen olculeri ---------------------------------------------------------
export const MIND_MAP_LAYOUT = {
  nodeWidth: 224,
  nodeHeight: 44,
  rowGap: 12,
  columnGap: 88,
  padding: 56,
}

// Tek seferde yerlestirilecek dugum ust siniri. Kullanici "tumunu ac"
// dedigi devasa projelerde tarayiciyi kilitlememek icin duzen bu sinirda
// kesilir ve `truncated` bayragi ile UI uyarilir.
export const MIND_MAP_MAX_NODES = 4000

const byTextId = (a, b) =>
  String(a?.text_id || '').localeCompare(String(b?.text_id || ''), undefined, { numeric: true })

function toMindMapNode(row, kind) {
  const label = getDisplayLabel(row, { max: 120 })
  return {
    id: row.id,
    kind, // 'requirement' | 'test'
    type: row.type,
    text_id: row.text_id || '',
    label: label.text,
    labelIsFallback: label.isFallback,
    level: levelOfType(row.type),
    typeSuffix: TYPE_SUFFIX[row.type] || '',
    row,
  }
}

/**
 * Koleksiyonlardan mind map grafigini kurar.
 *
 * Yalnizca Satisfies + Verifies baglari agaci olusturur; "Assigned To"
 * (sozluk terimi) bir izlenebilirlik ZINCIRI degildir, bu yuzden haritaya
 * alinmaz.
 *
 * Kok dugumler: hicbir Satisfies/Verifies baginin ALT ucunda (toId)
 * bulunmayan kayitlar. Boylece kullanici gereksinimleri dogal kok olur,
 * ustu kopmus (orphan) kayitlar da haritada gorunur — gizlenmez.
 *
 * @returns {{ nodes: Map, children: Map, rootIds: string[], linkCount: number }}
 */
export function buildMindMapGraph(requirements = [], testCases = [], links = []) {
  const nodes = new Map()
  for (const r of requirements || []) {
    if (r?.id) nodes.set(r.id, toMindMapNode(r, 'requirement'))
  }
  for (const tc of testCases || []) {
    if (tc?.id) nodes.set(tc.id, toMindMapNode(tc, 'test'))
  }

  const childSets = new Map()
  const hasParent = new Set()
  let linkCount = 0
  for (const l of links || []) {
    if (l?.type !== LINK_TYPE.SATISFIES && l?.type !== LINK_TYPE.VERIFIES) continue
    // Bir ucu silinmis/kapsam disi bag haritaya alinmaz.
    if (!nodes.has(l.fromId) || !nodes.has(l.toId)) continue
    if (l.fromId === l.toId) continue
    let set = childSets.get(l.fromId)
    if (!set) {
      set = new Set()
      childSets.set(l.fromId, set)
    }
    if (set.has(l.toId)) continue // ayni cift iki kez baglanmissa tek dal
    set.add(l.toId)
    hasParent.add(l.toId)
    linkCount += 1
  }

  const sortIds = (ids) =>
    ids
      .map((id) => nodes.get(id))
      .filter(Boolean)
      .sort((a, b) => LEVEL_RANK[a.level] - LEVEL_RANK[b.level] || byTextId(a, b))
      .map((n) => n.id)

  const children = new Map()
  for (const [pid, set] of childSets) children.set(pid, sortIds([...set]))

  const rootIds = sortIds([...nodes.keys()].filter((id) => !hasParent.has(id)))

  return { nodes, children, rootIds, linkCount }
}

/** Bir dugumun (varsa) cocuk id listesi. */
export function childIdsOf(graph, id) {
  return graph?.children?.get(id) || []
}

/**
 * Agactaki yol anahtari. AYNI kayit birden fazla ustu karsilayabildigi icin
 * (skip-level Satisfies baglari) haritada birden fazla yerde gorunebilir;
 * acik/kapali durumu bu yuzden kayit id'sine degil YOLA baglanir.
 */
export function mindMapNodeKey(parentKey, id) {
  return parentKey ? `${parentKey}>${id}` : id
}

/** Varsayilan acik dallar: yalnizca kokler (ilk seviye cocuklar gorunur). */
export function defaultExpandedKeys(graph) {
  return new Set(graph?.rootIds || [])
}

/**
 * "Tumunu ac" icin acilabilir tum yol anahtarlari. Dongu koruması (ata
 * kumesi) ve dugum ust siniri uygulanir; sinir asilirsa `truncated` true
 * doner ve cagiran taraf kullaniciyi uyarir.
 */
export function collectExpandableKeys(graph, { maxNodes = MIND_MAP_MAX_NODES } = {}) {
  const keys = new Set()
  let count = 0
  let truncated = false
  const walk = (id, parentKey, ancestors) => {
    if (count >= maxNodes) {
      truncated = true
      return
    }
    count += 1
    const key = mindMapNodeKey(parentKey, id)
    const kids = childIdsOf(graph, id).filter((c) => !ancestors.has(c))
    if (kids.length === 0) return
    keys.add(key)
    const next = new Set(ancestors)
    next.add(id)
    for (const cid of kids) walk(cid, key, next)
  }
  for (const rid of graph?.rootIds || []) walk(rid, null, new Set())
  return { keys, truncated }
}

/**
 * Acik dallari mind map duzenine yerlestirir. Iki yon desteklenir:
 *
 *   'horizontal' (varsayilan, Issue #122): derinlik SAGA buyur
 *       derinlik ekseni = x, kardes ekseni = y
 *   'vertical'   (Issue #129 Bilesenler): derinlik ASAGI buyur — klasik
 *       organizasyon semasi / yukaridan asagi zihin haritasi
 *       derinlik ekseni = y, kardes ekseni = x
 *
 * Her iki yonde de yaprak dugumler kardes ekseninde sirayla dizilir, ust
 * dugum ise cocuklarinin ORTASINA hizalanir.
 *
 * Dugum konumu SOZLESMESI yonden bagimsizdir (cizim katmani buna guvenir):
 *   x = dugumun SOL kenari, y = dugumun DIKEY MERKEZI.
 *
 * KAPALI dal hic dolasilmaz: maliyet toplam kayit sayisiyla degil GORUNEN
 * dugum sayisiyla artar.
 *
 * @param {object} graph        buildMindMapGraph ciktisi
 * @param {Set<string>} expandedKeys acik yol anahtarlari
 * @param {object} options      { layout, maxNodes, orientation }
 * @returns {{nodes, edges, orientation, width, height, minX, minY, truncated, leafRows}}
 */
export function layoutMindMap(graph, expandedKeys, options = {}) {
  const L = { ...MIND_MAP_LAYOUT, ...(options.layout || {}) }
  const maxNodes = options.maxNodes ?? MIND_MAP_MAX_NODES
  const expanded = expandedKeys || new Set()
  const vertical = options.orientation === 'vertical'
  // Derinlik ekseni asagi (dikey) ya da saga (yatay) buyur; kardes ekseni
  // her zaman digeridir. Adimlar buna gore secilir.
  const depthPitch = vertical ? L.nodeHeight + L.rowGap : L.nodeWidth + L.columnGap
  const crossPitch = vertical ? L.nodeWidth + L.columnGap : L.nodeHeight + L.rowGap
  const crossHalf = vertical ? L.nodeWidth / 2 : L.nodeHeight / 2

  const nodes = []
  const edges = []
  // `row` = kardes ekseninde tuketilen yaprak sayaci (yatayda satir,
  // dikeyde sutun).
  let row = 0
  let maxDepth = 0
  let truncated = false
  // Dugumler sona-dogru (post-order) toplandigi icin sinir, ZIYARET sayaciyla
  // olculur: `nodes.length` derin bir zincirin en altina inilene kadar 0'dir.
  let visited = 0

  const walk = (id, parentKey, depth, ancestors) => {
    const node = graph.nodes.get(id)
    if (!node) return null
    if (visited >= maxNodes) {
      truncated = true
      return null
    }
    visited += 1
    const key = mindMapNodeKey(parentKey, id)
    // Dongu korumasi: bir kayit kendi atasi olarak tekrar acilamaz.
    const kids = childIdsOf(graph, id).filter((c) => !ancestors.has(c))
    const hasChildren = kids.length > 0
    const isExpanded = hasChildren && expanded.has(key)
    const depthPos = depth * depthPitch
    if (depth > maxDepth) maxDepth = depth

    const record = {
      key,
      id,
      node,
      level: node.level,
      depth,
      // Konumlar `cross` belirlendikten SONRA yazilir (asagida): yatayda
      // x derinlikten, dikeyde y derinlikten gelir.
      x: 0,
      y: 0,
      cross: 0,
      hasChildren,
      expanded: isExpanded,
      childCount: kids.length,
      color: MIND_MAP_BRANCH_COLORS[node.level] || MIND_MAP_BRANCH_COLORS.system,
    }

    const kidRecords = []
    if (isExpanded) {
      const nextAncestors = new Set(ancestors)
      nextAncestors.add(id)
      for (const cid of kids) {
        const kr = walk(cid, key, depth + 1, nextAncestors)
        if (kr) kidRecords.push(kr)
      }
    }

    if (kidRecords.length === 0) {
      // Yaprak (ya da kapali dal): kardes ekseninde siradaki yeri alir.
      record.cross = row * crossPitch + crossHalf
      row += 1
    } else {
      // Ust dugum cocuklarinin ORTASINA hizalanir.
      record.cross = (kidRecords[0].cross + kidRecords[kidRecords.length - 1].cross) / 2
    }

    // Sozlesme: x = sol kenar, y = dikey merkez (yon farketmez).
    if (vertical) {
      record.x = record.cross - L.nodeWidth / 2
      record.y = depthPos + L.nodeHeight / 2
    } else {
      record.x = depthPos
      record.y = record.cross
    }

    // Kenarlar ust dugumun konumu belli olduktan sonra baglanir: dikeyde
    // alt kenar ortasindan cocugun ust kenar ortasina, yatayda sag kenardan
    // cocugun sol kenarina.
    for (const kr of kidRecords) {
      edges.push({
        key: `${key}->${kr.key}`,
        x1: vertical ? record.x + L.nodeWidth / 2 : record.x + L.nodeWidth,
        y1: vertical ? record.y + L.nodeHeight / 2 : record.y,
        x2: vertical ? kr.x + L.nodeWidth / 2 : kr.x,
        y2: vertical ? kr.y - L.nodeHeight / 2 : kr.y,
        vertical,
        color: kr.color,
        depth: kr.depth,
      })
    }

    nodes.push(record)
    return record
  }

  for (const rid of graph?.rootIds || []) walk(rid, null, 0, new Set())

  // Cizim sirasi: yukaridan asagi, soldan saga (deterministik ciktı).
  nodes.sort((a, b) => a.y - b.y || a.depth - b.depth)

  const depthExtent = maxDepth * depthPitch + (vertical ? L.nodeHeight : L.nodeWidth)
  const crossExtent = Math.max(row, 1) * crossPitch
  const contentWidth = vertical ? crossExtent : depthExtent
  const contentHeight = vertical ? depthExtent : crossExtent
  return {
    nodes,
    edges,
    layout: L,
    orientation: vertical ? 'vertical' : 'horizontal',
    // Dikeyde dugum kendi kardes konumunun ETRAFINA yerlesir; ilk sutunun
    // merkezi nodeWidth/2 oldugu icin sol kenari yine 0'dir — iki yonde de
    // icerik (0,0)'dan baslar.
    minX: -L.padding,
    minY: -L.padding,
    width: contentWidth + L.padding * 2,
    height: contentHeight + L.padding * 2,
    leafRows: row,
    truncated,
  }
}

/**
 * Kenar (dal) cizgisi.
 *   yatay : klasik "S" bezier'i (soldan saga dallanma)
 *   dikey : koseleri yuvarlatilmis DIRSEK — yukaridan asagi semalarda
 *           egri demeti "spagetti" gorunurken dirsek, hangi dugumun kimin
 *           altinda oldugunu tek bakista okutur.
 */
export function mindMapEdgePath(edge) {
  const r = (n) => Math.round(n * 10) / 10
  if (edge.vertical) {
    const midY = (edge.y1 + edge.y2) / 2
    const dx = edge.x2 - edge.x1
    // Ayni sutundaki cocuk: duz dikey cizgi.
    if (Math.abs(dx) < 1) return `M ${r(edge.x1)} ${r(edge.y1)} V ${r(edge.y2)}`
    const dir = dx > 0 ? 1 : -1
    const k = Math.min(12, Math.abs(dx) / 2, Math.abs(midY - edge.y1), Math.abs(edge.y2 - midY))
    return (
      `M ${r(edge.x1)} ${r(edge.y1)} V ${r(midY - k)} ` +
      `Q ${r(edge.x1)} ${r(midY)} ${r(edge.x1 + dir * k)} ${r(midY)} ` +
      `H ${r(edge.x2 - dir * k)} ` +
      `Q ${r(edge.x2)} ${r(midY)} ${r(edge.x2)} ${r(midY + k)} ` +
      `V ${r(edge.y2)}`
    )
  }
  const dx = Math.max(28, (edge.x2 - edge.x1) / 2)
  return `M ${r(edge.x1)} ${r(edge.y1)} C ${r(edge.x1 + dx)} ${r(edge.y1)}, ${r(
    edge.x2 - dx,
  )} ${r(edge.y2)}, ${r(edge.x2)} ${r(edge.y2)}`
}

/** Dugum genisligine sigacak kadar etiket metni. */
export function fitLabel(text, width, charWidth = 6.1) {
  const max = Math.max(8, Math.floor((width - 26) / charWidth))
  return truncate(String(text || ''), max)
}

const XML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }
function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => XML_ESCAPES[c])
}

/**
 * Duzeni bagimsiz (stil gomulu) bir SVG metnine cevirir.
 * Ekrandaki harita SANALLASTIRILDIGI (yalnizca gorunen dugumler cizilir)
 * icin disa aktarim canli DOM'dan degil BURADAN uretilir: boylece disa
 * aktarilan gorsel her zaman TUM acik dallari icerir.
 */
export function buildMindMapSvg(mapLayout, { theme = 'dark', title = 'Mind Map' } = {}) {
  const c = mindMapTheme(theme)
  const L = mapLayout.layout || MIND_MAP_LAYOUT
  const w = Math.max(1, Math.round(mapLayout.width))
  const h = Math.max(1, Math.round(mapLayout.height))

  const edges = mapLayout.edges
    .map(
      (e) =>
        `<path d="${mindMapEdgePath(e)}" fill="none" stroke="${e.color}" stroke-width="2" stroke-opacity="0.75" stroke-linecap="round"/>`,
    )
    .join('')

  const vertical = mapLayout.orientation === 'vertical'
  const nodes = mapLayout.nodes
    .map((n) => {
      const top = n.y - L.nodeHeight / 2
      const label = fitLabel(n.node.label, L.nodeWidth)
      // Ac/kapa noktasi dalin CIKTIGI kenardadir: yatayda sag orta,
      // dikeyde alt orta.
      const dx = vertical ? n.x + L.nodeWidth / 2 : n.x + L.nodeWidth
      const dy = vertical ? n.y + L.nodeHeight / 2 : n.y
      const dot = n.hasChildren
        ? `<circle cx="${dx}" cy="${dy}" r="8" fill="${c.dotBg}" stroke="${n.color}" stroke-width="2"/>` +
          `<path d="M ${dx - 4} ${dy} H ${dx + 4}${
            n.expanded ? '' : ` M ${dx} ${dy - 4} V ${dy + 4}`
          }" stroke="${n.color}" stroke-width="1.8" stroke-linecap="round"/>`
        : ''
      return (
        `<g>` +
        `<rect x="${n.x}" y="${top}" width="${L.nodeWidth}" height="${L.nodeHeight}" rx="10" fill="${c.nodeBg}" stroke="${n.color}" stroke-width="1.5"/>` +
        `<rect x="${n.x}" y="${top + 6}" width="4" height="${L.nodeHeight - 12}" rx="2" fill="${n.color}"/>` +
        `<text x="${n.x + 14}" y="${top + 17}" font-family="JetBrains Mono, Consolas, monospace" font-size="10" font-weight="700" fill="${n.color}">${esc(
          n.node.text_id,
        )}${n.node.typeSuffix ? ` <tspan fill="${c.subText}">· ${esc(n.node.typeSuffix)}</tspan>` : ''}</text>` +
        `<text x="${n.x + 14}" y="${top + 32}" font-family="Inter, Segoe UI, sans-serif" font-size="11" fill="${c.nodeText}">${esc(label)}</text>` +
        // Ucuncu satir yalnizca dugum ozet tasiyorsa (bkz. MindMapCanvas).
        (n.node.meta
          ? `<text x="${n.x + 14}" y="${top + 47}" font-family="Inter, Segoe UI, sans-serif" font-size="10" font-weight="600" fill="${c.subText}">${esc(
              fitLabel(n.node.meta, L.nodeWidth),
            )}</text>`
          : '') +
        dot +
        `</g>`
      )
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" ` +
    `viewBox="${Math.round(mapLayout.minX)} ${Math.round(mapLayout.minY)} ${w} ${h}">` +
    `<title>${esc(title)}</title>` +
    `<rect x="${Math.round(mapLayout.minX)}" y="${Math.round(mapLayout.minY)}" width="${w}" height="${h}" fill="${c.bg}"/>` +
    `<g>${edges}</g><g>${nodes}</g></svg>`
  )
}
