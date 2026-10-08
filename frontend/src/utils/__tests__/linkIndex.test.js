// ============================================================================
//  linkIndex.test.js — Issue #123: liste uzerinde bag okumasi icin TOPLU indeks.
//
//  Kapsam:
//   - Satisfies bagi IKI uca birden islenir (ust -> children, alt -> parents)
//   - Verifies bagi gereksinimde "tests", testte "parents" olur
//   - Assigned To bagi gereksinimde "terms" olur
//   - Ucu yuklu olmayan bag sessizce atlanir (yarim kalem gosterilmez)
//   - Listeler kod sirasinda (sayisal duyarli: 002 < 010) gelir
//   - Yetim (hic bagi olmayan) ve "alt bag beklenen ama yok" isaretleri
//   - Tum bag kumesi TEK GECISTE okunur (satir basina tarama yok)
// ============================================================================
import { describe, it, expect } from 'vitest'
import { buildLinkIndex, linkCountOf, linkSummaryOf, expectsChildLinks } from '../linkIndex.js'
import { LINK_TYPE, REQ_TYPE, TEST_TYPE, STATUS } from '../constants.js'

const usr = (id, code) => ({ id, text_id: code, title: `U ${code}`, type: REQ_TYPE.USER })
const sys = (id, code) => ({ id, text_id: code, title: `S ${code}`, type: REQ_TYPE.SYSTEM })
const sgo = (id, code, status = STATUS.APPROVED) => ({
  id,
  text_id: code,
  title: `T ${code}`,
  type: TEST_TYPE.ACCEPTANCE,
  status,
})

const fixture = () => {
  const requirements = [
    usr('u1', 'EH-KAHVE-TID-USR-001'),
    usr('u2', 'EH-KAHVE-TID-USR-002'),
    sys('s1', 'EH-KAHVE-TID-SGO-014'),
  ]
  const testCases = [sgo('t1', 'EH-KAHVE-TST-001')]
  const glossary = [{ id: 'g1', text_id: 'EH-KAHVE-SZL-001', term: 'Demleme' }]
  const links = [
    { id: 'l1', type: LINK_TYPE.SATISFIES, fromId: 'u1', toId: 's1' },
    { id: 'l2', type: LINK_TYPE.SATISFIES, fromId: 'u2', toId: 's1' },
    { id: 'l3', type: LINK_TYPE.VERIFIES, fromId: 'u1', toId: 't1' },
    { id: 'l4', type: LINK_TYPE.ASSIGNED_TO, fromId: 'u1', toId: 'g1' },
  ]
  return { requirements, testCases, glossary, links }
}

describe('buildLinkIndex', () => {
  it('Satisfies bagini iki uca birden isler (ust: children, alt: parents)', () => {
    const idx = buildLinkIndex(fixture())
    const child = linkSummaryOf(idx, { id: 's1', type: REQ_TYPE.SYSTEM })
    expect(child.parents.map((p) => p.node.text_id)).toEqual([
      'EH-KAHVE-TID-USR-001',
      'EH-KAHVE-TID-USR-002',
    ])
    const parent = linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER })
    expect(parent.children.map((c) => c.node.text_id)).toEqual(['EH-KAHVE-TID-SGO-014'])
  })

  it('Verifies bagi gereksinimde test, testte ust bag olarak gorunur', () => {
    const idx = buildLinkIndex(fixture())
    const req = linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER })
    expect(req.tests).toHaveLength(1)
    expect(req.tests[0].kind).toBe('testcase')
    expect(req.tests[0].node.status).toBe(STATUS.APPROVED)
    const test = linkSummaryOf(idx, { id: 't1', type: TEST_TYPE.ACCEPTANCE })
    expect(test.parents.map((p) => p.node.text_id)).toEqual(['EH-KAHVE-TID-USR-001'])
    expect(test.children).toHaveLength(0)
  })

  it('Assigned To bagi gereksinimde sozluk terimi olarak listelenir', () => {
    const idx = buildLinkIndex(fixture())
    const req = linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER })
    expect(req.terms.map((x) => x.node.term)).toEqual(['Demleme'])
  })

  it('ucu yuklu olmayan bagi atlar', () => {
    const f = fixture()
    f.links.push({ id: 'l9', type: LINK_TYPE.SATISFIES, fromId: 'u1', toId: 'yok' })
    const idx = buildLinkIndex(f)
    expect(linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER }).children).toHaveLength(1)
  })

  it('listeleri kod sirasinda (sayisal duyarli) dondurur', () => {
    const requirements = [
      usr('u1', 'EH-USR-001'),
      sys('s2', 'EH-SGO-002'),
      sys('s10', 'EH-SGO-010'),
    ]
    const links = [
      { id: 'a', type: LINK_TYPE.SATISFIES, fromId: 'u1', toId: 's10' },
      { id: 'b', type: LINK_TYPE.SATISFIES, fromId: 'u1', toId: 's2' },
    ]
    const idx = buildLinkIndex({ links, requirements })
    expect(
      linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER }).children.map((c) => c.node.text_id),
    ).toEqual(['EH-SGO-002', 'EH-SGO-010'])
  })

  it('toplam bag sayisini indeksten verir (satir basina tarama yok)', () => {
    const idx = buildLinkIndex(fixture())
    expect(linkCountOf(idx, 'u1')).toBe(3) // 1 alt + 1 test + 1 terim
    expect(linkCountOf(idx, 's1')).toBe(2)
    expect(linkCountOf(idx, 'bilinmeyen')).toBe(0)
  })

  it('bos/eksik girdilerde cokmez', () => {
    const idx = buildLinkIndex()
    expect(idx.size).toBe(0)
    expect(linkSummaryOf(idx, null).total).toBe(0)
  })
})

describe('yetim (bagsiz) kayit isaretleri', () => {
  it('hicbir bagi olmayan kaydi yetim isaretler', () => {
    const idx = buildLinkIndex(fixture())
    const s = linkSummaryOf(idx, { id: 'bos', type: REQ_TYPE.SOFTWARE })
    expect(s.orphan).toBe(true)
    expect(s.total).toBe(0)
  })

  it('bagi olan kayit yetim degildir', () => {
    const idx = buildLinkIndex(fixture())
    expect(linkSummaryOf(idx, { id: 's1', type: REQ_TYPE.SYSTEM }).orphan).toBe(false)
  })

  it('alt bag BEKLENEN ama alt bagi olmayan kaydi ayrica isaretler', () => {
    const idx = buildLinkIndex(fixture())
    // Bir testi dogrulayan ama alt gereksinimi olmayan User Requirement.
    const f = fixture()
    f.links = [{ id: 'l3', type: LINK_TYPE.VERIFIES, fromId: 'u1', toId: 't1' }]
    const only = buildLinkIndex(f)
    const s = linkSummaryOf(only, { id: 'u1', type: REQ_TYPE.USER })
    expect(s.orphan).toBe(false)
    expect(s.expectsChildren).toBe(true)
    expect(s.missingChildren).toBe(true)
    // Alt bagi olan User Requirement isaretlenmez.
    expect(linkSummaryOf(idx, { id: 'u1', type: REQ_TYPE.USER }).missingChildren).toBe(false)
  })

  it('yaprak tiplerde (Software/Hardware) alt bag beklenmez', () => {
    expect(expectsChildLinks(REQ_TYPE.USER)).toBe(true)
    expect(expectsChildLinks(REQ_TYPE.SYSTEM)).toBe(true)
    expect(expectsChildLinks(REQ_TYPE.SOFTWARE)).toBe(false)
    expect(expectsChildLinks(REQ_TYPE.HARDWARE)).toBe(false)
    expect(expectsChildLinks(undefined)).toBe(false)
    const idx = buildLinkIndex(fixture())
    expect(linkSummaryOf(idx, { id: 'yok', type: REQ_TYPE.SOFTWARE }).missingChildren).toBe(false)
  })
})
