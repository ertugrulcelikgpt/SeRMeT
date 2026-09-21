// ============================================================================
//  mindMap.test.js — "Gereksinim Haritasi" cizim cekirdegi (Issue #122).
//  Kapsam: graf kurulumu (kok secimi, yon, gurultu filtresi), kademeli
//  yerlesim (kapali dal dolasilmaz), dongu/skip-level korumasi, haritada
//  arama (odaklanma + yol acma) ve SVG disa aktarimi.
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  buildMindMapGraph,
  buildMindMapSvg,
  collectExpandableKeys,
  defaultExpandedKeys,
  expandedWithPath,
  findMindMapMatches,
  foldForSearch,
  layoutMindMap,
  MIND_MAP_LAYOUT,
  mindMapEdgePath,
  levelOfType,
  mindMapNodeKey,
} from '../mindMap.js'
import { LINK_TYPE, REQ_TYPE, TEST_TYPE } from '../constants.js'

const req = (id, text_id, type, title = `Baslik ${text_id}`) => ({ id, text_id, type, title })
const test_ = (id, text_id, type = TEST_TYPE.SYSTEM) => ({ id, text_id, type, title: text_id })
const link = (fromId, toId, type = LINK_TYPE.SATISFIES) => ({ fromId, toId, type })

// User -> System -> Software, ayrica System'i dogrulayan bir test.
const REQS = [
  req('u1', 'REQ-USR-001', REQ_TYPE.USER),
  req('s1', 'REQ-SYS-001', REQ_TYPE.SYSTEM),
  req('w1', 'REQ-SW-001', REQ_TYPE.SOFTWARE),
]
const TESTS = [test_('t1', 'TC-SYS-001')]
const LINKS = [link('u1', 's1'), link('s1', 'w1'), link('s1', 't1', LINK_TYPE.VERIFIES)]

describe('buildMindMapGraph', () => {
  it('kok = hicbir bagin ALT ucunda olmayan kayit', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    expect(g.rootIds).toEqual(['u1'])
    expect(g.children.get('u1')).toEqual(['s1'])
    expect(g.linkCount).toBe(3)
  })

  it('Satisfies + Verifies cocuklari seviye sirasiyla gelir (once gereksinim, sonra test)', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    expect(g.children.get('s1')).toEqual(['w1', 't1'])
  })

  it('ustu olmayan (orphan) kayit da kok olarak haritada kalir', () => {
    const g = buildMindMapGraph([...REQS, req('w9', 'REQ-SW-009', REQ_TYPE.SOFTWARE)], [], [])
    expect(g.rootIds).toContain('w9')
  })

  it('Assigned To bagi, ucu eksik bag ve kendine bag haritaya alinmaz', () => {
    const g = buildMindMapGraph(REQS, TESTS, [
      link('u1', 's1'),
      link('u1', 'yok-boyle-id'),
      link('s1', 's1'),
      link('u1', 'w1', LINK_TYPE.ASSIGNED_TO),
    ])
    expect(g.linkCount).toBe(1)
    expect(g.children.get('u1')).toEqual(['s1'])
  })

  it('ayni cift iki kez baglanmissa tek dal cizilir', () => {
    const g = buildMindMapGraph(REQS, TESTS, [link('u1', 's1'), link('u1', 's1')])
    expect(g.children.get('u1')).toEqual(['s1'])
    expect(g.linkCount).toBe(1)
  })

  it('tipler mind map seviyelerine eslenir', () => {
    expect(levelOfType(REQ_TYPE.USER)).toBe('user')
    expect(levelOfType(REQ_TYPE.SOFTWARE)).toBe('subsystem')
    expect(levelOfType(REQ_TYPE.HARDWARE)).toBe('subsystem')
    expect(levelOfType(TEST_TYPE.ACCEPTANCE)).toBe('test')
  })
})

describe('layoutMindMap — sıkışık (compact) dikey düzen', () => {
  // Genis bir agac: tek kok, 8 dal; her dalin 2 YAPRAK cocugu.
  const wideGraph = () => {
    const reqs = [{ id: 'r', text_id: 'R-0', title: 'Kök', type: REQ_TYPE.USER }]
    const links = []
    for (let i = 1; i <= 8; i += 1) {
      reqs.push({ id: 's' + i, text_id: 'S-' + i, title: 'Dal', type: REQ_TYPE.SYSTEM })
      links.push(link('r', 's' + i))
      for (let j = 1; j <= 2; j += 1) {
        const wid = 'w' + i + '_' + j
        reqs.push({ id: wid, text_id: 'W-' + i + j, title: 'Yaprak', type: REQ_TYPE.SOFTWARE })
        links.push(link('s' + i, wid))
      }
    }
    return buildMindMapGraph(reqs, [], links)
  }
  const openAll = (g, opts) => layoutMindMap(g, collectExpandableKeys(g).keys, opts)

  it('yapraklar ust dugumun ALTINDA zincir olur; harita daralir', () => {
    const g = wideGraph()
    const classic = openAll(g, { orientation: 'vertical' })
    const compact = openAll(g, { orientation: 'vertical', compact: true })
    expect(compact.compact).toBe(true)
    // Her yaprak kendi sutununu almadigi icin genislik yariya iner.
    expect(compact.width).toBeLessThan(classic.width * 0.6)
  })

  it('zincirdeki kutular AYNI HIZADA ve ardisik durur', () => {
    const compact = openAll(wideGraph(), { orientation: 'vertical', compact: true })
    const byId = Object.fromEntries(compact.nodes.map((n) => [n.id, n]))
    // Iki yaprak, dalin tam altinda, alt alta.
    expect(byId.w1_1.x).toBe(byId.s1.x)
    expect(byId.w1_2.x).toBe(byId.s1.x)
    expect(byId.w1_1.y).toBeGreaterThan(byId.s1.y)
    expect(byId.w1_2.y).toBeGreaterThan(byId.w1_1.y)
  })

  it('kirilimi olan cocuklar hala YAN YANA acilir (yelpaze)', () => {
    const compact = openAll(wideGraph(), { orientation: 'vertical', compact: true })
    const byId = Object.fromEntries(compact.nodes.map((n) => [n.id, n]))
    expect(byId.s1.y).toBe(byId.s2.y) // ayni seviye
    expect(byId.s1.x).not.toBe(byId.s2.x) // farkli sutun
    // Kok, dallarinin ortasinda.
    const mid = (byId.s1.x + byId.s8.x) / 2
    expect(byId.r.x).toBeCloseTo(mid, 5)
  })

  it('zincir oku bir ONCEKI kutudan iner (kutudan kutuya)', () => {
    const half = MIND_MAP_LAYOUT.nodeHeight / 2
    const compact = openAll(wideGraph(), { orientation: 'vertical', compact: true })
    const byId = Object.fromEntries(compact.nodes.map((n) => [n.id, n]))
    const toSecond = compact.edges.find((e) => Math.abs(e.y2 - (byId.w1_2.y - half)) < 0.01)
    expect(toSecond).toBeTruthy()
    // Ikinci yaprak, ILK YAPRAGIN altindan baglanir (dogrudan daldan degil).
    expect(toSecond.y1).toBeCloseTo(byId.w1_1.y + half, 5)
  })

  it('dugum ust siniri sikisik duzende de uygulanir', () => {
    const g = wideGraph()
    const compact = layoutMindMap(g, collectExpandableKeys(g).keys, {
      orientation: 'vertical',
      compact: true,
      maxNodes: 3,
    })
    expect(compact.truncated).toBe(true)
    expect(compact.nodes.length).toBeLessThanOrEqual(3)
  })
})

describe('layoutMindMap — dikey (yukarıdan aşağı) yön', () => {
  const opened = () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    return {
      g,
      h: layoutMindMap(g, collectExpandableKeys(g).keys),
      v: layoutMindMap(g, collectExpandableKeys(g).keys, { orientation: 'vertical' }),
    }
  }

  it('derinlik ASAGI buyur; kardesler yana dizilir', () => {
    const { v } = opened()
    const byId = Object.fromEntries(v.nodes.map((n) => [n.id, n]))
    expect(v.orientation).toBe('vertical')
    expect(byId.u1.y).toBeLessThan(byId.s1.y)
    expect(byId.s1.y).toBeLessThan(byId.w1.y)
    // Ayni seviyedeki kardesler ayni satirda, farkli sutunlarda durur.
    expect(byId.w1.y).toBe(byId.t1.y)
    expect(byId.w1.x).not.toBe(byId.t1.x)
  })

  it('yatay yonde ise derinlik SAGA buyur (motor iki yonu de destekler)', () => {
    const { h } = opened()
    const byId = Object.fromEntries(h.nodes.map((n) => [n.id, n]))
    expect(h.orientation).toBe('horizontal')
    expect(byId.u1.x).toBeLessThan(byId.s1.x)
    expect(byId.w1.x).toBe(byId.t1.x)
  })

  it('ust dugum cocuklarinin ORTASINA hizalanir', () => {
    const { v } = opened()
    const byId = Object.fromEntries(v.nodes.map((n) => [n.id, n]))
    const mid = (byId.w1.x + byId.t1.x) / 2
    expect(byId.s1.x).toBeCloseTo(mid, 5)
  })

  it('kenarlar alt kenardan cocugun ust kenarina baglanir', () => {
    const { v } = opened()
    const edge = v.edges[0]
    expect(edge.vertical).toBe(true)
    expect(edge.y2).toBeGreaterThan(edge.y1)
    // Dikey kenar DIRSEK cizer (bezier degil): dikey/yatay parcalar.
    const d = mindMapEdgePath(edge)
    expect(d.startsWith('M ')).toBe(true)
    expect(d).toMatch(/[VH]/)
  })

  it('dikey duzende genislik kardes eksenine, yukseklik derinlige baglidir', () => {
    const { h, v } = opened()
    expect(v.width).toBeGreaterThan(v.height)
    expect(h.width).toBeGreaterThan(h.height)
    // Ayni graf: yatayda genislik derinlikten, dikeyde yukseklik derinlikten.
    expect(v.height).toBeGreaterThan(0)
  })
})

describe('layoutMindMap', () => {
  it('KAPALI dal hic dolasilmaz (kademeli yukleme)', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const closed = layoutMindMap(g, new Set())
    expect(closed.nodes.map((n) => n.id)).toEqual(['u1'])
    expect(closed.nodes[0].hasChildren).toBe(true)
    expect(closed.nodes[0].expanded).toBe(false)
    expect(closed.nodes[0].childCount).toBe(1)
    expect(closed.edges).toHaveLength(0)
  })

  it('varsayilan acik kumesi kokleri acar, torunlar kapali kalir', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const l = layoutMindMap(g, defaultExpandedKeys(g))
    expect(l.nodes.map((n) => n.id).sort()).toEqual(['s1', 'u1'])
  })

  it('dal acildikca derinlik ve renk seviyeye gore atanir', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const l = layoutMindMap(g, collectExpandableKeys(g).keys)
    const byId = Object.fromEntries(l.nodes.map((n) => [n.id, n]))
    expect(byId.u1.depth).toBe(0)
    expect(byId.s1.depth).toBe(1)
    expect(byId.w1.depth).toBe(2)
    expect(byId.t1.depth).toBe(2)
    expect(byId.u1.x).toBeLessThan(byId.s1.x)
    expect(byId.u1.level).toBe('user')
    expect(byId.t1.level).toBe('test')
    expect(l.edges).toHaveLength(3)
  })

  it('ust dugum, cocuklarinin tam ortasina hizalanir', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const l = layoutMindMap(g, collectExpandableKeys(g).keys)
    const byId = Object.fromEntries(l.nodes.map((n) => [n.id, n]))
    expect(byId.s1.y).toBeCloseTo((byId.w1.y + byId.t1.y) / 2, 5)
  })

  it('ayni kayit iki ustu karsiliyorsa (skip-level) iki ayri dalda gorunur', () => {
    const g = buildMindMapGraph(REQS, TESTS, [link('u1', 's1'), link('u1', 'w1'), link('s1', 'w1')])
    const l = layoutMindMap(g, collectExpandableKeys(g).keys)
    const sw = l.nodes.filter((n) => n.id === 'w1')
    expect(sw).toHaveLength(2)
    // Acik/kapali durumu YOLA baglidir; ayni kaydin iki kopyasi ayri anahtar alir.
    expect(new Set(sw.map((n) => n.key)).size).toBe(2)
    expect(sw.map((n) => n.key)).toContain(mindMapNodeKey(mindMapNodeKey(null, 'u1'), 'w1'))
  })

  it('dongulu bag sonsuz dolasmaz', () => {
    const g = buildMindMapGraph(REQS, [], [link('u1', 's1'), link('s1', 'w1'), link('w1', 'u1')])
    const { keys } = collectExpandableKeys(g)
    const l = layoutMindMap(g, keys)
    // Kok kalmadiginda (her dugumun bir ustu var) harita bostur; dolasma
    // yine de sonlanmalidir.
    expect(l.nodes.length).toBeLessThanOrEqual(3)
  })

  it('dugum ust siniri asilirsa duzen kesilir ve isaretlenir', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const l = layoutMindMap(g, collectExpandableKeys(g).keys, { maxNodes: 2 })
    expect(l.truncated).toBe(true)
    expect(l.nodes.length).toBeLessThanOrEqual(2)
  })

  it('500+ dugumlu projede tum dallar makul surede yerlesir', () => {
    const many = [req('root', 'REQ-USR-000', REQ_TYPE.USER)]
    const manyLinks = []
    for (let i = 1; i <= 260; i += 1) {
      many.push(req(`s${i}`, `REQ-SYS-${String(i).padStart(3, '0')}`, REQ_TYPE.SYSTEM))
      many.push(req(`w${i}`, `REQ-SW-${String(i).padStart(3, '0')}`, REQ_TYPE.SOFTWARE))
      manyLinks.push(link('root', `s${i}`), link(`s${i}`, `w${i}`))
    }
    const g = buildMindMapGraph(many, [], manyLinks)
    const started = Date.now()
    const l = layoutMindMap(g, collectExpandableKeys(g).keys)
    expect(l.nodes).toHaveLength(521)
    expect(Date.now() - started).toBeLessThan(1000)
    // Kapali harita ise tek dugum kadar ucuzdur.
    expect(layoutMindMap(g, new Set()).nodes).toHaveLength(1)
  })
})

describe('buildMindMapSvg', () => {
  it('acik TUM dallari iceren bagimsiz bir SVG uretir', () => {
    const g = buildMindMapGraph(REQS, TESTS, LINKS)
    const l = layoutMindMap(g, collectExpandableKeys(g).keys)
    const svg = buildMindMapSvg(l, { theme: 'dark', title: 'Proje' })
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true)
    expect(svg).toContain('REQ-USR-001')
    expect(svg).toContain('REQ-SW-001')
    expect(svg).toContain('TC-SYS-001')
    expect(svg.trimEnd().endsWith('</svg>')).toBe(true)
  })

  it('metinleri XML icin kacisla yazar', () => {
    const g = buildMindMapGraph([req('u1', 'REQ-USR-001', REQ_TYPE.USER, 'A & B <script>')], [], [])
    const svg = buildMindMapSvg(layoutMindMap(g, new Set()))
    expect(svg).toContain('A &amp; B &lt;script&gt;')
    expect(svg).not.toContain('<script>')
  })
})

describe('foldForSearch — Türkçe i/ı eşleşmesi', () => {
  it('noktali ve noktasiz "i" bicimlerini tek harfe indirger', () => {
    expect(foldForSearch('SICAKLIK')).toBe('sicaklik')
    expect(foldForSearch('Sıcaklık')).toBe('sicaklik')
    expect(foldForSearch('İZLENEBİLİRLİK')).toBe('izlenebilirlik')
    expect(foldForSearch('izlenebilirlik')).toBe('izlenebilirlik')
  })

  it('bos/tanimsiz girdide bos dize doner', () => {
    expect(foldForSearch(null)).toBe('')
    expect(foldForSearch(undefined)).toBe('')
  })
})

describe('findMindMapMatches — haritada arama', () => {
  const graph = () => buildMindMapGraph(REQS, TESTS, LINKS)

  it('kod ile eslesir ve koke giden YOLU dondurur', () => {
    const hits = findMindMapMatches(graph(), 'REQ-SW-001')
    expect(hits).toHaveLength(1)
    expect(hits[0].id).toBe('w1')
    expect(hits[0].path).toEqual(['u1', 'u1>s1', 'u1>s1>w1'])
  })

  it('KAPALI dallardaki kayitlari da bulur (acik kumesinden bagimsizdir)', () => {
    // Arama, yalnizca kokleri acik olan bir haritada da derindeki kaydi bulur.
    expect(findMindMapMatches(graph(), 'TC-SYS-001')[0].id).toBe('t1')
  })

  it('baslikta ve buyuk/kucuk harf farkiyla eslesir', () => {
    const reqs = [req('u1', 'REQ-USR-001', REQ_TYPE.USER, 'Sicaklik dongusu')]
    const hits = findMindMapMatches(buildMindMapGraph(reqs, [], []), 'SICAKLIK')
    expect(hits).toHaveLength(1)
  })

  it('bos sorgu hic sonuc dondurmez', () => {
    expect(findMindMapMatches(graph(), '')).toEqual([])
    expect(findMindMapMatches(graph(), '   ')).toEqual([])
    expect(findMindMapMatches(graph(), null)).toEqual([])
  })

  it('eslesme yoksa bos dizi doner', () => {
    expect(findMindMapMatches(graph(), 'yok-boyle')).toEqual([])
  })

  it('birden fazla eslesmeyi belge sirasinda dondurur', () => {
    const hits = findMindMapMatches(graph(), 'REQ-')
    expect(hits.map((h) => h.id)).toEqual(['u1', 's1', 'w1'])
  })

  it('ayni kayit iki dalda gorunuyorsa her gorunumu ayri sonuctur', () => {
    // w1 hem s1 hem s2 tarafindan karsilanir (skip-level).
    const reqs = [
      req('s1', 'REQ-SYS-001', REQ_TYPE.SYSTEM),
      req('s2', 'REQ-SYS-002', REQ_TYPE.SYSTEM),
      req('w1', 'REQ-SW-001', REQ_TYPE.SOFTWARE),
    ]
    const hits = findMindMapMatches(
      buildMindMapGraph(reqs, [], [link('s1', 'w1'), link('s2', 'w1')]),
      'REQ-SW-001',
    )
    expect(hits.map((h) => h.key)).toEqual(['s1>w1', 's2>w1'])
  })

  it('dongulu bagda sonsuz dolasmaz', () => {
    const reqs = [
      req('a', 'REQ-SYS-001', REQ_TYPE.SYSTEM),
      req('b', 'REQ-SW-001', REQ_TYPE.SOFTWARE),
    ]
    const hits = findMindMapMatches(
      buildMindMapGraph(reqs, [], [link('a', 'b'), link('b', 'a')]),
      'REQ-',
    )
    expect(hits.length).toBeLessThan(10)
  })
})

describe('expandedWithPath — bulunan düğümün yolunu açar', () => {
  it('hedefin ATALARINI acar, hedefin kendisini acmaz', () => {
    const hit = findMindMapMatches(buildMindMapGraph(REQS, TESTS, LINKS), 'REQ-SW-001')[0]
    const opened = expandedWithPath(new Set(), hit)
    expect(opened.has('u1')).toBe(true)
    expect(opened.has('u1>s1')).toBe(true)
    expect(opened.has('u1>s1>w1')).toBe(false)
  })

  it('acilmis yol ile hedef gercekten duzene girer', () => {
    const graph = buildMindMapGraph(REQS, TESTS, LINKS)
    const hit = findMindMapMatches(graph, 'REQ-SW-001')[0]
    const before = layoutMindMap(graph, defaultExpandedKeys(graph), { orientation: 'vertical' })
    expect(before.nodes.some((n) => n.key === hit.key)).toBe(false)
    const after = layoutMindMap(graph, expandedWithPath(defaultExpandedKeys(graph), hit), {
      orientation: 'vertical',
    })
    expect(after.nodes.some((n) => n.key === hit.key)).toBe(true)
  })

  it('mevcut acik dallari korur ve gecersiz girdide cakilmaz', () => {
    expect(expandedWithPath(new Set(['x']), null).has('x')).toBe(true)
  })
})
