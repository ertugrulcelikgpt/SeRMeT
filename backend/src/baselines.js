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
// ============================================================================
import { getNavLayout, materializeDefaults } from './nav.js';

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

// Fark raporunda KARSILASTIRILAN alanlar. Teknik/otomatik alanlar (updatedAt
// gibi) disarida birakilir: her kaydeditte degistikleri icin farki gurultuye
// bogar, denetim acisindan bir sey anlatmazlar.
const DIFF_FIELDS = {
  requirement: REQUIREMENT_COLUMNS.concat(['parentId', 'assigneeIds']),
  testcase: TESTCASE_COLUMNS.concat(['assigneeIds']),
  glossary: GLOSSARY_COLUMNS,
  link: LINK_COLUMNS,
  attributeDef: ATTRIBUTE_DEF_COLUMNS,
};

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
  const [requirements, testCases, glossary, links, attributeDefs, navLayout, reqAssignees, tcAssignees] =
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

  return { requirements, testCases, glossary, links, attributeDefs, navLayout, reqAssigneeMap, tcAssigneeMap };
}

/**
 * Snapshot + items'i TEK transaction icinde yazar.
 * @param {object} opts { name, label, description, isBaseline, kind, reason, restoredFromId }
 */
export async function createSnapshot(prisma, projectId, opts, actor, flatten) {
  const name = String(opts?.name ?? '').trim();
  if (!name) throw bad('Snapshot adi zorunlu.');
  const isBaseline = Boolean(opts?.isBaseline);
  const kind = opts?.kind || (isBaseline ? SNAPSHOT_KIND.BASELINE : SNAPSHOT_KIND.MANUAL);
  const reason = opts?.reason == null ? null : String(opts.reason).trim() || null;
  // Baseline "resmi" bir isarettir: neden donduruldugu yazilmadan alinamaz.
  if (isBaseline && !reason) throw bad('Baseline icin gerekce zorunludur.');

  const state = await collectProjectState(prisma, projectId);
  const { requirements, testCases, glossary, links, attributeDefs, navLayout } = state;

  // Link satirlarinda o ANDAKI text_id'ler de saklanir: kayit sonradan
  // silinse bile fark raporu "hangi kod hangi koda bagliydi" diyebilsin.
  const textIdOf = new Map();
  for (const r of requirements) textIdOf.set(r.id, r.text_id);
  for (const t of testCases) textIdOf.set(t.id, t.text_id);
  for (const g of glossary) textIdOf.set(g.id, g.text_id);

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
    for (const d of attributeDefs) push('attributeDef', d.id, d);
    // Menu duzeni TEK satirdir (ic ice items[] hiyerarsiyi tasir).
    push('navLayout', projectId, navLayout);

    if (items.length > 0) await tx.snapshotItem.createMany({ data: items });
    return snap;
  });
}

// ---------------------------------------------------------------------------
//  Restore — onizleme + uygulama
// ---------------------------------------------------------------------------

/** Snapshot satirlarini tipe gore gruplar. */
function groupItems(items) {
  const grouped = { requirement: [], testcase: [], glossary: [], link: [], attributeDef: [], navLayout: null };
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

/**
 * Restore ONIZLEMESI: kac kayit eklenecek / guncellenecek / silinecek.
 * Hicbir sey YAZMAZ — kullanici onaylamadan uygulama yapilmaz.
 * @returns {Promise<{snapshot, summary, totals}>}
 */
export async function buildRestorePlan(prisma, projectId, snapshotId) {
  const snapshot = await loadSnapshot(prisma, projectId, snapshotId);
  const grouped = groupItems(snapshot.items);
  const live = await collectProjectState(prisma, projectId);

  const liveSets = {
    requirement: new Map(live.requirements.map((r) => [r.id, r])),
    testcase: new Map(live.testCases.map((t) => [t.id, t])),
    glossary: new Map(live.glossary.map((g) => [g.id, g])),
    link: new Map(live.links.map((l) => [l.id, l])),
    attributeDef: new Map(live.attributeDefs.map((d) => [d.id, d])),
  };

  const summary = {};
  let totals = { added: 0, updated: 0, deleted: 0 };
  for (const entityType of Object.keys(liveSets)) {
    const snapIds = new Set(grouped[entityType].map((i) => i.entityId));
    const added = grouped[entityType].filter((i) => !liveSets[entityType].has(i.entityId)).length;
    const updated = grouped[entityType].length - added;
    const deleted = [...liveSets[entityType].keys()].filter((id) => !snapIds.has(id)).length;
    summary[entityType] = { added, updated, deleted };
    totals = { added: totals.added + added, updated: totals.updated + updated, deleted: totals.deleted + deleted };
  }

  return {
    snapshot: {
      id: snapshot.id,
      name: snapshot.name,
      label: snapshot.label,
      isBaseline: snapshot.isBaseline,
      createdAt: snapshot.createdAt,
      createdBy: snapshot.createdBy,
    },
    summary,
    totals,
    navLayoutRestored: Boolean(grouped.navLayout),
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
export async function restoreSnapshot(prisma, projectId, snapshotId, { reason, actor, flatten }) {
  const clean = String(reason ?? '').trim();
  if (clean.length < 3) throw bad('Geri yukleme gerekcesi zorunludur (en az 3 karakter).');

  const snapshot = await loadSnapshot(prisma, projectId, snapshotId);
  const plan = await buildRestorePlan(prisma, projectId, snapshotId);
  const grouped = groupItems(snapshot.items);

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

  await prisma.$transaction(async (tx) => {
    // Snapshot BOS ise (o an hic kayit yoktu) `notIn: []` yazmak yerine
    // kosulsuz silmek gerekir: bos bir notIn listesi "hicbirini disarida
    // birakma" demektir ve surucuye gore farkli yorumlanabilir.
    const keepFilter = (type) => {
      const ids = grouped[type].map((i) => i.entityId);
      return ids.length > 0 ? { projectId, id: { notIn: ids } } : { projectId };
    };

    // 1) Snapshot'ta OLMAYAN canli kayitlari sil.
    await tx.traceabilityLink.deleteMany({ where: keepFilter('link') });
    await tx.requirement.deleteMany({ where: keepFilter('requirement') });
    await tx.testCase.deleteMany({ where: keepFilter('testcase') });
    await tx.glossaryTerm.deleteMany({ where: keepFilter('glossary') });
    await tx.attributeDefinition.deleteMany({ where: keepFilter('attributeDef') });

    // 2a) Gereksinimler — parentId HARIC yazilir (kendine referansli FK).
    for (const item of grouped.requirement) {
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
    for (const item of grouped.requirement) {
      if (item.data.parentId) {
        await tx.requirement.update({ where: { id: item.entityId }, data: { parentId: item.data.parentId } });
      }
    }

    for (const item of grouped.testcase) {
      const data = pick(item.data, TESTCASE_COLUMNS);
      data.assigneeId = validUser(item.data.assigneeId);
      await tx.testCase.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    for (const item of grouped.glossary) {
      const data = pick(item.data, GLOSSARY_COLUMNS);
      await tx.glossaryTerm.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    for (const item of grouped.attributeDef) {
      const data = pick(item.data, ATTRIBUTE_DEF_COLUMNS);
      await tx.attributeDefinition.upsert({
        where: { id: item.entityId },
        update: data,
        create: { id: item.entityId, projectId, ...data },
      });
    }

    for (const item of grouped.link) {
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
    await syncAssignees(grouped.requirement, 'requirementAssignee', 'requirementId');
    await syncAssignees(grouped.testcase, 'testCaseAssignee', 'testCaseId');

    // 4) Menu duzeni: snapshot'taki gruplar/sayfalar yeniden kurulur.
    if (grouped.navLayout) {
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

  return { plan, safetySnapshotId: safety.id, safetySnapshotName: safety.name };
}

// ---------------------------------------------------------------------------
//  Diff — iki baseline ya da baseline <-> canli
// ---------------------------------------------------------------------------

/** Karsilastirma icin bir tarafi ortak sekle getirir. */
async function sideOf(prisma, projectId, ref, flatten) {
  if (ref === 'live') {
    const live = await collectProjectState(prisma, projectId);
    const rows = {
      requirement: live.requirements.map((r) => ({
        ...flatten(r),
        assigneeIds: live.reqAssigneeMap.get(r.id) || [],
      })),
      testcase: live.testCases.map((t) => ({ ...flatten(t), assigneeIds: live.tcAssigneeMap.get(t.id) || [] })),
      glossary: live.glossary,
      link: live.links,
      attributeDef: live.attributeDefs,
    };
    const textIdOf = new Map();
    for (const r of live.requirements) textIdOf.set(r.id, r.text_id);
    for (const t of live.testCases) textIdOf.set(t.id, t.text_id);
    for (const g of live.glossary) textIdOf.set(g.id, g.text_id);
    rows.link = live.links.map((l) => ({
      ...l,
      fromTextId: textIdOf.get(l.fromId) || l.fromId,
      toTextId: textIdOf.get(l.toId) || l.toId,
    }));
    return { meta: { id: 'live', name: 'Canli durum', isLive: true }, rows };
  }

  const snapshot = await loadSnapshot(prisma, projectId, ref);
  const grouped = groupItems(snapshot.items);
  return {
    meta: {
      id: snapshot.id,
      name: snapshot.name,
      label: snapshot.label,
      isBaseline: snapshot.isBaseline,
      createdAt: snapshot.createdAt,
      isLive: false,
    },
    rows: {
      requirement: grouped.requirement.map((i) => ({ id: i.entityId, ...i.data })),
      testcase: grouped.testcase.map((i) => ({ id: i.entityId, ...i.data })),
      glossary: grouped.glossary.map((i) => ({ id: i.entityId, ...i.data })),
      link: grouped.link.map((i) => ({ id: i.entityId, ...i.data })),
      attributeDef: grouped.attributeDef.map((i) => ({ id: i.entityId, ...i.data })),
    },
  };
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
  if (entityType === 'link') return `${row.fromTextId || row.fromId} -> ${row.toTextId || row.toId} (${row.type})`;
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
  const [from, to] = await Promise.all([
    sideOf(prisma, projectId, fromRef, flatten),
    sideOf(prisma, projectId, toRef, flatten),
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
  const order = { requirement: 0, testcase: 1, link: 2, glossary: 3, attributeDef: 4 };
  entries.sort(
    (a, b) =>
      (order[a.entityType] ?? 9) - (order[b.entityType] ?? 9) ||
      String(a.status).localeCompare(String(b.status)) ||
      String(a.label).localeCompare(String(b.label), 'tr'),
  );

  return { from: from.meta, to: to.meta, summary, totals, entries };
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
