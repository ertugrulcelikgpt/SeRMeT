// ============================================================================
//  partTree.test.js — Bilesen agaci yardimcilari (Issue #135).
//  Issue'daki ornek agac (Sistem / KKT / AMTB{GY1,GY2} / STC{GY1,GY2,GY3})
//  fikstur olarak kullanilir: ayni adli GY1'lerin FARKLI Parca No ile ayirt
//  edilebildigi burada da dogrulanir.
// ============================================================================
import { describe, expect, test } from 'vitest'
import {
  allNodeIds,
  buildComponentTree,
  filterComponentTree,
  flattenComponentTree,
  issuesByComponent,
  matchesQuery,
  pathLabel,
  severityOf,
} from '../partTree.js'

const ROWS = [
  { id: 'sys', parentId: null, name: 'Sistem', partNo: '010.00.001', order: 0 },
  { id: 'kkt', parentId: 'sys', name: 'KKT', partNo: '010.00.002', order: 0 },
  { id: 'amtb', parentId: 'sys', name: 'AMTB', partNo: '010.00.003', partNoBlock: '320', order: 1 },
  { id: 'stc', parentId: 'sys', name: 'STC', partNo: '010.00.004', partNoBlock: '340', order: 2 },
  { id: 'a-gy1', parentId: 'amtb', name: 'GY1', partNo: '320.00.001', order: 0 },
  { id: 'a-gy2', parentId: 'amtb', name: 'GY2', partNo: '320.00.002', order: 1 },
  { id: 's-gy1', parentId: 'stc', name: 'GY1', partNo: '340.00.001', order: 0 },
  { id: 's-gy2', parentId: 'stc', name: 'GY2', partNo: '340.00.002', order: 1 },
  { id: 's-gy3', parentId: 'stc', name: 'GY3', partNo: '340.00.003', order: 2 },
]

const ALL = new Set(ROWS.map((r) => r.id))

describe('buildComponentTree', () => {
  test('tek kok ve dogru dallanma kurar', () => {
    const roots = buildComponentTree(ROWS)
    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('Sistem')
    expect(roots[0].children.map((c) => c.name)).toEqual(['KKT', 'AMTB', 'STC'])
  })

  test('ayni adli GY1 dugumleri FARKLI dallarda ayri kalir', () => {
    const roots = buildComponentTree(ROWS)
    const amtb = roots[0].children.find((c) => c.name === 'AMTB')
    const stc = roots[0].children.find((c) => c.name === 'STC')
    const amtbGy1 = amtb.children.find((c) => c.name === 'GY1')
    const stcGy1 = stc.children.find((c) => c.name === 'GY1')
    expect(amtbGy1.partNo).toBe('320.00.001')
    expect(stcGy1.partNo).toBe('340.00.001')
    expect(amtbGy1.id).not.toBe(stcGy1.id)
  })

  test('ustu listede olmayan dugum KAYBOLMAZ, kokte gorunur', () => {
    const roots = buildComponentTree([
      { id: 'x', parentId: 'yok', name: 'Sahipsiz', partNo: '900.00.001' },
    ])
    expect(roots).toHaveLength(1)
    expect(roots[0].name).toBe('Sahipsiz')
  })

  test('kardesler order, sonra Parca No ile siralanir', () => {
    const shuffled = [...ROWS].reverse()
    const roots = buildComponentTree(shuffled)
    expect(roots[0].children.map((c) => c.name)).toEqual(['KKT', 'AMTB', 'STC'])
  })
})

describe('matchesQuery / filterComponentTree', () => {
  test('ad ve Parca No uzerinden eslesir, buyuk-kucuk harf onemsiz', () => {
    const row = { name: 'Su Pompası', partNo: '320.00.001' }
    expect(matchesQuery(row, 'pompa')).toBe(true)
    expect(matchesQuery(row, 'POMPA')).toBe(true)
    expect(matchesQuery(row, '320.00')).toBe(true)
    expect(matchesQuery(row, 'motor')).toBe(false)
    expect(matchesQuery(row, '')).toBe(true)
  })

  test('Parca No aramasi TEK bir dugumu getirir (ayni adlilari ayirir)', () => {
    const roots = filterComponentTree(buildComponentTree(ROWS), '340.00.001')
    const flat = flattenComponentTree(roots, ALL)
    const leaves = flat.filter(({ node }) => node.name === 'GY1')
    expect(leaves).toHaveLength(1)
    expect(leaves[0].node.partNo).toBe('340.00.001')
  })

  test('eslesen dugumun USTLERI korunur (baglam kaybolmaz)', () => {
    const roots = filterComponentTree(buildComponentTree(ROWS), 'GY3')
    const names = flattenComponentTree(roots, ALL).map(({ node }) => node.name)
    expect(names).toEqual(['Sistem', 'STC', 'GY3'])
  })

  test('bos sorgu agaci oldugu gibi birakir', () => {
    const tree = buildComponentTree(ROWS)
    expect(filterComponentTree(tree, '  ')).toBe(tree)
  })
})

describe('flattenComponentTree', () => {
  test('kapali dugumun altlari cizilmez', () => {
    const roots = buildComponentTree(ROWS)
    const flat = flattenComponentTree(roots, new Set())
    expect(flat).toHaveLength(1)
    expect(flat[0]).toMatchObject({ depth: 0, hasChildren: true })
  })

  test('acik dugumlerde derinlik girintisi dogru', () => {
    const flat = flattenComponentTree(buildComponentTree(ROWS), ALL)
    const byName = Object.fromEntries(flat.map((f) => [`${f.node.id}`, f.depth]))
    expect(byName.sys).toBe(0)
    expect(byName.amtb).toBe(1)
    expect(byName['a-gy1']).toBe(2)
    expect(flat).toHaveLength(ROWS.length)
  })
})

describe('allNodeIds', () => {
  test('tum dugumleri toplar', () => {
    expect(new Set(allNodeIds(buildComponentTree(ROWS)))).toEqual(ALL)
  })
})

describe('issuesByComponent / severityOf', () => {
  const issues = [
    { code: 'BLOCK_MISMATCH', severity: 'error', componentId: 'a-gy1' },
    { code: 'NO_REQUIREMENTS', severity: 'info', componentId: 'a-gy1' },
    { code: 'DUPLICATE_SIBLING_NAME', severity: 'warn', componentId: 'kkt' },
    { code: 'CYCLE', severity: 'error', componentId: null },
  ]

  test('dugum bazinda gruplar, componentId olmayanlari atlar', () => {
    const map = issuesByComponent(issues)
    expect(map.get('a-gy1')).toHaveLength(2)
    expect(map.get('kkt')).toHaveLength(1)
    expect(map.size).toBe(2)
  })

  test('rozet seviyesi en agir bulguya gore belirlenir', () => {
    expect(severityOf([{ severity: 'info' }, { severity: 'error' }])).toBe('error')
    expect(severityOf([{ severity: 'info' }, { severity: 'warn' }])).toBe('warn')
    expect(severityOf([{ severity: 'info' }])).toBe('info')
    expect(severityOf([])).toBe(null)
  })
})

describe('pathLabel', () => {
  const byId = new Map(ROWS.map((r) => [r.id, r]))

  test('kokten kendisine ad zinciri uretir', () => {
    expect(pathLabel(byId.get('s-gy1'), byId)).toBe('Sistem / STC / GY1')
    expect(pathLabel(byId.get('a-gy1'), byId)).toBe('Sistem / AMTB / GY1')
  })

  test('dongude sonsuza gitmez', () => {
    const cyclic = new Map([
      ['a', { id: 'a', parentId: 'b', name: 'A' }],
      ['b', { id: 'b', parentId: 'a', name: 'B' }],
    ])
    expect(pathLabel(cyclic.get('a'), cyclic)).toBe('B / A')
  })
})
