// ============================================================================
//  modules.js — BASELINE KAPSAMI: "modul" (dokuman) tanimi. Issue #128.
//
//  IBM DOORS'ta baseline MODUL (dokuman) seviyesinde alinir; birden fazla
//  modul baseline'i bir BASELINE SET altinda toplanir. Bu projede modulun
//  karsiligi SOL MENU SAYFASIDIR (pageKey): Kullanici Gereksinimleri, Sistem
//  Gereksinimleri, Alt Sistem Gereksinimleri, test sayfalari ve Sozluk.
//
//  NEDEN AYRI BIR "modul" TABLOSU YOK: sayfa anahtarlari zaten SABITTIR
//  (navDefaults.js NAV_PAGE_KEYS) ve ayni anahtar izin matrisinde de bilesen
//  anahtaridir (constants.js componentKeyOf). Modulu bu anahtarin uzerine
//  kurmak, "bir kayit hangi modulde" sorusunu TEK kaynaktan cevaplar; kayda
//  ayri bir modul alani eklemek ayni bilgiyi ikinci kez saklamak olurdu.
//
//  Bir kaydin modulu TIPINDEN turer (componentKeyOf ile birebir ayni esleme):
//  bir gereksinim tipi degisirse modulu de degisir — bu dogrudur, cunku kayit
//  artik oteki sayfada listelenir.
// ============================================================================
import { REQ_TYPE, TEST_TYPE, componentKeyOf } from './constants.js';
import { NAV_PAGE_KEYS } from './navDefaults.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Baseline kapsami: tum proje mi, secili modul(ler) mi. */
export const SCOPE = { PROJECT: 'project', MODULE: 'module' };

/**
 * Modul tanimlari. `entityType` + `types` bir kaydin bu modulde olup
 * olmadigini belirler; `types: null` (sozluk) o tipteki TUM kayitlar demektir.
 * Etiketler yalnizca audit/denetim metinleri icindir — arayuz kendi i18n
 * sozlugunu kullanir.
 */
export const MODULE_DEFS = {
  'req-user': {
    key: 'req-user',
    entityType: 'requirement',
    types: [REQ_TYPE.USER],
    label: 'Kullanici Gereksinimleri',
  },
  'req-system': {
    key: 'req-system',
    entityType: 'requirement',
    types: [REQ_TYPE.SYSTEM],
    label: 'Sistem Gereksinimleri',
  },
  'req-subsystem': {
    key: 'req-subsystem',
    entityType: 'requirement',
    types: [REQ_TYPE.SOFTWARE, REQ_TYPE.HARDWARE],
    label: 'Alt Sistem Gereksinimleri',
  },
  'test-acceptance': {
    key: 'test-acceptance',
    entityType: 'testcase',
    types: [TEST_TYPE.ACCEPTANCE],
    label: 'Kabul Testleri',
  },
  'test-system': {
    key: 'test-system',
    entityType: 'testcase',
    types: [TEST_TYPE.SYSTEM],
    label: 'Sistem Testleri',
  },
  'test-subsystem': {
    key: 'test-subsystem',
    entityType: 'testcase',
    types: [TEST_TYPE.SUBSYSTEM],
    label: 'Alt Sistem Testleri',
  },
  glossary: { key: 'glossary', entityType: 'glossary', types: null, label: 'Sozluk' },
};

/** Gecerli modul anahtarlari — menu sayfa anahtarlariyla BIREBIR ayni. */
export const MODULE_KEYS = NAV_PAGE_KEYS.filter((key) => MODULE_DEFS[key]);

export const isValidModuleKey = (key) => Object.hasOwn(MODULE_DEFS, key);

export const moduleLabel = (key) => MODULE_DEFS[key]?.label || key;

/**
 * Bir kaydin hangi modulde oldugu.
 * @param {'requirement'|'testcase'|'glossary'} entityType
 * @param {string} [type] gereksinim/test tipi (sozlukte kullanilmaz)
 * @returns {string|null} modul anahtari; modulsuz varliklar icin null
 */
export function moduleKeyOf(entityType, type) {
  if (entityType === 'glossary') return 'glossary';
  if (entityType === 'requirement' || entityType === 'testcase') return componentKeyOf(entityType, type);
  return null;
}

/**
 * Istekten kapsam okur ve dogrular.
 *
 *   { scope: 'project' }                        -> tum proje (modules = null)
 *   { scope: 'module', modules: ['req-system'] } -> tek modul
 *   { modules: [...] }                           -> scope kendiliginden 'module'
 *
 * Modul listesi SIRALI ve TEKILDIR: ayni kapsam her zaman ayni sekilde
 * yazilsin ki iki baseline'in kapsami karsilastirilabilsin.
 *
 * @returns {{scope: string, modules: string[]|null}}
 */
export function normalizeScope(body = {}) {
  const raw = body.modules ?? body.moduleKeys ?? null;
  const wantsModule = body.scope === SCOPE.MODULE || (body.scope == null && Array.isArray(raw) && raw.length > 0);
  if (!wantsModule) {
    if (body.scope != null && body.scope !== SCOPE.PROJECT) throw bad(`Gecersiz kapsam: ${body.scope}`);
    return { scope: SCOPE.PROJECT, modules: null };
  }

  const list = Array.isArray(raw) ? raw.map((m) => String(m).trim()).filter(Boolean) : [];
  if (list.length === 0) throw bad('Modul kapsami icin en az bir modul secilmelidir.');
  for (const key of list) {
    if (!isValidModuleKey(key)) throw bad(`Gecersiz modul: ${key}`);
  }
  const unique = MODULE_KEYS.filter((key) => list.includes(key));
  // Tum moduller secildiyse bu zaten proje kapsamidir; kapsami boylece tek
  // bir bicimde saklariz (iki farkli gosterim ayni seyi anlatmasin).
  if (unique.length === MODULE_KEYS.length) return { scope: SCOPE.PROJECT, modules: null };
  return { scope: SCOPE.MODULE, modules: unique };
}

/**
 * Kapsam testi: `modules` null ise her sey kapsamdadir.
 * @param {string[]|null} modules
 */
export function scopeMatcher(modules) {
  if (!modules || modules.length === 0) return () => true;
  const set = new Set(modules);
  return (entityType, type) => {
    const key = moduleKeyOf(entityType, type);
    return key != null && set.has(key);
  };
}

/** Kapsamin insan tarafindan okunabilir ozeti (audit mesajlari icin). */
export function scopeSummary(scope, modules) {
  if (scope !== SCOPE.MODULE || !modules?.length) return 'tum proje';
  return modules.map(moduleLabel).join(', ');
}
