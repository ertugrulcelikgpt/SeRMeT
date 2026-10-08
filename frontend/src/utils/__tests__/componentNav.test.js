// ============================================================================
//  componentNav.test.js — Issue #140: bilesen bazli gereksinim menu girdileri.
//
//  Kapsam:
//   - Girdiler bilesen agacindan TURETILIR (ic ice kirilim korunur)
//   - Sayac: bilesenin KENDI + ALT bilesenlerindeki gereksinim adedi
//   - Gereksinimi olmayan bilesen de gorunur (rozet 0)
//   - Izin: kullanicinin goremedigi kayit ne sayilir ne listelenir
//   - Menu anahtari cozumleme (`req-component:<id>`)
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  COMPONENT_PAGE_KEY,
  buildComponentNavTree,
  componentIdFromNavKey,
  componentNavKey,
  flattenComponentNav,
  isComponentNavKey,
  requirementsOfComponent,
} from '../componentNav.js'

// A Donanimi > Alt Kart ; ayrica bos bir bilesen (Bos Kutu).
const components = [
  { id: 'c1', parentId: null, name: 'A Donanımı', sortIndex: 0 },
  { id: 'c2', parentId: 'c1', name: 'Alt Kart', sortIndex: 0 },
  { id: 'c3', parentId: null, name: 'Boş Kutu', sortIndex: 1 },
]

const requirements = [
  { id: 'r1', text_id: 'EH-USR-001', type: 'User Requirement', componentId: 'c1' },
  { id: 'r2', text_id: 'EH-SYS-001', type: 'System Requirement', componentId: 'c1' },
  { id: 'r3', text_id: 'EH-SW-001', type: 'Software Requirement', componentId: 'c2' },
  { id: 'r4', text_id: 'EH-USR-002', type: 'User Requirement', componentId: null },
]

const allowAll = () => true

describe('componentNav — menu anahtari', () => {
  it('anahtar uretir ve geri cozer', () => {
    expect(componentNavKey('c1')).toBe(`${COMPONENT_PAGE_KEY}:c1`)
    expect(componentIdFromNavKey(`${COMPONENT_PAGE_KEY}:c1`)).toBe('c1')
    expect(isComponentNavKey(`${COMPONENT_PAGE_KEY}:c1`)).toBe(true)
  })

  it('sabit sayfa anahtarlarini bilesen girdisi saymaz', () => {
    for (const key of ['req-user', 'req-system', 'req-subsystem', 'glossary', 'dashboard']) {
      expect(componentIdFromNavKey(key)).toBeNull()
      expect(isComponentNavKey(key)).toBe(false)
    }
  })
})

describe('componentNav — menu agaci', () => {
  it('alt bilesen ust bilesenin ALTINDA ic ice durur', () => {
    const tree = buildComponentNavTree(components, requirements, { can: allowAll })
    expect(tree.map((e) => e.name)).toEqual(['A Donanımı', 'Boş Kutu'])
    expect(tree[0].children.map((e) => e.name)).toEqual(['Alt Kart'])
  })

  it('sayac alt kirilimi DAHIL eder; bagsiz gereksinim sayilmaz', () => {
    const [aDonanimi] = buildComponentNavTree(components, requirements, { can: allowAll })
    expect(aDonanimi.count).toBe(3) // r1 + r2 (kendi) + r3 (alt kart)
    expect(aDonanimi.children[0].count).toBe(1)
  })

  it('gereksinimi olmayan bilesen gorunur ve rozeti 0 olur', () => {
    const tree = buildComponentNavTree(components, requirements, { can: allowAll })
    const bos = tree.find((e) => e.name === 'Boş Kutu')
    expect(bos).toBeTruthy()
    expect(bos.count).toBe(0)
  })

  it('bilesen silinince girdisi kaybolur', () => {
    const tree = buildComponentNavTree(
      components.filter((c) => c.id !== 'c3'),
      requirements,
      { can: allowAll },
    )
    expect(tree.map((e) => e.name)).toEqual(['A Donanımı'])
  })

  it('bilesen adi degisince etiket kaynagi da degisir', () => {
    const renamed = components.map((c) => (c.id === 'c1' ? { ...c, name: 'B Donanımı' } : c))
    const tree = buildComponentNavTree(renamed, requirements, { can: allowAll })
    expect(tree[0].name).toBe('B Donanımı')
  })

  it('bag kaldirilinca sayac duser', () => {
    const unlinked = requirements.map((r) => (r.id === 'r1' ? { ...r, componentId: null } : r))
    const [aDonanimi] = buildComponentNavTree(components, unlinked, { can: allowAll })
    expect(aDonanimi.count).toBe(2)
  })

  it('yetkisiz kullanicinin goremedigi kayit sayilmaz', () => {
    // Yalnizca User Gereksinimleri okunabiliyor: r1 sayilir, r2/r3 sayilmaz.
    const can = (perm, key) => perm === 'read' && key === 'req-user'
    const [aDonanimi] = buildComponentNavTree(components, requirements, { can })
    expect(aDonanimi.count).toBe(1)
    expect(aDonanimi.children[0].count).toBe(0)
  })

  it('dongusel parentId menuyu kilitlemez', () => {
    const cyclic = [
      { id: 'x', parentId: 'y', name: 'X' },
      { id: 'y', parentId: 'x', name: 'Y' },
    ]
    expect(() => buildComponentNavTree(cyclic, [], { can: allowAll })).not.toThrow()
  })

  it('duzlestirme derinlik bilgisi tasir', () => {
    const flat = flattenComponentNav(
      buildComponentNavTree(components, requirements, { can: allowAll }),
    )
    expect(flat.map((e) => [e.name, e.depth])).toEqual([
      ['A Donanımı', 0],
      ['Alt Kart', 1],
      ['Boş Kutu', 0],
    ])
  })
})

describe('componentNav — bilesen gereksinim listesi', () => {
  it('seviye farki gozetmeksizin alt kirilim dahil listeler', () => {
    const rows = requirementsOfComponent(components, requirements, 'c1', { can: allowAll })
    expect(rows.map((r) => r.text_id)).toEqual(['EH-USR-001', 'EH-SYS-001', 'EH-SW-001'])
  })

  it('yetkisiz kullaniciya kapali kayitlari vermez', () => {
    const can = (perm, key) => perm === 'read' && key === 'req-user'
    const rows = requirementsOfComponent(components, requirements, 'c1', { can })
    expect(rows.map((r) => r.text_id)).toEqual(['EH-USR-001'])
  })

  it('bilinmeyen / silinmis bilesen icin bos liste doner', () => {
    expect(requirementsOfComponent(components, requirements, 'yok', { can: allowAll })).toEqual([])
    expect(requirementsOfComponent(components, requirements, null, { can: allowAll })).toEqual([])
  })
})
