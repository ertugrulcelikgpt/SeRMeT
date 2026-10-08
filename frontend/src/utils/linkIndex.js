// ============================================================================
//  linkIndex.js  —  Issue #123: Liste uzerinde HIZLI izlenebilirlik okumasi.
//
//  Tabloda "BAG" sutunu yalnizca bir SAYI gosteriyordu; bir kaydin hangi
//  kayda bagli oldugunu gormek icin LinkManager'i acmak gerekiyordu. Bu modul
//  o bilgiyi liste seviyesine tasir: proje genelindeki TUM baglari TEK
//  GECISTE (O(bag)) bir indekse cevirir, satir basina ayri bir filtreleme
//  (ve dolayisiyla ayri bir istek) YAPILMAZ.
//
//  Indeks anahtari kayit id'sidir; degeri o kaydin:
//    parents   : UST baglar  — gereksinimde "karsiladigi ust gereksinim(ler)",
//                testte "dogruladigi gereksinimler", sozlukte "atandigi
//                gereksinimler"
//    children  : ALT baglar  — bu gereksinimi karsilayan alt gereksinimler
//    tests     : bu gereksinimi DOGRULAYAN test senaryolari (sonucuyla)
//    terms     : bu gereksinime atanan sozluk terimleri
//
//  Her kalem { kind, node, linkId, suspect } tasir; `node` CANLI kayit
//  nesnesidir (kod + baslik + durum oradan okunur, tiklaninca ViewModal'a
//  ayni nesne verilir).
//
//  YETIM (bagsiz) KAYIT: hicbir bagi olmayan kayit. Ayrica "en az bir alt bag
//  beklenen" tipler (SATISFIES_CHILD_TYPES'ta cocuk tipi olan User/System
//  gereksinimleri) alt bagsizsa ayrica isaretlenir — DO-178C ayristirma
//  zincirinde kopukluk demektir.
//
//  Saf (pure) fonksiyonlar: yan etki yok, kolay test edilir.
// ============================================================================
import { LINK_TYPE, SATISFIES_CHILD_TYPES } from './constants.js'

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const EMPTY_SUMMARY = Object.freeze({
  parents: Object.freeze([]),
  children: Object.freeze([]),
  tests: Object.freeze([]),
  terms: Object.freeze([]),
  total: 0,
  orphan: true,
  expectsChildren: false,
  missingChildren: false,
})

/** Bos (hicbir bagi olmayan) ozet. */
export function emptyLinkSummary() {
  return EMPTY_SUMMARY
}

/** Bu tipin altina gereksinim baglanabiliyor mu (alt bag BEKLENIR mi)? */
export function expectsChildLinks(type) {
  return (SATISFIES_CHILD_TYPES[type] || []).length > 0
}

function entryOf(index, id) {
  let e = index.get(id)
  if (!e) {
    e = { parents: [], children: [], tests: [], terms: [] }
    index.set(id, e)
  }
  return e
}

function item(kind, node, l) {
  return { kind, node, linkId: l.id, suspect: Boolean(l.suspect) }
}

function byCode(a, b) {
  return collator.compare(String(a.node?.text_id || ''), String(b.node?.text_id || ''))
}

/**
 * Proje genelinde id -> bag ozeti indeksi kurar. TEK GECIS: her bag yalnizca
 * bir kez okunur ve IKI ucuna birden islenir (ust tarafa "cocuk", alt tarafa
 * "ebeveyn" olarak). Ucu yuklu olmayan (orn. baska sayfada kalan) bir bag
 * sessizce atlanir — yarim bir kalem gostermektense hic gostermemek yegdir.
 *
 * @param {Object}  src
 * @param {Array}   src.links         Tum izlenebilirlik baglari
 * @param {Array}   src.requirements  Proje gereksinimleri
 * @param {Array}   src.testCases     Proje test senaryolari
 * @param {Array}   src.glossary      Proje sozluk terimleri
 * @returns {Map<string, {parents,children,tests,terms}>}
 */
export function buildLinkIndex({ links, requirements, testCases, glossary } = {}) {
  const reqById = new Map((requirements || []).map((r) => [r.id, r]))
  const testById = new Map((testCases || []).map((tc) => [tc.id, tc]))
  const gloById = new Map((glossary || []).map((g) => [g.id, g]))
  const index = new Map()

  for (const l of links || []) {
    if (l.type === LINK_TYPE.SATISFIES) {
      // Depolama yonu sabittir: fromId = UST, toId = ALT gereksinim.
      const parent = reqById.get(l.fromId)
      const child = reqById.get(l.toId)
      if (!parent || !child) continue
      entryOf(index, child.id).parents.push(item('requirement', parent, l))
      entryOf(index, parent.id).children.push(item('requirement', child, l))
    } else if (l.type === LINK_TYPE.VERIFIES) {
      // fromId = gereksinim, toId = test senaryosu.
      const req = reqById.get(l.fromId)
      const tc = testById.get(l.toId)
      if (!req || !tc) continue
      entryOf(index, req.id).tests.push(item('testcase', tc, l))
      entryOf(index, tc.id).parents.push(item('requirement', req, l))
    } else if (l.type === LINK_TYPE.ASSIGNED_TO) {
      // fromId = gereksinim, toId = sozluk terimi.
      const req = reqById.get(l.fromId)
      const term = gloById.get(l.toId)
      if (!req || !term) continue
      entryOf(index, req.id).terms.push(item('glossary', term, l))
      entryOf(index, term.id).parents.push(item('requirement', req, l))
    }
  }

  // Listeler kod sirasinda okunur (EH-...-001, EH-...-002, EH-...-010).
  for (const e of index.values()) {
    e.parents.sort(byCode)
    e.children.sort(byCode)
    e.tests.sort(byCode)
    e.terms.sort(byCode)
  }
  return index
}

/**
 * Tek bir kaydin ozeti: bag listeleri + toplam + yetim/eksik-alt isaretleri.
 * `row` tip bilgisi icin gerekir (alt bag beklenir mi?); yalnizca id verilirse
 * (orn. sayac icin) tip bagimli isaretler kapali doner.
 */
export function linkSummaryOf(index, row) {
  const id = typeof row === 'string' ? row : row?.id
  const type = typeof row === 'string' ? null : row?.type
  const e = index?.get(id)
  const expects = expectsChildLinks(type)
  if (!e)
    return expects
      ? { ...EMPTY_SUMMARY, expectsChildren: true, missingChildren: true }
      : EMPTY_SUMMARY
  const total = e.parents.length + e.children.length + e.tests.length + e.terms.length
  return {
    ...e,
    total,
    orphan: total === 0,
    expectsChildren: expects,
    missingChildren: expects && e.children.length === 0,
  }
}

/** Satirin toplam bag sayisi (BAG sutunu) — indeksten, satir basina tarama yok. */
export function linkCountOf(index, id) {
  const e = index?.get(id)
  if (!e) return 0
  return e.parents.length + e.children.length + e.tests.length + e.terms.length
}
