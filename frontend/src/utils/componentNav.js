// ============================================================================
//  componentNav.js — Issue #140: BILESEN bazli gereksinim menusu.
//
//  SORUN: Bilesenler sayfasinda tanimlanan bilesene (#138) gereksinim
//  baglandiginda (Requirement.componentId) bu bag yalnizca o sayfada
//  karsiligini buluyordu; ekibin gunluk calisma alani olan "Gereksinimler"
//  menusu urun kiriliminden habersiz kaliyordu.
//
//  COZUM: Menudeki bilesen girdileri TURETILIR — ne yeni bir `pageKey` ne de
//  yeni bir NavItem kaydi uretilir. Kaynak dogrudan bilesen agaci + gereksinim
//  listesidir; her mutasyon sonrasi AppContext zaten tum koleksiyonlari
//  tazeledigi icin girdiler CANLIDIR: ad degisince etiket, bag kalkinca sayac
//  guncellenir, bilesen silinince girdi kaybolur.
//
//  NEDEN YENI pageKey URETILMEZ: `pageKey` ayni zamanda 12 kademeli izin
//  matrisinde bir bilesen anahtaridir (utils/permissions.js componentKeyOf,
//  backend cascade.js). Kullanicinin urettigi bir anahtar izin matrisinde
//  karsiligi olmayan bir sayfa yaratirdi. Bunun yerine girdiler TEK bir sanal
//  sayfanin (`req-component`) componentId parametreli gorunumudur; izin
//  kontrolu listelenen HER KAYDIN kendi sayfa anahtari uzerinden yapilir
//  (User -> req-user, System -> req-system, SW/HW -> req-subsystem).
// ============================================================================
import { buildManualComponentTree } from './components.js'
import { componentKeyOf } from './permissions.js'

// Sanal sayfa anahtari: Topbar basligi ve sayfa yonlendirmesi icin kullanilir.
// NAV_PAGE_KEYS'e EKLENMEZ — menude saklanabilen bir sayfa tipi degildir.
export const COMPONENT_PAGE_KEY = 'req-component'

// Menu anahtari bicimi: `req-component:<componentId>`.
const PREFIX = `${COMPONENT_PAGE_KEY}:`

export const componentNavKey = (componentId) => `${PREFIX}${componentId}`

/** Menu anahtarindan bilesen id'si; bilesen girdisi degilse null. */
export const componentIdFromNavKey = (key) =>
  typeof key === 'string' && key.startsWith(PREFIX) ? key.slice(PREFIX.length) || null : null

export const isComponentNavKey = (key) => componentIdFromNavKey(key) != null

/**
 * Bir gereksinimin okunup okunamayacagi: kaydin KENDI sayfa anahtari uzerinden.
 * Boylece yetkisiz kullanici, sabit sayfalarda goremedigi bir kaydi bilesen
 * listesinde de goremez.
 */
export const canReadRequirement = (can, r) =>
  Boolean(r) && can('read', componentKeyOf('requirement', r.type))

/**
 * Bir bilesene (ve alt bilesenlerine) bagli gereksinimler.
 * Alt kirilim DAHILDIR: menude alt bilesen ayrica gorunse de ust girdiye
 * tiklayan kullanici "bu dalin tum gereksinimlerini" gormeyi bekler —
 * Bilesenler sayfasindaki liste de ayni kurali uygular.
 */
export function requirementsOfComponent(components, requirements, componentId, { can } = {}) {
  if (!componentId) return []
  const tree = buildManualComponentTree(components)
  if (!tree.byId.has(componentId)) return []
  const ids = new Set(subtreeIds(tree, componentId))
  return (requirements || []).filter(
    (r) => r?.componentId && ids.has(r.componentId) && (!can || canReadRequirement(can, r)),
  )
}

/** Bilesen + tum alt bilesenleri (kendisi dahil). */
function subtreeIds(tree, id) {
  const out = []
  const seen = new Set()
  const walk = (key) => {
    if (seen.has(key)) return
    seen.add(key)
    out.push(key)
    for (const child of tree.childrenOf.get(key) || []) walk(child.id)
  }
  walk(id)
  return out
}

/**
 * Menude gosterilecek IC ICE bilesen girdileri.
 *
 * Her girdi: { key, componentId, name, count, children }
 *   key      : navigasyon anahtari (`req-component:<id>`)
 *   name     : bilesen adi (etiket i18n ile "<ad> Gereksinimleri" olur)
 *   count    : bu bilesende (alt kirilimi dahil) kullanicinin GOREBILDIGI
 *              gereksinim sayisi — rozet olarak gosterilir
 *   children : alt bilesen girdileri (menude ic ice)
 *
 * Gereksinimi olmayan bilesen de DONER: girdi `0` rozetiyle gorunur (bkz.
 * Issue #140 acik sorular — secilen kural). Boylece yeni olusturulan bir
 * bilesen menuye hemen duser: kullanici gereksinim baglamadan once de
 * dalini gorur.
 */
export function buildComponentNavTree(components, requirements, { can } = {}) {
  const tree = buildManualComponentTree(components)
  // Gereksinimleri bilesen bazinda TEK GECISTE indeksle (satir basina tarama yok).
  const ownCount = new Map()
  for (const r of requirements || []) {
    if (!r?.componentId || !tree.byId.has(r.componentId)) continue
    if (can && !canReadRequirement(can, r)) continue
    ownCount.set(r.componentId, (ownCount.get(r.componentId) || 0) + 1)
  }
  const seen = new Set()
  const build = (node) => {
    if (seen.has(node.id)) return null // bozuk/dongusel parentId korumasi
    seen.add(node.id)
    const children = (tree.childrenOf.get(node.id) || []).map(build).filter(Boolean)
    const count = children.reduce((sum, c) => sum + c.count, ownCount.get(node.id) || 0)
    return {
      key: componentNavKey(node.id),
      componentId: node.id,
      name: node.name || '',
      count,
      children,
    }
  }
  return tree.roots.map(build).filter(Boolean)
}

/** Duz liste (test/arama kolayligi icin) — ic ice girdileri sirayla gezer. */
export function flattenComponentNav(entries) {
  const out = []
  const walk = (list, depth) => {
    for (const e of list) {
      out.push({ ...e, depth })
      walk(e.children, depth + 1)
    }
  }
  walk(entries || [], 0)
  return out
}
