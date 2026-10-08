// ============================================================================
//  baselines.js — Baseline etiketleme + geri yukleme (restore) + fark (diff).
//  Issue #128. Altyapi #8'de kuruldu (ProjectSnapshot/SnapshotItem); burasi
//  onun uzerine DOORS'taki baseline davranisini ekler.
//
//  UC KAVRAM:
//    snapshot  — belirli bir andaki donmus kopya (her zaman salt okunur).
//    baseline  — "resmi" olarak isaretlenmis snapshot: etiketli (v1.0/SRR/
//                PDR/CDR), gerekceli ve DONDURULMUS (normal yoldan silinemez).
//    safety    — restore ONCESI otomatik alinan kopya: islem geri alinabilsin.
//
//  RESTORE TEK TRANSACTION'DIR. Yarida kalirsa hicbir sey yazilmaz; proje ya
//  tamamen eski haline doner ya da hic dokunulmamis kalir (DO-178C: kismi
//  uygulanmis bir geri donus, izlenemez bir ara duruma yol acardi).
//
//  KILITLI (locked) KAYITLAR: baseline'a donmek, ONAY DURUMUNU DA o andaki
//  haline dondurmek demektir. Bu yuzden canli kayittaki `locked`/
//  `approvalStatus` degerleri restore'u ENGELLEMEZ; snapshot'taki degerlerle
//  DEGISTIRILIR. Aksi halde onaylanmis bir projede baseline'a hic donulemezdi.
//  Bu karar audit mesajina da yazilir.
//
//  KAPSAM (scope): baseline tum projeyi ya da yalnizca secili MODULLERI
//  (sol menu sayfalari; bkz. modules.js) dondurabilir. Modul baseline'inin
//  RESTORE'u yalnizca o modulun kayitlarina dokunur — kapsam disindaki
//  moduller oldugu gibi kalir. Kapsam disina giden baglar geri YUKLENMEZ ama
//  hedefin text_id'si ve o anki SURUMU ile birlikte saklanir ('externalLink'),
//  boylece izlenebilirlik zinciri modul baseline'inda da okunabilir kalir.
// ============================================================================
import { getNavLayout, materializeDefaults } from './nav.js';
import { SCOPE, normalizeScope, scopeMatcher, moduleKeyOf, moduleLabel } from './modules.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Snapshot turleri. */
export const SNAPSHOT_KIND = { MANUAL: 'manual', BASELINE: 'baseline', SAFETY: 'safety' };

/** Fark kayitlarinin durumu. */
export const DIFF_STATUS = { ADDED: 'added', REMOVED: 'removed', CHANGED: 'changed' };

// Canli tabloya GERI YAZILACAK kolonlar. Snapshot verisi `flatten()` ile
// uretildigi icin modular oznitelikler hem `attributes` torbasinda hem de ust
// seviyede duz alan olarak bulunur; buraya YALNIZCA gercek kolonlari yazariz,
// aksi halde Prisma bilinmeyen alan hatasi verirdi.
const REQUIREMENT_COLUMNS = [
  'text_id',
  'title',
  'description',
  'type',
  'field',
  'status',
  'attributes',
  'author',
  'approvalStatus',
  'locked',
  'clearanceLevel',
  'relatedDocuments',
  'sourceStart',
  'sourceEnd',
  'sourceQuote',
  'sourceDocumentName',
  'partNo',
  'partNoBlock',
];

const TESTCASE_COLUMNS = [
  'text_id',
  'title',
  'description',
  'type',
  'field',
  'status',
  'attributes',
  'author',
  'approvalStatus',
  'locked',
];

const GLOSSARY_COLUMNS = ['text_id', 'term', 'definition', 'author'];

const ATTRIBUTE_DEF_COLUMNS = [
  'entityType',
  'key',
  'label',
  'dataType',
  'options',
  'required',
  'defaultValue',
  'order',
  'system',
];

const LINK_COLUMNS = ['fromId', 'toId', 'type', 'isSuspect', 'createdBy'];

// Kapsam DISINA giden baglarda farkin anlamli oldugu alanlar. Hedef kaydin
// o anki SURUMU (`outsideVersion`) de karsilastirilir: bag ayni kalsa bile
// hedef degistiyse baseline sonrasi zincirin kaydigi buradan gorulur.
const EXTERNAL_LINK_FIELDS = [
  'type',
  'isSuspect',
  'fromTextId',
  'toTextId',
  'outsideTextId',
  'outsideVersion',
  'outsideModule',
];

// Fark raporunda KARSILASTIRILAN alanlar. Teknik/otomatik alanlar (updatedAt
// gibi) disarida birakilir: her kaydeditte degistikleri icin farki gurultuye
// bogar, denetim acisindan bir sey anlatmazlar.
const DIFF_FIELDS = {
  requirement: REQUIREMENT_COLUMNS.concat(['parentId', 'assigneeIds']),
  testcase: TESTCASE_COLUMNS.concat(['assigneeIds']),
  glossary: GLOSSARY_COLUMNS,
  link: LINK_COLUMNS,
  externalLink: EXTERNAL_LINK_FIELDS,
  attributeDef: ATTRIBUTE_DEF_COLUMNS,
};

// Kapsam disina giden baglar RESTORE EDILMEZ (hedefleri bu baseline'in
// parcasi degildir) — yalnizca referans olarak saklanir.
const RESTORABLE_TYPES = ['requirement', 'testcase', 'glossary', 'link', 'attributeDef'];

const pick = (source, columns) => {
  const out = {};
  for (const key of columns) {
    if (source[key] !== undefined) out[key] = source[key];
  }
  return out;
};

// ---------------------------------------------------------------------------
//  Snapshot alma (#8'den tasindi; safety kopyasi da ayni yoldan gecer)
// ---------------------------------------------------------------------------

/**
 * Projenin o anki tam kopyasini cikarir (DB'ye yazmadan).
 * attributeDefs (modular oznitelik SEMASI) ve nav duzeni de dahildir: ikisi
 * de zamanla degisir, snapshot'in KENDI basina yorumlanabilir kalmasi icin
 * an be an yakalanir (bkz. #99).
 */
export async function collectProjectState(prisma, projectId) {
  const [requirements, testCases, glossary, links, attributeDefs, navLayout, reqAssignees, tcAssignees, histories] =
    await Promise.all([
      prisma.requirement.findMany({ where: { projectId } }),
      prisma.testCase.findMany({ where: { projectId } }),
      prisma.glossaryTerm.findMany({ where: { projectId } }),
      prisma.traceabilityLink.findMany({ where: { projectId } }),
      prisma.attributeDefinition.findMany({
        where: { projectId },
        orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
      }),
      getNavLayout(prisma, projectId),
      prisma.requirementAssignee.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
      prisma.testCaseAssignee.findMany({ orderBy: [{ order: 'asc' }, { createdAt: 'asc' }] }),
      // Kapsam disina giden baglarin hedefi SURUMUYLE birlikte kaydedilir.
      // RequirementHistory degisiklik ONCESI hali tutar; dolayisiyla canli
      // surum = en buyuk gecmis surum + 1 (bkz. versioning.js).
      prisma.requirementHistory.groupBy({
        by: ['requirementId'],
        where: { projectId },
        _max: { version: true },
      }),
    ]);

  // Coklu atama (#114/#115) snapshot'in bir parcasidir: yalnizca legacy
  // assigneeId saklanirsa restore sonrasi atama listesi kaybolurdu.
  const groupAssignees = (rows, key) => {
    const map = new Map();
    for (const row of rows) {
      if (!map.has(row[key])) map.set(row[key], []);
      map.get(row[key]).push(row.userId);
    }
    return map;
  };
  const reqAssigneeMap = groupAssignees(reqAssignees, 'requirementId');
  const tcAssigneeMap = groupAssignees(tcAssignees, 'testCaseId');

  const versionOf = new Map();
  for (const row of histories) versionOf.set(row.requirementId, (row._max.version || 0) + 1);

  return {
    requirements,
    testCases,
    glossary,
    links,
    attributeDefs,
    navLayout,
    reqAssigneeMap,
    tcAssigneeMap,
    versionOf,
  };
}

/**
 * Proje genelindeki kayitlari id -> kimlik bilgisi olarak indeksler. Kapsam
 * DISINDAKI bag hedefleri bu indeksten cozulur.
 */
function entityIndex(state) {
  const index = new Map();
  for (const r of state.requirements) {
    index.set(r.id, {
      entityType: 'requirement',
      textId: r.text_id,
      type: r.type,
      module: moduleKeyOf('requirement', r.type),
      // Gereksinimde hic degisiklik yoksa gecmis satiri da yoktur: surum 1.
      version: state.versionOf.get(r.id) || 1,
    });
  }
  for (const t of state.testCases) {
    index.set(t.id, {
      entityType: 'testcase',
      textId: t.text_id,
      type: t.type,
      module: moduleKeyOf('testcase', t.type),
      version: null, // testlerin backend'de surum gecmisi yok (#57 yalnizca gereksinim)
    });
  }
  for (const g of state.glossary) {
    index.set(g.id, { entityType: 'glossary', textId: g.text_id, type: null, module: 'glossary', version: null });
  }
  return index;
}

/**
 * Proje durumunu BASELINE KAPSAMINA indirger.
 *
 * Baglar uca gore ayrilir:
 *   - iki ucu da kapsamda  -> `links`         (baseline'in parcasi, restore edilir)
 *   - tek ucu kapsamda     -> `externalLinks` (yalnizca REFERANS olarak saklanir)
 *   - hicbir ucu kapsamda degil -> disarida birakilir
 *
 * @param {object} state collectProjectState ciktisi
 * @param {string[]|null} modules null ise kapsam tum projedir (her sey girer)
 */
export function scopeState(state, modules) {
  const inScope = scopeMatcher(modules);
  const requirements = state.requirements.filter((r) => inScope('requirement', r.type));
  const testCases = state.testCases.filter((t) => inScope('testcase', t.type));
  const glossary = state.glossary.filter(() => inScope('glossary', null));

  const ids = new Set();
  for (const r of requirements) ids.add(r.id);
  for (const t of testCases) ids.add(t.id);
  for (const g of glossary) ids.add(g.id);

  const index = entityIndex(state);
  const links = [];
  const externalLinks = [];
  for (const link of state.links) {
    const fromIn = ids.has(link.fromId);
    const toIn = ids.has(link.toId);
    if (fromIn && toIn) {
      links.push(link);
      continue;
    }
    if (!fromIn && !toIn) continue;
    const insideId = fromIn ? link.fromId : link.toId;
    const outsideId = fromIn ? link.toId : link.fromId;
    const outside = index.get(outsideId);
    externalLinks.push({
      id: link.id,
      fromId: link.fromId,
      toId: link.toId,
      type: link.type,
      isSuspect: link.isSuspect,
      createdAt: link.createdAt,
      createdBy: link.createdBy,
      fromTextId: index.get(link.fromId)?.textId || link.fromId,
      toTextId: index.get(link.toId)?.textId || link.toId,
      // Kapsam disindaki UC: kodu, tipi, modulu ve o anki surumu ile.
      insideId,
      outsideId,
      outsideTextId: outside?.textId || outsideId,
      outsideEntityType: outside?.entityType || null,
      outsideModule: outside?.module || null,
      outsideVersion: outside?.version ?? null,
      // Bag kapsamdaki kayittan mi cikiyor, ona mi geliyor?
      direction: fromIn ? 'outgoing' : 'incoming',
    });
  }

  return { requirements, testCases, glossary, links, externalLinks, ids };
}

/**
 * Ayni kapsam icindeki bir sonraki BASELINE surum numarasi.
 *
 * Sayac `moduleKey` bazlidir: her modulun baseline gecmisi ve surum numarasi
 * BAGIMSIZ ilerler (SRS v1 → v2 iken SDD hala v1 olabilir). Proje geneli ve
 * cok modullu baseline'lar (moduleKey = null) ortak bir proje sayacini
 * kullanir. Siradan snapshot ve guvenlik kopyalari surum ALMAZ — surum
 * "resmi teslim noktasi" kavramina aittir.
 */
async function nextBaselineVersion(tx, projectId, moduleKey) {
  const agg = await tx.projectSnapshot.aggregate({
    where: { projectId, isBaseline: true, moduleKey: moduleKey ?? null },
    _max: { version: true },
  });
  return (agg._max.version || 0) + 1;
}

/**
 * Snapshot + items'i TEK transaction icinde yazar.
 * @param {object} opts { name, label, description, isBaseline, kind, reason,
 *                        restoredFromId, scope, modules, setId }
 */
export async function createSnapshot(prisma, projectId, opts, actor, flatten) {
  const name = String(opts?.name ?? '').trim();
  if (!name) throw bad('Snapshot adi zorunlu.');
  const isBaseline = Boolean(opts?.isBaseline);
  const kind = opts?.kind || (isBaseline ? SNAPSHOT_KIND.BASELINE : SNAPSHOT_KIND.MANUAL);
  const reason = opts?.reason == null ? null : String(opts.reason).trim() || null;
  // Baseline "resmi" bir isarettir: neden donduruldugu yazilmadan alinamaz.
  if (isBaseline && !reason) throw bad('Baseline icin gerekce zorunludur.');

  const { scope, modules } = normalizeScope(opts ?? {});
  // Surum gecmisi TEK modullu kapsamlarda modulun kendisine yazilir.
  const moduleKey = scope === SCOPE.MODULE && modules.length === 1 ? modules[0] : null;

  const state = await collectProjectState(prisma, projectId);
  const { attributeDefs, navLayout } = state;
  const scoped = scopeState(state, modules);
  const { requirements, testCases, glossary, links, externalLinks } = scoped;

  // Link satirlarinda o ANDAKI text_id'ler de saklanir: kayit sonradan
  // silinse bile fark raporu "hangi kod hangi koda bagliydi" diyebilsin.
  const textIdOf = new Map();
  for (const r of state.requirements) textIdOf.set(r.id, r.text_id);
  for (const t of state.testCases) textIdOf.set(t.id, t.text_id);
  for (const g of state.glossary) textIdOf.set(g.id, g.text_id);

  return prisma.$transaction(async (tx) => {
    const snap = await tx.projectSnapshot.create({
      data: {
        projectId,
        name,
        label: opts?.label ? String(opts.label).trim() : null,
        description: String(opts?.description ?? '').trim(),
        isBaseline,
        kind,
        reason,
        restoredFromId: opts?.restoredFromId ?? null,
        scope,
        modules: modules ?? undefined,
        moduleKey,
        version: isBaseline ? await nextBaselineVersion(tx, projectId, moduleKey) : null,
        setId: opts?.setId ?? null,
        createdBy: actor ?? null,
      },
    });

    const items = [];
    const push = (entityType, entityId, data) => items.push({ snapshotId: snap.id, entityType, entityId, data });

    for (const r of requirements) {
      push('requirement', r.id, {
        ...flatten(r),
        assigneeIds: state.reqAssigneeMap.get(r.id) || [],
      });
    }
    for (const t of testCases) {
      push('testcase', t.id, { ...flatten(t), assigneeIds: state.tcAssigneeMap.get(t.id) || [] });
    }
    for (const g of glossary) push('glossary', g.id, g);
    for (const l of links) {
      push('link', l.id, {
        id: l.id,
        projectId: l.projectId,
        fromId: l.fromId,
        toId: l.toId,
        type: l.type,
        // Issue #128: supheli (suspect) durumu farkta gorunmeli.
        isSuspect: l.isSuspect,
        createdAt: l.createdAt,
        createdBy: l.createdBy,
        fromTextId: textIdOf.get(l.fromId) || l.fromId,
        toTextId: textIdOf.get(l.toId) || l.toId,
      });
    }
    // Kapsam disina giden baglar: geri YUKLENMEZ, referans olarak saklanir.
    for (const ext of externalLinks) push('externalLink', ext.id, ext);
    // Oznitelik SEMASI ve menu duzeni kapsamdan BAGIMSIZ olarak saklanir:
    // ikisi de proje geneli olup, donmus kayitlarin tek basina yorumlanmasi
    // icin gereklidir (#99). Modul baseline'i RESTORE edilirken bunlara
    // DOKUNULMAZ — kapsam disi sayilirlar (bkz. restoreSnapshot).
    for (const d of attributeDefs) push('attributeDef', d.id, d);
    // Menu duzeni TEK satirdir (ic ice items[] hiyerarsiyi tasir).
    push('navLayout', projectId, navLayout);

    if (items.length > 0) await tx.snapshotItem.createMany({ data: items });
    return snap;
  });
}

/**
 * BASELINE SET: birden cok MODUL baseline'ini tek bir teslim noktasi altinda
 * toplar ("CDR paketi" = SRS v1.0 + SDD v1.2 + Test Plani v1.0).
 *
 * DOORS davranisi: set bir kopya DEGILDIR — her modul icin AYRI bir baseline
 * alinir ve her biri KENDI surum gecmisinde ilerler; set yalnizca onlari bir
 * arada adlandirir. Bu yuzden setin silinmesi baseline'lari yok etmez.
 *
 * @returns {Promise<{set: object, snapshots: object[]}>}
 */
export async function createBaselineSet(prisma, projectId, opts, actor, flatten) {
  const name = String(opts?.name ?? '').trim();
  if (!name) throw bad('Baseline seti adi zorunlu.');
  const { scope, modules } = normalizeScope(opts ?? {});
  if (scope !== SCOPE.MODULE || modules.length < 2) {
    throw bad('Baseline seti icin en az iki modul secilmelidir.');
  }
  const reason = opts?.reason == null ? null : String(opts.reason).trim() || null;
  if (opts?.isBaseline && !reason) throw bad('Baseline icin gerekce zorunludur.');

  const set = await prisma.baselineSet.create({
    data: {
      projectId,
      name,
      label: opts?.label ? String(opts.label).trim() : null,
      description: String(opts?.description ?? '').trim(),
      reason,
      createdBy: actor ?? null,
    },
  });

  // Her modul AYRI bir snapshot'tir; adlar proje icinde tekil olmak zorunda
  // oldugu icin modul etiketiyle ayrilir.
  const snapshots = [];
  try {
    for (const moduleKey of modules) {
      snapshots.push(
        await createSnapshot(
          prisma,
          projectId,
          {
            name: `${name} · ${moduleLabel(moduleKey)}`,
            label: opts?.label,
            description: opts?.description,
            isBaseline: opts?.isBaseline,
            reason,
            scope: SCOPE.MODULE,
            modules: [moduleKey],
            setId: set.id,
          },
          actor,
          flatten,
        ),
      );
    }
  } catch (e) {
    // Yarim kalmis bir set (bir kismi alinmis moduller) izlenebilirlik
    // acisindan yaniltici olurdu: ya hepsi ya hicbiri.
    await prisma.snapshotItem.deleteMany({ where: { snapshotId: { in: snapshots.map((s) => s.id) } } });
    await prisma.projectSnapshot.deleteMany({ where: { id: { in: snapshots.map((s) => s.id) } } });
    await prisma.baselineSet.delete({ where: { id: set.id } }).catch(() => {});
    throw e;
  }

  return { set, snapshots };
}

/**
 * Kapsam secimine gore dogru yolu secer:
 *   tek modul / tum proje  -> tek snapshot
 *   birden cok modul       -> baseline SET (modul basina bir baseline)
 *
 * @returns {Promise<{set: object|null, snapshots: object[], snapshot: object}>}
 */
export async function createSnapshotForScope(prisma, projectId, body, actor, flatten) {
  const { scope, modules } = normalizeScope(body ?? {});
  if (scope === SCOPE.MODULE && modules.length > 1) {
    const { set, snapshots } = await createBaselineSet(prisma, projectId, { ...body, modules }, actor, flatten);
    return { set, snapshots, snapshot: snapshots[0] };
  }
  const snapshot = await createSnapshot(prisma, projectId, { ...body, scope, modules }, actor, flatten);
  return { set: null, snapshots: [snapshot], snapshot };
}

// ---------------------------------------------------------------------------
//  Restore — onizleme + uygulama
// ---------------------------------------------------------------------------

/** Snapshot satirlarini tipe gore gruplar. */
function groupItems(items) {
  const grouped = {
    requirement: [],
    testcase: [],
    glossary: [],
    link: [],
    externalLink: [],
    attributeDef: [],
    navLayout: null,
  };
  for (const item of items) {
    if (item.entityType === 'navLayout') grouped.navLayout = item.data;
    else if (grouped[item.entityType]) grouped[item.entityType].push(item);
  }
  return grouped;
}

async function loadSnapshot(prisma, projectId, snapshotId) {
  const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: snapshotId }, include: { items: true } });
  if (!snapshot || snapshot.projectId !== projectId) throw bad('Snapshot bulunamadi.', 404);
  return snapshot;
}

/** Snapshot satirinin kapsam listesi (Json alan; eski kayitlarda null). */
const modulesOf = (snapshot) => (Array.isArray(snapshot?.modules) ? snapshot.modules : null);

/** Snapshot ust verisi — API yanitlarinda ortak sekil. */
export function snapshotMeta(snapshot) {
  return {
    id: snapshot.id,
    name: snapshot.name,
    label: snapshot.label,
    isBaseline: snapshot.isBaseline,
    kind: snapshot.kind,
    scope: snapshot.scope,
    modules: modulesOf(snapshot),
    moduleKey: snapshot.moduleKey ?? null,
    version: snapshot.version ?? null,
    setId: snapshot.setId ?? null,
    setName: snapshot.set?.name ?? null,
    createdAt: snapshot.createdAt,
    createdBy: snapshot.createdBy,
  };
}

/** Bir snapshot satirini kisaca tanitan kod/etiket. */
function labelOfItem(entityType, data, entityId) {
  if (entityType === 'link' || entityType === 'externalLink') {
    return `${data.fromTextId || data.fromId} -> ${data.toTextId || data.toId} (${data.type})`;
  }
  if (entityType === 'attributeDef') return data.key || data.label || entityId;
  return data.text_id || data.term || data.title || entityId;
}

/**
 * Secim (kismi restore) listesini normalize eder.
 * @param {string[]|null|undefined} raw geri yuklenecek entityId listesi
 * @returns {Set<string>|null} null = TAM restore
 */
export function normalizeSelection(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) throw bad('Secim listesi dizi olmalidir.');
  const ids = raw.map((id) => String(id).trim()).filter(Boolean);
  if (ids.length === 0) throw bad('Kismi geri yukleme icin en az bir kayit secilmelidir.');
  return new Set(ids);
}

/**
 * Restore ONIZLEMESI: kac kayit eklenecek / guncellenecek / silinecek.
 * Hicbir sey YAZMAZ — kullanici onaylamadan uygulama yapilmaz.
 *
 * KAPSAM: yalnizca baseline'in kapsamindaki (modul) kayitlar sayilir; kapsam
 * disindaki canli kayitlar "silinecek" listesine GIRMEZ.
 *
 * KISMI RESTORE (`selection`): yalnizca secili kayitlar geri yuklenir ve
 * HICBIR SEY SILINMEZ. Silme, "baseline'daki durumu birebir kur" anlamina
 * gelir; secili birkaç kayit geri alinirken gerisini silmek kullanicinin
 * bekledigi sey olmazdi.
 *
 * @param {object} [opts] { selection: string[] }
 * @returns {Promise<{snapshot, summary, totals, entries, partial, scope, modules}>}
 */
export async function buildRestorePlan(prisma, projectId, snapshotId, opts = {}) {
  const snapshot = await loadSnapshot(prisma, projectId, snapshotId);
  const grouped = groupItems(snapshot.items);
  const modules = modulesOf(snapshot);
  const selection = normalizeSelection(opts.selection);
  const partial = selection != null;

  const liveState = await collectProjectState(prisma, projectId);
  const liveScoped = scopeState(liveState, modules);

  // Proje geneli varliklar (oznitelik semasi, menu duzeni) yalnizca PROJE
  // kapsamli baseline'larda geri yuklenir — modul baseline'i kapsam disina
  // dokunmaz.
  const projectWide = snapshot.scope !== SCOPE.MODULE;
  const liveSets = {
    requirement: new Map(liveScoped.requirements.map((r) => [r.id, r])),
    testcase: new Map(liveScoped.testCases.map((t) => [t.id, t])),
    glossary: new Map(liveScoped.glossary.map((g) => [g.id, g])),
    link: new Map(liveScoped.links.map((l) => [l.id, l])),
    attributeDef: projectWide ? new Map(liveState.attributeDefs.map((d) => [d.id, d])) : new Map(),
  };

  const summary = {};
  const entries = [];
  let totals = { added: 0, updated: 0, deleted: 0 };

  for (const entityType of RESTORABLE_TYPES) {
    const items = entityType === 'attributeDef' && !projectWide ? [] : grouped[entityType];
    const picked = selection ? items.filter((i) => selection.has(i.entityId)) : items;
    const counts = { added: 0, updated: 0, deleted: 0 };

    for (const item of picked) {
      const exists = liveSets[entityType].has(item.entityId);
      counts[exists ? 'updated' : 'added'] += 1;
      entries.push({
        entityType,
        entityId: item.entityId,
        label: labelOfItem(entityType, item.data, item.entityId),
        action: exists ? 'update' : 'add',
      });
    }

    // Kismi restore hicbir sey SILMEZ (bkz. yukaridaki not).
    if (!partial) {
      const snapIds = new Set(items.map((i) => i.entityId));
      for (const [id, row] of liveSets[entityType]) {
        if (snapIds.has(id)) continue;
        counts.deleted += 1;
        entries.push({
          entityType,
          entityId: id,
          label: labelOfItem(entityType, row, id),
          action: 'delete',
        });
      }
    }

    summary[entityType] = counts;
    totals = {
      added: totals.added + counts.added,
      updated: totals.updated + counts.updated,
      deleted: totals.deleted + counts.deleted,
    };
  }

  return {
    snapshot: snapshotMeta(snapshot),
    scope: snapshot.scope,
    modules,
    partial,
    summary,
    totals,
    entries,
    // Kapsam disina giden baglar geri yuklenmez; kullanici kac tanesinin
    // referans olarak durdugunu gormeli.
    externalLinks: grouped.externalLink.length,
    navLayoutRestored: projectWide && !partial && Boolean(grouped.navLayout),
  };
}

/**
 * Snapshot'i canli duruma geri yukler.
 *
 * SIRA ONEMLI:
 *   1) Fazla kayitlar silinir (once baglar, sonra varliklar — bag bir
 *      gereksinime FK ile bagli DEGIL ama mantiksal olarak once temizlenir).
 *   2) Varliklar upsert edilir; gereksinimler ONCE parentId'siz yazilir,
 *      sonra parentId ayrica islenir — kendine referansli FK'de sira
 *      bagimliligini tamamen ortadan kaldirir.
 *   3) Atama (assignee) join tablolari senkronlanir.
 *   4) Nav duzeni yeniden kurulur.
 *
 * FK GUVENLIGI: `sourceDocumentId` / `assigneeId` gibi DIS kaynaklara isaret
 * eden alanlar, hedef kayit bu arada silinmisse NULL'a dusurulur — restore
 * tumden basarisiz olmaktansa bag bosa duser (schema'daki SetNull ile ayni
 * davranis).
 *
 * @returns {Promise<{plan, safetySnapshotId}>}
 */
export async function restoreSnapshot(prisma, projectId, snapshotId, { reason, actor, flatten, selection }) {
  const clean = String(reason ?? '').trim();
  if (clean.length < 3) throw bad('Geri yukleme gerekcesi zorunludur (en az 3 karakter).');

  const snapshot = await loadSnapshot(prisma, projectId, snapshotId);
  const picked = normalizeSelection(selection);
  const plan = await buildRestorePlan(prisma, projectId, snapshotId, { selection });
  const grouped = groupItems(snapshot.items);
  const modules = modulesOf(snapshot);
  const projectWide = snapshot.scope !== SCOPE.MODULE;
  // Kismi restore: yalnizca secili kayitlar yazilir, hicbir sey silinmez.
  const selected = (items) => (picked ? items.filter((i) => picked.has(i.entityId)) : items);

  // 1) GUVENLIK KOPYASI: islem geri alinabilir olsun. Restore'dan ONCE ve
  //    AYRI bir transaction'da alinir — restore transaction'i geri sarilsa
  //    bile guvenlik kopyasi elde kalmalidir.
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safety = await createSnapshot(
    prisma,
    projectId,
    {
      name: `[otomatik] Geri yukleme oncesi ${stamp}`,
      description: `"${snapshot.name}" anina donulmeden once otomatik alindi.`,
      kind: SNAPSHOT_KIND.SAFETY,
      reason: clean,
      restoredFromId: snapshot.id,
      // Guvenlik kopyasi, geri yuklenecek olanla AYNI kapsami alir: islemi
      // geri almak, dokunulan kayitlarin tamamini eski haline getirmelidir —
      // ne eksik (geri alinamayan kayit) ne fazla (kapsam disina tasma).
      scope: snapshot.scope,
      modules,
    },
    actor,
    flatten,
  );

  // Dis kaynaklara isaret eden alanlarin hala gecerli olup olmadigi.
  const [documents, members] = await Promise.all([
    prisma.projectDocument.findMany({ where: { projectId }, select: { id: true } }),
    prisma.projectMember.findMany({ where: { projectId }, select: { userId: true } }),
  ]);
  const documentIds = new Set(documents.map((d) => d.id));
  const memberIds = new Set(members.map((m) => m.userId));
  const validUser = (id) => (id && memberIds.has(id) ? id : null);

  // Silinecek kayitlar KAPSAM icinden hesaplanir (JS tarafinda): modul
  // baseline'i, kapsam disindaki hicbir kaydi silmemelidir. Baglarda kapsam
  // "iki ucu da kapsamda olan bag" demektir — plan da ayni kurali kullanir.
  const liveState = await collectProjectState(prisma, projectId);
  const liveScoped = scopeState(liveState, modules);
  const deletionIds = (type, liveRows) => {
    if (picked) return []; // kismi restore SILMEZ
    const keep = new Set(grouped[type].map((i) => i.entityId));
    return liveRows.filter((row) => !keep.has(row.id)).map((row) => row.id);
  };
  const removals = {
    link: deletionIds('link', liveScoped.links),
    requirement: deletionIds('requirement', liveScoped.requirements),
    testcase: deletionIds('testcase', liveScoped.testCases),
    glossary: deletionIds('glossary', liveScoped.glossary),
    // Oznitelik semasi proje genelidir: yalnizca proje kapsamli restore'da.
    attributeDef: projectWide ? deletionIds('attributeDef', liveState.attributeDefs) : [],
  };

  await prisma.$transaction(async (tx) => {
    const dropMany = async (model, ids) => {
      if (ids.length > 0) await tx[model].deleteMany({ where: { id: { in: ids } } });
    };

    // 1) Kapsam icinde olup snapshot'ta OLMAYAN canli kayitlari sil.
    //    Once baglar: bir gereksinime FK ile bagli degiller ama mantiksal
    //    olarak once temizlenmeleri gerekir.
    await dropMany('traceabilityLink', removals.link);
    await dropMany('requirement', removals.requirement);
    await dropMany('testCase', removals.testcase);
    await dropMany('glossaryTerm', removals.glossary);
    await dropMany('attributeDefinition', removals.attributeDef);

    // 2a) Gereksinimler — parentId HARIC yazilir (kendine referansli FK).
    for (const item of selected(grouped.requirement)) {
      const data = pick(item.data, REQUIREMENT_COLUMNS);
      data.sourceDocumentId = documentIds.has(item.data.sourceDocumentId) ? item.data.sourceDocumentId : null;
      data.assigneeId = validUser(item.data.assigneeId);
      await tx.requirement.upsert({
        where: { id: item.entityId },
        update: { ...data, parentId: null },
        create: { id: item.entityId, projectId, ...data, parentId: null },
      });
    }
    // 2b) parentId'ler — tum satirlar artik mevcut oldugu icin guvenli.
    //     MODUL baseline'inda ust dugum KAPSAM DISINDA olabilir (orn. bir
    //     Sistem Gereksiniminin ustu bir Kullanici Gereksinimidir). O kayit
    //     bu arada silinmisse bag bosa duser: restore tumden basarisiz
    //     olmaktansa parentId NULL kalir (schema'daki SetNull ile ayni karar).
    const parentIds = selected(grouped.requirement)
      .map((i) => i.data.parentId)
      .filter(Boolean);
    const existingParents = new Set(
      parentIds.length === 0
        ? []
        : (await tx.requirement.findMany({ where: { projectId, id: { in: parentIds } }, select: { id: true } })).map(
            (r) => r.id,
          ),
    );
    for (const item of selected(grouped.requirement)) {
      if (item.data.parentId && existingParents.has(item.data.parentId)) {
        await tx.requirement.update({ where: { id: item.entityId }, data: { parentId: item.data.parentId } });
      }
    }

    for (const item of selected(grouped.testcase)) {
      const data = pick(item.data, TESTCASE_COLUMNS);
      data.assigneeId = validUser(item.data.assigneeId);
      await tx.testCase.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    for (const item of selected(grouped.glossary)) {
      const data = pick(item.data, GLOSSARY_COLUMNS);
      await tx.glossaryTerm.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    // Oznitelik SEMASI proje genelidir: modul baseline'i onu geri yuklemez
    // (kapsam disina dokunmak olurdu) — yalnizca yorumlanabilsin diye saklar.
    for (const item of projectWide ? selected(grouped.attributeDef) : []) {
      const data = pick(item.data, ATTRIBUTE_DEF_COLUMNS);
      await tx.attributeDefinition.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    for (const item of selected(grouped.link)) {
      const data = pick(item.data, LINK_COLUMNS);
      await tx.traceabilityLink.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    // 3) Coklu atama join tablolari: snapshot'taki listeye esitlenir.
    //    Projede artik uye olmayan kullanicilar atlanir (FK + is kurali).
    const syncAssignees = async (items, model, fkField) => {
      for (const item of items) {
        const wanted = (item.data.assigneeIds || []).filter((id) => memberIds.has(id));
        await tx[model].deleteMany({ where: { [fkField]: item.entityId } });
        if (wanted.length > 0) {
          await tx[model].createMany({
            data: wanted.map((userId, order) => ({ [fkField]: item.entityId, userId, order })),
          });
        }
      }
    };
    await syncAssignees(selected(grouped.requirement), 'requirementAssignee', 'requirementId');
    await syncAssignees(selected(grouped.testcase), 'testCaseAssignee', 'testCaseId');

    // 4) Menu duzeni: snapshot'taki gruplar/sayfalar yeniden kurulur.
    //    Menu de proje genelidir; modul baseline'i ve kismi restore ona
    //    DOKUNMAZ.
    if (projectWide && !picked && grouped.navLayout) {
      await tx.navItem.deleteMany({ where: { projectId } });
      await tx.navGroup.deleteMany({ where: { projectId } });
      for (const [gi, group] of (grouped.navLayout.groups || []).entries()) {
        const created = await tx.navGroup.create({
          data: { projectId, name: group.name, order: group.order ?? gi },
        });
        for (const [ii, navItem] of (group.items || []).entries()) {
          await tx.navItem.create({
            data: {
              projectId,
              groupId: created.id,
              pageKey: navItem.pageKey,
              label: navItem.label ?? null,
              fieldFilter: navItem.fieldFilter ?? null,
              typeFilter: navItem.typeFilter ?? null,
              order: navItem.order ?? ii,
            },
          });
        }
      }
      for (const [ii, navItem] of (grouped.navLayout.ungrouped || []).entries()) {
        await tx.navItem.create({
          data: {
            projectId,
            groupId: null,
            pageKey: navItem.pageKey,
            label: navItem.label ?? null,
            fieldFilter: navItem.fieldFilter ?? null,
            typeFilter: navItem.typeFilter ?? null,
            order: navItem.order ?? ii,
          },
        });
      }
      // Snapshot menuyu hic materialize etmemis olabilir; bos kalmasin.
      const count = await tx.navItem.count({ where: { projectId } });
      if (count === 0) await materializeDefaults(tx, projectId);
    }
  });

  return {
    plan,
    safetySnapshotId: safety.id,
    safetySnapshotName: safety.name,
    scope: snapshot.scope,
    modules,
    partial: Boolean(picked),
  };
}

// ---------------------------------------------------------------------------
//  Diff — iki baseline ya da baseline <-> canli
// ---------------------------------------------------------------------------

/** Canli durumu gosteren ozel referans. */
const LIVE_REF = 'live';

/**
 * Bir tarafin YALNIZCA ust verisi. Karsilastirma kapsami (hangi moduller)
 * satirlar yuklenmeden ONCE bilinmelidir: canli taraf, kapsam disina giden
 * baglari ancak kapsami bilerek cikarabilir.
 */
async function metaOf(prisma, projectId, ref) {
  if (ref === LIVE_REF) {
    return { id: LIVE_REF, name: 'Canli durum', isLive: true, scope: SCOPE.PROJECT, modules: null };
  }
  const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: ref }, include: { set: true } });
  if (!snapshot || snapshot.projectId !== projectId) throw bad('Snapshot bulunamadi.', 404);
  return { ...snapshotMeta(snapshot), isLive: false };
}

/**
 * Karsilastirma icin bir tarafi ortak sekle getirir.
 *
 * `modules` KARSILASTIRMA KAPSAMIDIR (null = tum proje): bir modul baseline'i
 * canli durumla karsilastirildiginda, canli taraf da AYNI module indirgenir.
 * Aksi halde kapsam disindaki her kayit "eklenmis" gorunur ve rapor
 * anlamsizlasirdi.
 */
async function sideOf(prisma, projectId, ref, flatten, modules) {
  if (ref === LIVE_REF) {
    const live = await collectProjectState(prisma, projectId);
    const scoped = scopeState(live, modules);
    const textIdOf = new Map();
    for (const r of live.requirements) textIdOf.set(r.id, r.text_id);
    for (const t of live.testCases) textIdOf.set(t.id, t.text_id);
    for (const g of live.glossary) textIdOf.set(g.id, g.text_id);
    const rows = {
      requirement: scoped.requirements.map((r) => ({
        ...flatten(r),
        assigneeIds: live.reqAssigneeMap.get(r.id) || [],
      })),
      testcase: scoped.testCases.map((t) => ({ ...flatten(t), assigneeIds: live.tcAssigneeMap.get(t.id) || [] })),
      glossary: scoped.glossary,
      link: scoped.links.map((l) => ({
        ...l,
        fromTextId: textIdOf.get(l.fromId) || l.fromId,
        toTextId: textIdOf.get(l.toId) || l.toId,
      })),
      externalLink: scoped.externalLinks,
      attributeDef: live.attributeDefs,
    };
    return {
      meta: { id: 'live', name: 'Canli durum', isLive: true, scope: SCOPE.PROJECT, modules: null },
      rows,
    };
  }

  const snapshot = await loadSnapshot(prisma, projectId, ref);
  const grouped = groupItems(snapshot.items);
  const rowsOf = (type) => grouped[type].map((i) => ({ id: i.entityId, ...i.data }));
  const rows = {
    requirement: rowsOf('requirement'),
    testcase: rowsOf('testcase'),
    glossary: rowsOf('glossary'),
    link: rowsOf('link'),
    externalLink: rowsOf('externalLink'),
    attributeDef: rowsOf('attributeDef'),
  };
  // Snapshot kendi kapsamiyla donmustur; ORTAK kapsam daha darsa (orn. proje
  // snapshot'i bir modul baseline'iyla karsilastiriliyorsa) burada indirgenir.
  return applyScope({ meta: { ...snapshotMeta(snapshot), isLive: false }, rows }, modules);
}

/**
 * Iki tarafin ORTAK karsilastirma kapsami.
 *
 * Bir taraf modul kapsamliysa fark yalnizca o modul(ler) uzerinden okunur:
 * "SRS v1.0 <-> canli" sorusunun cevabi SRS'tir, projenin tamami degil. Iki
 * taraf da modul kapsamliysa kapsamlarin BIRLESIMI alinir — birinde olup
 * otekinde olmayan bir modul, "eklenmis/silinmis" olarak gorunmelidir.
 */
function diffScope(fromMeta, toMeta) {
  const a = Array.isArray(fromMeta.modules) ? fromMeta.modules : null;
  const b = Array.isArray(toMeta.modules) ? toMeta.modules : null;
  if (!a && !b) return null;
  if (!a) return b;
  if (!b) return a;
  const union = new Set([...a, ...b]);
  return [...union];
}

/** Bir tarafin satirlarini verilen kapsama indirger. */
function applyScope(side, modules) {
  if (!modules) return side;
  const inScope = scopeMatcher(modules);
  const keep = (entityType) => (row) => inScope(entityType, row.type);
  const rows = {
    ...side.rows,
    requirement: side.rows.requirement.filter(keep('requirement')),
    testcase: side.rows.testcase.filter(keep('testcase')),
    glossary: side.rows.glossary.filter(() => inScope('glossary', null)),
  };
  // Bag ancak IKI UCU da kapsamda kalirsa "kapsam ici" sayilir; tek ucu
  // kalanlar kapsam disi bag olarak okunur.
  const ids = new Set([
    ...rows.requirement.map((r) => r.id),
    ...rows.testcase.map((t) => t.id),
    ...rows.glossary.map((g) => g.id),
  ]);
  rows.link = side.rows.link.filter((l) => ids.has(l.fromId) && ids.has(l.toId));
  rows.externalLink = (side.rows.externalLink || []).filter((l) => ids.has(l.insideId));
  return { ...side, rows };
}

/** Iki degerin denk olup olmadigi (tarih/dizi/nesne farkliliklarina dayanikli). */
function sameValue(a, b) {
  if (a === b) return true;
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  if (a instanceof Date || b instanceof Date) return new Date(a).getTime() === new Date(b).getTime();
  if (typeof a === 'object' || typeof b === 'object') return JSON.stringify(a) === JSON.stringify(b);
  return String(a) === String(b);
}

/** Fark satirinda kaydi tanitan kod/etiket. */
function labelOfRow(entityType, row) {
  if (!row) return null;
  if (entityType === 'link' || entityType === 'externalLink') {
    return `${row.fromTextId || row.fromId} -> ${row.toTextId || row.toId} (${row.type})`;
  }
  if (entityType === 'attributeDef') return row.key || row.label || row.id;
  return row.text_id || row.term || row.title || row.id;
}

/**
 * Iki taraf arasindaki farki cikarir.
 * @param {string} fromRef snapshot id ya da 'live'
 * @param {string} toRef   snapshot id ya da 'live'
 */
export async function diffSnapshots(prisma, projectId, fromRef, toRef, flatten) {
  if (fromRef === toRef) throw bad('Karsilastirma icin iki FARKLI taraf secilmelidir.');
  // Kapsam ancak iki tarafin ust verisi okunduktan SONRA bilinir; satirlar
  // dogrudan o kapsamla yuklenir (canli taraf, kapsam disi baglari ancak
  // kapsami bilerek cikarabilir).
  const [fromMeta, toMeta] = await Promise.all([metaOf(prisma, projectId, fromRef), metaOf(prisma, projectId, toRef)]);
  const scope = diffScope(fromMeta, toMeta);
  const [from, to] = await Promise.all([
    sideOf(prisma, projectId, fromRef, flatten, scope),
    sideOf(prisma, projectId, toRef, flatten, scope),
  ]);

  const entries = [];
  const summary = {};
  let totals = { added: 0, removed: 0, changed: 0, unchanged: 0 };

  for (const entityType of Object.keys(DIFF_FIELDS)) {
    const fromMap = new Map((from.rows[entityType] || []).map((r) => [r.id, r]));
    const toMap = new Map((to.rows[entityType] || []).map((r) => [r.id, r]));
    const counts = { added: 0, removed: 0, changed: 0, unchanged: 0 };

    for (const [id, toRow] of toMap) {
      const fromRow = fromMap.get(id);
      if (!fromRow) {
        counts.added += 1;
        entries.push({
          entityType,
          entityId: id,
          label: labelOfRow(entityType, toRow),
          status: DIFF_STATUS.ADDED,
          fields: [],
        });
        continue;
      }
      const fields = [];
      for (const field of DIFF_FIELDS[entityType]) {
        if (!sameValue(fromRow[field], toRow[field])) {
          fields.push({ field, from: fromRow[field] ?? null, to: toRow[field] ?? null });
        }
      }
      if (fields.length > 0) {
        counts.changed += 1;
        entries.push({
          entityType,
          entityId: id,
          label: labelOfRow(entityType, toRow),
          status: DIFF_STATUS.CHANGED,
          fields,
        });
      } else {
        counts.unchanged += 1;
      }
    }
    for (const [id, fromRow] of fromMap) {
      if (toMap.has(id)) continue;
      counts.removed += 1;
      entries.push({
        entityType,
        entityId: id,
        label: labelOfRow(entityType, fromRow),
        status: DIFF_STATUS.REMOVED,
        fields: [],
      });
    }

    summary[entityType] = counts;
    totals = {
      added: totals.added + counts.added,
      removed: totals.removed + counts.removed,
      changed: totals.changed + counts.changed,
      unchanged: totals.unchanged + counts.unchanged,
    };
  }

  // Denetim raporunda okunabilir bir sira: tipe, sonra duruma, sonra koda.
  const order = { requirement: 0, testcase: 1, link: 2, externalLink: 3, glossary: 4, attributeDef: 5 };
  entries.sort(
    (a, b) =>
      (order[a.entityType] ?? 9) - (order[b.entityType] ?? 9) ||
      String(a.status).localeCompare(String(b.status)) ||
      String(a.label).localeCompare(String(b.label), 'tr'),
  );

  return {
    from: from.meta,
    to: to.meta,
    scope: scope ? SCOPE.MODULE : SCOPE.PROJECT,
    modules: scope,
    summary,
    totals,
    entries,
  };
}

// ---------------------------------------------------------------------------
//  Baseline dondurma kurallari
// ---------------------------------------------------------------------------

/**
 * Baseline DONDURULMUSTUR: normal yoldan silinemez. Yalnizca acikca `force`
 * isaretiyle (ozel izin) ve gerekceyle silinebilir — bu da audit'e yazilir.
 * @throws {Error} 409 baseline ve force verilmemisse
 */
export function assertDeletable(snapshot, { force = false } = {}) {
  if (snapshot.isBaseline && !force) {
    throw bad(`"${snapshot.name}" bir BASELINE'dir ve dondurulmustur; silmek icin ozel izin (force) gerekir.`, 409);
  }
}

/**
 * Baseline alanlari (etiket/aciklama/isaret) guncellenir.
 * Bir kayit baseline olarak isaretlendikten sonra ICERIGI (items) asla
 * degismez — yalnizca ust veri duzenlenebilir; baseline'i KALDIRMAK ise
 * "resmi" isaretin geri alinmasidir ve gerekce ister.
 */
export function validateBaselineUpdate(snapshot, body) {
  const data = {};
  if (body?.label !== undefined) data.label = body.label ? String(body.label).trim() : null;
  if (body?.description !== undefined) data.description = String(body.description ?? '').trim();
  if (body?.name !== undefined) {
    const name = String(body.name).trim();
    if (!name) throw bad('Snapshot adi bos olamaz.');
    data.name = name;
  }
  if (body?.isBaseline !== undefined) {
    const next = Boolean(body.isBaseline);
    const reason = String(body?.reason ?? '').trim();
    if (next && !reason && !snapshot.reason) throw bad('Baseline icin gerekce zorunludur.');
    if (!next && snapshot.isBaseline && !reason) {
      throw bad('Baseline isaretini kaldirmak icin gerekce zorunludur.');
    }
    data.isBaseline = next;
    data.kind = next ? SNAPSHOT_KIND.BASELINE : SNAPSHOT_KIND.MANUAL;
    if (reason) data.reason = reason;
  } else if (body?.reason !== undefined) {
    data.reason = String(body.reason ?? '').trim() || null;
  }
  if (Object.keys(data).length === 0) throw bad('Guncellenecek alan yok.');
  return data;
}

// ---------------------------------------------------------------------------
//  Kayit uzerinde baseline gorunurlugu (Issue #128, madde 5)
//
//  Buradaki soru "bu kayda baseline atalim mi" DEGILDIR — baseline bir kayit
//  kumesini (modulu) bir butun olarak dondurur. Soru sudur: BU KAYIT hangi
//  modul baseline'larinin icinde kaldi? Cevap SnapshotItem'dan okunur; kayda
//  ayrica bir sey yazmaya gerek yoktur.
// ---------------------------------------------------------------------------

const RECORD_ENTITY_TYPES = ['requirement', 'testcase', 'glossary'];

function assertRecordEntityType(entityType) {
  if (!RECORD_ENTITY_TYPES.includes(entityType)) throw bad(`Gecersiz kayit tipi: ${entityType}`, 400);
}

/**
 * Bir kaydin icinde yer aldigi snapshot/baseline'lari dondurur (yeniden
 * eskiye). Kayit hicbirinde yoksa liste BOS doner — cagiran taraf bunu
 * "henuz hicbir surume girmemis yeni kayit" olarak gosterir.
 *
 * @param {'requirement'|'testcase'|'glossary'} entityType
 * @returns {Promise<{entityType, entityId, baselines: object[], total: number}>}
 */
export async function listRecordBaselines(prisma, projectId, entityType, entityId) {
  assertRecordEntityType(entityType);
  const items = await prisma.snapshotItem.findMany({
    where: { entityType, entityId, snapshot: { projectId } },
    select: { snapshotId: true },
  });
  if (items.length === 0) return { entityType, entityId, baselines: [], total: 0 };

  const snapshots = await prisma.projectSnapshot.findMany({
    where: { id: { in: items.map((i) => i.snapshotId) } },
    include: { set: true },
    // Resmi baseline'lar once: kullanicinin aradigi "hangi surumde teslim
    // edildi" sorusunun cevabi onlardir, ara kayitlar degil.
    orderBy: [{ isBaseline: 'desc' }, { createdAt: 'desc' }],
  });
  return {
    entityType,
    entityId,
    baselines: snapshots.map(snapshotMeta),
    total: snapshots.length,
  };
}

/**
 * Kaydin SECILEN baseline'daki hali + canli haliyle ALAN BAZINDA farki
 * ("v1.0'dan bu yana ne degisti").
 *
 * Kayit canlida silinmisse `live` null doner ve tum alanlar "silinmis" farki
 * olarak okunur — baseline'daki hal yine de salt okunur gosterilebilir.
 */
export async function recordBaselineDetail(prisma, projectId, entityType, entityId, snapshotId, flatten) {
  assertRecordEntityType(entityType);
  const snapshot = await prisma.projectSnapshot.findUnique({ where: { id: snapshotId }, include: { set: true } });
  if (!snapshot || snapshot.projectId !== projectId) throw bad('Snapshot bulunamadi.', 404);

  const item = await prisma.snapshotItem.findFirst({ where: { snapshotId, entityType, entityId } });
  if (!item) throw bad('Kayit bu baseline icinde yer almiyor.', 404);

  const model = { requirement: 'requirement', testcase: 'testCase', glossary: 'glossaryTerm' }[entityType];
  const liveRow = await prisma[model].findUnique({ where: { id: entityId } });
  const live =
    liveRow && liveRow.projectId === projectId
      ? entityType === 'glossary'
        ? liveRow
        : { ...flatten(liveRow), assigneeIds: await assigneeIdsOf(prisma, entityType, entityId) }
      : null;

  const fields = [];
  for (const field of DIFF_FIELDS[entityType]) {
    const before = item.data[field] ?? null;
    const after = live ? (live[field] ?? null) : null;
    if (!sameValue(before, after)) fields.push({ field, from: before, to: after });
  }

  return {
    snapshot: snapshotMeta(snapshot),
    entityType,
    entityId,
    // Baseline'daki hal: salt okunur gosterilir.
    data: item.data,
    live,
    liveDeleted: live == null,
    fields,
    changed: fields.length > 0,
  };
}

/** Coklu atama listesi (fark raporunda alan olarak karsilastirilir). */
async function assigneeIdsOf(prisma, entityType, entityId) {
  if (entityType === 'requirement') {
    const rows = await prisma.requirementAssignee.findMany({
      where: { requirementId: entityId },
      orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
    });
    return rows.map((r) => r.userId);
  }
  const rows = await prisma.testCaseAssignee.findMany({
    where: { testCaseId: entityId },
    orderBy: [{ order: 'asc' }, { createdAt: 'asc' }],
  });
  return rows.map((r) => r.userId);
}

/**
 * Baseline setleri: her set, icerdigi modul baseline'lariyla birlikte doner.
 */
export async function listBaselineSets(prisma, projectId) {
  const sets = await prisma.baselineSet.findMany({
    where: { projectId },
    orderBy: { createdAt: 'desc' },
    include: { snapshots: { orderBy: { createdAt: 'asc' } } },
  });
  return sets.map((set) => ({
    id: set.id,
    name: set.name,
    label: set.label,
    description: set.description,
    reason: set.reason,
    createdBy: set.createdBy,
    createdAt: set.createdAt,
    snapshots: set.snapshots.map(snapshotMeta),
  }));
}
