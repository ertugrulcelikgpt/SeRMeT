// ============================================================================
//  components.test.js — Issue #129: bilesen bazli gorunumun saf yardimcilari.
//    - PBS agacindan bilesen turetme + TID (anahat) numarasi
//    - bilesenin TUM gereksinimleri (hiyerarsi seviyesinden bagimsiz)
//    - bagli SGD (ust/alt kayitlar) ve dogrulama yontemi
//    - CSV / yazdirma (PDF) ciktilari
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  COMPONENT_SOURCE,
  FIELD_NONE_KEY,
  buildComponentPrintHtml,
  buildComponentViewRows,
  buildComponents,
  buildRequirementTree,
  buildSatisfiesIndex,
  componentRowsToCsv,
  methodAttributeKeys,
  methodCodeOf,
  methodCodesOf,
  slugify,
  subtreeRows,
  summarizeComponent,
  verificationMethodOf,
} from '../components.js'
import { buildVerificationIndex } from '../verification.js'

// Kullanim kilavuzundaki TID tablosunun kucuk bir kesiti:
//   1   Kahve Makinesi (User)
//   1.1 Su Deposu Alt Sistemi (System)   -> 1.1.1 Depo hacmi (SW)
//   1.2 Basınç Pompası Ünitesi (System)  -> 1.2.1 Pompa basıncı (HW)
//                                           1.2.2 Pompa gürültüsü (HW)
const REQS = [
  { id: 'u1', text_id: 'EH-TİD-USR-001', title: 'Kahve Makinesi', type: 'User Requirement' },
  {
    id: 's1',
    parentId: 'u1',
    text_id: 'EH-TİD-SYS-001',
    title: 'Su Deposu Alt Sistemi',
    type: 'System Requirement',
    field: 'Donanim',
  },
  {
    id: 's2',
    parentId: 'u1',
    text_id: 'EH-TİD-SYS-002',
    title: 'Basınç Pompası Ünitesi',
    type: 'System Requirement',
    field: 'Donanim',
  },
  {
    id: 'w1',
    parentId: 's1',
    text_id: 'EH-TİD-SW-001',
    title: 'Depo hacmi',
    description: '<p>Depo <b>1.5 litre</b> olmalıdır.</p>',
    type: 'Software Requirement',
    field: 'Yazilim',
  },
  {
    id: 'h1',
    parentId: 's2',
    text_id: 'EH-TİD-HW-001',
    title: 'Pompa basıncı',
    type: 'Hardware Requirement',
    attributes: { verification_method: 'Muayene' },
    verification_method: 'Muayene',
  },
  {
    id: 'h2',
    parentId: 's2',
    text_id: 'EH-TİD-HW-002',
    title: 'Pompa gürültüsü',
    type: 'Hardware Requirement',
  },
]

const LINKS = [
  { type: 'Satisfies', fromId: 'u1', toId: 's1' },
  { type: 'Satisfies', fromId: 'u1', toId: 's2' },
  { type: 'Satisfies', fromId: 's2', toId: 'h1' },
  { type: 'Verifies', fromId: 'h2', toId: 'tc1' },
]
const TESTS = [{ id: 'tc1', text_id: 'TC-SUB-001', status: 'Approved' }]

const componentByLabel = (list, label) => list.find((c) => c.label === label)

describe('buildRequirementTree — TİD (anahat) numaralari', () => {
  it('kardesler text_id sirasina gore numaralanir (PbsTree ile ayni)', () => {
    const tree = buildRequirementTree(REQS)
    expect(tree.infoById.get('u1').outline).toBe('1')
    expect(tree.infoById.get('s1').outline).toBe('1.1')
    expect(tree.infoById.get('s2').outline).toBe('1.2')
    expect(tree.infoById.get('h1').outline).toBe('1.2.1')
    expect(tree.infoById.get('h2').outline).toBe('1.2.2')
  })

  it('ebeveyni listede olmayan kayit kok sayilir (gizli/silinmis ust)', () => {
    const tree = buildRequirementTree([{ id: 'x', parentId: 'yok', text_id: 'A-1' }])
    expect(tree.roots.map((r) => r.id)).toEqual(['x'])
    expect(tree.infoById.get('x').outline).toBe('1')
  })

  it('kendini ebeveyn gosteren bozuk kayit sonsuz donguye girmez', () => {
    const tree = buildRequirementTree([{ id: 'x', parentId: 'x', text_id: 'A-1' }])
    expect(tree.infoById.get('x').depth).toBe(0)
  })
})

describe('buildComponents — bilesen listesi', () => {
  it('PBS: alt kirilimi olan her dugum bir bilesendir', () => {
    const list = buildComponents(REQS, { source: COMPONENT_SOURCE.PBS })
    expect(list.map((c) => c.label)).toEqual([
      'Kahve Makinesi',
      'Su Deposu Alt Sistemi',
      'Basınç Pompası Ünitesi',
    ])
    // Yaprak dugumler bilesen degildir.
    expect(componentByLabel(list, 'Pompa basıncı')).toBeUndefined()
  })

  it('bilesenin gereksinimleri SEVIYEDEN BAGIMSIZ tek listede gelir', () => {
    const list = buildComponents(REQS, { source: COMPONENT_SOURCE.PBS })
    const pump = componentByLabel(list, 'Basınç Pompası Ünitesi')
    expect(pump.rows.map((r) => r.text_id)).toEqual([
      'EH-TİD-SYS-002', // bilesenin kendi gereksinimi
      'EH-TİD-HW-001',
      'EH-TİD-HW-002',
    ])
    // Kok bilesen tum alt agaci icerir (User + System + Sub-system).
    const root = componentByLabel(list, 'Kahve Makinesi')
    expect(root.rows).toHaveLength(6)
  })

  it('bilesenler agactaki yerini (anahat + derinlik) tasir', () => {
    const list = buildComponents(REQS, { source: COMPONENT_SOURCE.PBS })
    const pump = componentByLabel(list, 'Basınç Pompası Ünitesi')
    expect(pump.outline).toBe('1.2')
    expect(pump.depth).toBe(1)
  })

  it('Alan kaynagi: her Alan bir bilesendir, alansizlar en sonda toplanir', () => {
    const list = buildComponents(REQS, { source: COMPONENT_SOURCE.FIELD })
    expect(list.map((c) => c.key)).toEqual(['Donanim', 'Yazilim', FIELD_NONE_KEY])
    expect(list[0].rows.map((r) => r.text_id)).toEqual(['EH-TİD-SYS-001', 'EH-TİD-SYS-002'])
  })

  it('urun agaci kurulmamis projede PBS hic bilesen uretmez', () => {
    const flat = REQS.map((r) => ({ ...r, parentId: null }))
    expect(buildComponents(flat, { source: COMPONENT_SOURCE.PBS })).toHaveLength(0)
    expect(buildComponents(flat, { source: COMPONENT_SOURCE.FIELD }).length).toBeGreaterThan(0)
  })
})

describe('doğrulama yöntemi (T / M / D / A / CoC)', () => {
  it('serbest metni standart koda cevirir', () => {
    expect(methodCodeOf('Test')).toBe('T')
    expect(methodCodeOf('muayene')).toBe('M')
    expect(methodCodeOf('Demonstrasyon')).toBe('D')
    expect(methodCodeOf('ANALİZ')).toBe('A')
    expect(methodCodeOf('CoC')).toBe('CoC')
    expect(methodCodeOf('bilinmeyen')).toBeNull()
  })

  it('yalnizca "doğrulama YÖNTEMİ" oznitelikleri secilir', () => {
    const defs = [
      { entityType: 'requirement', key: 'verification_method', label: 'Doğrulama Yöntemi' },
      { entityType: 'requirement', key: 'verification_status', label: 'Doğrulama Durumu' },
      { entityType: 'testcase', key: 'dogrulama_yontemi', label: 'Doğrulama Yöntemi' },
    ]
    expect(methodAttributeKeys(defs)).toEqual(['verification_method'])
  })

  it('oznitelik varsa oradan okunur', () => {
    const m = verificationMethodOf(REQS[4], { methodKeys: ['verification_method'] })
    expect(m).toMatchObject({ code: 'M', derived: false })
  })

  it('oznitelik yoksa bagli test senaryosundan T olarak TURETILIR', () => {
    const index = buildVerificationIndex(LINKS, TESTS)
    const m = verificationMethodOf(REQS[5], { methodKeys: [], verification: index.get('h2') })
    expect(m).toMatchObject({ code: 'T', derived: true })
  })

  it('ne oznitelik ne de test varsa bos birakilir (uydurulmaz)', () => {
    expect(verificationMethodOf(REQS[3], { methodKeys: [] })).toBeNull()
  })
})

describe('buildComponentViewRows — TİD tablosu satirlari', () => {
  const tree = buildRequirementTree(REQS)
  const ctx = {
    tree,
    satisfiesIndex: buildSatisfiesIndex(LINKS),
    verificationIndex: buildVerificationIndex(LINKS, TESTS),
    methodKeys: ['verification_method'],
  }
  const pump = componentByLabel(
    buildComponents(REQS, { source: COMPONENT_SOURCE.PBS, tree }),
    'Basınç Pompası Ünitesi',
  )
  const rows = buildComponentViewRows(pump.rows, ctx)

  it('her satir TID No / Text ID / Baslik / Metin tasir', () => {
    const tank = buildComponentViewRows([REQS[3]], ctx)[0]
    expect(tank.outline).toBe('1.1.1')
    expect(tank.text_id).toBe('EH-TİD-SW-001')
    expect(tank.title).toBe('Depo hacmi')
    // Gereksinim metni HTML'den arindirilmis duz metindir.
    expect(tank.text).toBe('Depo 1.5 litre olmalıdır.')
  })

  it('bagli SGD: ust ve alt kayitlar ayri ayri listelenir', () => {
    const unit = rows.find((r) => r.text_id === 'EH-TİD-SYS-002')
    expect(unit.linkedUp).toEqual(['EH-TİD-USR-001'])
    expect(unit.linkedDown).toEqual(['EH-TİD-HW-001'])
    // Kilavuzdaki TID tablosundaki gibi: ok/rozet yok, duz kod listesi.
    expect(unit.linkedText).toBe('EH-TİD-USR-001, EH-TİD-HW-001')
  })

  it('dogrulama yontemi sutunu doldurulur', () => {
    expect(rows.find((r) => r.text_id === 'EH-TİD-HW-001').method.code).toBe('M')
    expect(rows.find((r) => r.text_id === 'EH-TİD-HW-002').method).toMatchObject({
      code: 'T',
      derived: true,
    })
  })
})

describe('TİD tablosu düzeni (kullanım kılavuzu s.7)', () => {
  const tree = buildRequirementTree(REQS)
  const ctx = {
    tree,
    satisfiesIndex: buildSatisfiesIndex(LINKS),
    verificationIndex: buildVerificationIndex(LINKS, TESTS),
    methodKeys: ['verification_method'],
  }
  // Belge gibi SUREKLI tablo: tum agac, anahat sirasinda.
  const all = buildComponentViewRows(
    tree.roots.flatMap((r) => subtreeRows(tree, r.id)),
    ctx,
  )
  const row = (textId) => all.find((v) => v.text_id === textId)

  it('alt kirilimi olan kayit BILESEN BASLIGI satiridir', () => {
    // "Su Deposu Alt Sistemi" bir baslik satiri; altindaki "Depo hacmi" degil.
    expect(row('EH-TİD-SYS-001').isComponent).toBe(true)
    expect(row('EH-TİD-SW-001').isComponent).toBe(false)
  })

  it('alt kayitlar Baslik sutununda GIRINTILENIR', () => {
    expect(row('EH-TİD-USR-001').depth).toBe(0)
    expect(row('EH-TİD-SYS-001').depth).toBe(1)
    expect(row('EH-TİD-SW-001').depth).toBe(2)
  })

  it('girinti secime goredir: alt bilesen secilince tablo soldan baslar', () => {
    const pump = componentByLabel(
      buildComponents(REQS, { source: COMPONENT_SOURCE.PBS, tree }),
      'Basınç Pompası Ünitesi',
    )
    const rows = buildComponentViewRows(pump.rows, ctx)
    expect(rows[0].depth).toBe(0) // bilesenin kendisi
    expect(rows[1].depth).toBe(1) // altindakiler
  })

  it('bilesen bloklari anahat sirasinda arka arkaya gelir', () => {
    expect(all.map((v) => v.outline)).toEqual(['1', '1.1', '1.1.1', '1.2', '1.2.1', '1.2.2'])
  })
})

describe('birleşik doğrulama yöntemi (T/CoC, CoC/M)', () => {
  it('ayirici ile yazilmis birden fazla yontem cozulur', () => {
    expect(methodCodesOf('T/CoC')).toEqual(['T', 'CoC'])
    expect(methodCodesOf('CoC/M')).toEqual(['CoC', 'M'])
    expect(methodCodesOf('Test, Muayene')).toEqual(['T', 'M'])
    expect(methodCodesOf('T + T')).toEqual(['T']) // tekrar edenler tekillesir
    expect(methodCodesOf('bilinmeyen')).toEqual([])
  })

  it('satirda "T/CoC" olarak gosterilir', () => {
    const m = verificationMethodOf(
      { attributes: { verification_method: 'T/CoC' } },
      { methodKeys: ['verification_method'] },
    )
    expect(m.codes).toEqual(['T', 'CoC'])
    expect(m.label).toBe('T/CoC')
    expect(m.code).toBe('T') // birincil kod (geriye donuk)
  })
})

describe('summarizeComponent', () => {
  it('gereksinim sayisi ve DOGRULANMIS sayisini dondurur', () => {
    const index = buildVerificationIndex(LINKS, TESTS)
    const pump = componentByLabel(
      buildComponents(REQS, { source: COMPONENT_SOURCE.PBS }),
      'Basınç Pompası Ünitesi',
    )
    // Yalnizca h2'nin onayli bir testi var.
    expect(summarizeComponent(pump.rows, index)).toEqual({ total: 3, verified: 1 })
  })
})

describe('dışa aktarım', () => {
  const tree = buildRequirementTree(REQS)
  const ctx = {
    tree,
    satisfiesIndex: buildSatisfiesIndex(LINKS),
    verificationIndex: buildVerificationIndex(LINKS, TESTS),
    methodKeys: ['verification_method'],
  }
  const headers = ['TİD No', 'Text ID', 'Başlık', 'Gereksinim Metni', 'Bağlı SGD', 'Doğrulama']
  const rows = buildComponentViewRows(
    componentByLabel(
      buildComponents(REQS, { source: COMPONENT_SOURCE.PBS, tree }),
      'Basınç Pompası Ünitesi',
    ).rows,
    ctx,
  )

  it('CSV: BOM + baslik satiri + TID duzeninde sutunlar', () => {
    const csv = componentRowsToCsv(rows, { headers })
    const lines = csv.split('\r\n')
    expect(csv.startsWith('\ufeff')).toBe(true)
    expect(lines[0]).toBe('\ufeffTİD No,Text ID,Başlık,Gereksinim Metni,Bağlı SGD,Doğrulama')
    expect(lines[1]).toContain('1.2,EH-TİD-SYS-002,Basınç Pompası Ünitesi')
    expect(lines[2]).toContain('EH-TİD-HW-001')
  })

  it('CSV: ayrac/tirnak iceren metin kacisli yazilir', () => {
    const csv = componentRowsToCsv(
      [{ outline: '1', text_id: 'A-1', title: 'a,b', text: 'x "y"', linkedText: '', method: null }],
      { headers },
    )
    expect(csv).toContain('"a,b"')
    expect(csv).toContain('"x ""y"""')
  })

  it('yazdirma (PDF) HTML belgesi tablo ve baslik icerir', () => {
    const html = buildComponentPrintHtml({
      documentTitle: 'Bileşen Bazlı Gereksinim Listesi',
      projectName: 'Kahve Makinesi',
      componentLabel: 'Basınç Pompası Ünitesi',
      summary: '3 gereksinim · 1 doğrulandı',
      headers,
      viewRows: rows,
      methodLabel: (c) => c,
    })
    expect(html).toContain('<!doctype html>')
    expect(html).toContain('Basınç Pompası Ünitesi')
    expect(html).toContain('EH-TİD-HW-002')
    expect(html).toContain('3 gereksinim · 1 doğrulandı')
  })

  it('HTML kacisi: kayit metni etiket olarak yorumlanmaz', () => {
    const html = buildComponentPrintHtml({
      documentTitle: 'x',
      projectName: '',
      componentLabel: '<script>bad()</script>',
      summary: '',
      headers,
      viewRows: [],
    })
    expect(html).not.toContain('<script>bad()')
    expect(html).toContain('&lt;script&gt;')
  })

  it('slugify Turkce karakterleri dosya adina uygun hale getirir', () => {
    expect(slugify('Basınç Pompası Ünitesi')).toBe('basinc-pompasi-unitesi')
    expect(slugify('')).toBe('bilesen')
  })
})
