// ============================================================================
//  baselineDiff.test.js — Fark raporunun sunumu ve disa aktarimi (#128).
//  DB/DOM gerektirmez: baselineDiff.js bilincli olarak saftir.
// ============================================================================
import { describe, it, expect } from 'vitest'
import {
  DIFF_ENTITY_TYPES,
  buildDiffPrintHtml,
  changedEntityTypes,
  describeFields,
  diffToCsv,
  filterEntries,
  formatDiffValue,
  slugifyLabel,
} from '../baselineDiff.js'

const DIFF = {
  from: { id: 's1', name: 'v1', label: 'v1.0' },
  to: { id: 'live', name: 'Canli', isLive: true },
  summary: {
    requirement: { added: 1, removed: 0, changed: 1, unchanged: 3 },
    testcase: { added: 0, removed: 1, changed: 0, unchanged: 0 },
    link: { added: 0, removed: 0, changed: 0, unchanged: 2 },
    glossary: { added: 0, removed: 0, changed: 0, unchanged: 0 },
    attributeDef: { added: 0, removed: 0, changed: 0, unchanged: 1 },
  },
  totals: { added: 1, removed: 1, changed: 1, unchanged: 6 },
  entries: [
    {
      entityType: 'requirement',
      entityId: 'r1',
      label: 'REQ-SYS-001',
      status: 'changed',
      fields: [
        { field: 'title', from: 'Eski', to: 'Yeni' },
        { field: 'locked', from: false, to: true },
      ],
    },
    {
      entityType: 'requirement',
      entityId: 'r2',
      label: 'REQ-SYS-002',
      status: 'added',
      fields: [],
    },
    { entityType: 'testcase', entityId: 't1', label: 'TC-SYS-001', status: 'removed', fields: [] },
  ],
}

describe('formatDiffValue', () => {
  it('bos degerler icin yer tutucu doner', () => {
    expect(formatDiffValue(null)).toBe('—')
    expect(formatDiffValue(undefined)).toBe('—')
    expect(formatDiffValue('')).toBe('—')
    expect(formatDiffValue([], { emptyLabel: 'yok' })).toBe('yok')
  })

  it('mantiksal, dizi ve nesne degerlerini okunur hale getirir', () => {
    expect(formatDiffValue(true)).toBe('true')
    expect(formatDiffValue(false)).toBe('false')
    expect(formatDiffValue(['a', 'b'])).toBe('a, b')
    expect(formatDiffValue({ dal: 'A' })).toBe('{"dal":"A"}')
  })

  it('uzun metni KIRPMAZ — denetim kaydi eksik olmamali', () => {
    const long = 'x'.repeat(500)
    expect(formatDiffValue(long)).toHaveLength(500)
  })
})

describe('describeFields', () => {
  it('alan degisikliklerini "alan: eski -> yeni" olarak birlestirir', () => {
    expect(describeFields(DIFF.entries[0].fields)).toBe(
      'title: Eski -> Yeni | locked: false -> true',
    )
  })

  it('alan yoksa bos metin doner', () => {
    expect(describeFields([])).toBe('')
    expect(describeFields(undefined)).toBe('')
  })
})

describe('changedEntityTypes', () => {
  it('yalnizca degisiklik iceren tipleri dondurur', () => {
    const keys = changedEntityTypes(DIFF.summary).map((e) => e.key)
    expect(keys).toEqual(['requirement', 'testcase'])
  })

  it('hic degisiklik yoksa bos liste doner', () => {
    const clean = Object.fromEntries(
      DIFF_ENTITY_TYPES.map((e) => [e.key, { added: 0, removed: 0, changed: 0, unchanged: 5 }]),
    )
    expect(changedEntityTypes(clean)).toEqual([])
  })
})

describe('filterEntries', () => {
  it('varsayilan olarak hepsini dondurur', () => {
    expect(filterEntries(DIFF.entries)).toHaveLength(3)
  })

  it('duruma gore filtreler', () => {
    expect(filterEntries(DIFF.entries, { status: 'added' })).toHaveLength(1)
    expect(filterEntries(DIFF.entries, { status: 'removed' })[0].entityId).toBe('t1')
  })

  it('kayit tipine gore filtreler', () => {
    expect(filterEntries(DIFF.entries, { entityType: 'testcase' })).toHaveLength(1)
  })

  it('kod ve alan adi uzerinden arar (buyuk-kucuk harf onemsiz)', () => {
    expect(filterEntries(DIFF.entries, { query: 'req-sys-001' })).toHaveLength(1)
    expect(filterEntries(DIFF.entries, { query: 'LOCKED' })).toHaveLength(1)
    expect(filterEntries(DIFF.entries, { query: 'yok-boyle' })).toHaveLength(0)
  })
})

describe('diffToCsv', () => {
  const headers = ['Tip', 'Kayit', 'Durum', 'Degisiklikler']

  it('BOM ile baslar ve baslik satirini yazar', () => {
    const csv = diffToCsv(DIFF, { headers })
    expect(csv.startsWith('﻿')).toBe(true)
    expect(csv.split('\r\n')[0]).toBe('﻿Tip,Kayit,Durum,Degisiklikler')
  })

  it('her fark satirini alan degisiklikleriyle yazar', () => {
    const lines = diffToCsv(DIFF, { headers }).split('\r\n')
    expect(lines[1]).toContain('REQ-SYS-001')
    expect(lines[1]).toContain('title: Eski -> Yeni')
    expect(lines[3]).toContain('TC-SYS-001')
  })

  it('etiketleri cevirmek icin labelOf kullanilir', () => {
    const csv = diffToCsv(DIFF, { headers, labelOf: (k) => `<${k}>` })
    expect(csv).toContain('<requirement>')
    expect(csv).toContain('<changed>')
  })

  it('ayrac/tirnak iceren metin kacisli yazilir', () => {
    const tricky = {
      entries: [
        {
          entityType: 'requirement',
          entityId: 'r9',
          label: 'A,B',
          status: 'changed',
          fields: [{ field: 'title', from: 'x"y', to: 'z' }],
        },
      ],
    }
    const line = diffToCsv(tricky, { headers }).split('\r\n')[1]
    expect(line).toContain('"A,B"')
    expect(line).toContain('""y')
  })
})

describe('buildDiffPrintHtml', () => {
  const html = buildDiffPrintHtml({
    documentTitle: 'Surum Farki Raporu',
    projectName: 'Proje',
    fromLabel: 'v1.0',
    toLabel: 'Canli',
    summaryText: '+1 · -1 · ~1',
    headers: ['Tip', 'Kayit', 'Durum', 'Degisiklikler'],
    diff: DIFF,
    generatedAt: new Date('2026-01-01T10:00:00Z'),
  })

  it('baslik, taraflar ve ozet belgeye yazilir', () => {
    expect(html).toContain('Surum Farki Raporu')
    expect(html).toContain('v1.0')
    expect(html).toContain('Canli')
    expect(html).toContain('+1 · -1 · ~1')
  })

  it('her fark satiri durumuna gore siniflanir (renk kodu)', () => {
    expect(html).toContain('<tr class="changed">')
    expect(html).toContain('<tr class="added">')
    expect(html).toContain('<tr class="removed">')
  })

  it('HTML kacisi: kayit metni etiket olarak yorumlanmaz', () => {
    const evil = buildDiffPrintHtml({
      documentTitle: 'x',
      headers: ['a'],
      fromLabel: 'a',
      toLabel: 'b',
      summaryText: '',
      diff: {
        entries: [
          {
            entityType: 'requirement',
            entityId: 'x',
            label: '<script>alert(1)</script>',
            status: 'added',
            fields: [],
          },
        ],
      },
    })
    expect(evil).not.toContain('<script>alert(1)</script>')
    expect(evil).toContain('&lt;script&gt;')
  })
})

describe('slugifyLabel', () => {
  it('Turkce karakterleri dosya adina uygun hale getirir', () => {
    expect(slugifyLabel('Sürüm v1.0 — Teslim')).toBe('surum-v1-0-teslim')
    expect(slugifyLabel('ÇĞİÖŞÜ')).toBe('cgiosu')
  })

  it('bos girdide yedek ad kullanilir', () => {
    expect(slugifyLabel('')).toBe('fark')
    expect(slugifyLabel('!!!', 'yedek')).toBe('yedek')
  })
})
