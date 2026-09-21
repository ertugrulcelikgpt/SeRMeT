// ============================================================================
//  components.js — Bilesen (parca) agaci: CRUD + tutarlilik kontrolu (#135).
//
//  BILESEN NEDIR? PBS agacinin dugumu bir GEREKSINIM degil, bir URUNDUR:
//  montaj / alt montaj / donanim / gomulu yazilim. Kimligi Parca No'dur —
//  ayni ada sahip iki dugum (AMTB/GY1 ve STC/GY1) FARKLI parcalardir ve bunu
//  tasiyan sey Parca No'dur (320.00.001 vs 340.00.001).
//
//  Numaralandirma partNo.js'te; burasi kalicilik, yetki disi is kurallari ve
//  denetim izi (audit) katmanidir. Parca No degisiklikleri AuditLog'a
//  "eski -> yeni" olarak yazilir: hem izlenebilirlik hem de silinen/eski
//  numaralarin bir daha uretilmemesi (kara liste, bkz. partNo.usedPartNos).
// ============================================================================
import { COMPONENT_TYPE, COMPONENT_TYPES, MAX_COMPONENT_DEPTH } from './constants.js';
import { allocatePartNo, blockOf, childBlockOf, configOf, isValidPartNo, usedPartNos } from './partNo.js';

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });

/** Tutarlilik ihlali kodlari — frontend i18n anahtarlariyla birebir ayni. */
export const CHECK_CODE = {
  DUPLICATE_PART_NO: 'DUPLICATE_PART_NO',
  DUPLICATE_SIBLING_NAME: 'DUPLICATE_SIBLING_NAME',
  INVALID_FORMAT: 'INVALID_FORMAT',
  BLOCK_MISMATCH: 'BLOCK_MISMATCH',
  ORPHAN: 'ORPHAN',
  CYCLE: 'CYCLE',
  MAX_DEPTH: 'MAX_DEPTH',
  MISSING_PART_NO: 'MISSING_PART_NO',
  NO_REQUIREMENTS: 'NO_REQUIREMENTS',
};

// 'info' seviyesindeki bulgular bir HATA degildir (orn. heniz gereksinim
// baglanmamis bilesen) — rozet sayilirken ayrilabilsin diye isaretlenir.
const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

const normalizeType = (type) => {
  const clean = String(type ?? '')
    .trim()
    .toLowerCase();
  if (!clean) return COMPONENT_TYPE.ASSEMBLY;
  if (!COMPONENT_TYPES.includes(clean)) {
    throw bad(`Gecersiz bilesen tipi: "${type}". Gecerli tipler: ${COMPONENT_TYPES.join(', ')}.`);
  }
  return clean;
};

async function loadProject(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, partNoFormat: true, partNoBlockStep: true },
  });
  if (!project) throw bad('Proje bulunamadi.', 404);
  return project;
}

/**
 * Projenin TUM bilesenlerini duz liste olarak dondurur. Agac kucuk oldugu
 * icin (yuzler mertebesi) lazy-load'a gerek yoktur: tek sorgu + istemcide
 * agac kurulumu, hem arama hem tutarlilik rozetleri icin tam veri saglar.
 * Her satirda bagli gereksinim SAYISI da doner (#129 menusu icin).
 */
export async function listComponents(prisma, projectId) {
  const [rows, counts] = await Promise.all([
    prisma.component.findMany({
      where: { projectId },
      orderBy: [{ partNo: 'asc' }],
    }),
    prisma.requirement.groupBy({
      by: ['componentId'],
      where: { projectId, componentId: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const countMap = new Map(counts.map((c) => [c.componentId, c._count._all]));
  return rows.map((r) => ({ ...r, requirementCount: countMap.get(r.id) ?? 0 }));
}

/** Bir bilesene bagli gereksinimler (#129: "Su Pompasi -> su gereksinimler"). */
export async function listComponentRequirements(prisma, projectId, componentId) {
  const component = await prisma.component.findUnique({ where: { id: componentId } });
  if (!component || component.projectId !== projectId) throw bad('Bilesen bulunamadi.', 404);
  return prisma.requirement.findMany({
    where: { projectId, componentId },
    orderBy: [{ text_id: 'asc' }],
  });
}

/**
 * Yeni bilesen. Parca No verilmezse USTUN BLOGUNDAN otomatik atanir; elle
 * verilirse bicim + tekillik (kara liste dahil) dogrulanir.
 */
export async function createComponent(prisma, projectId, input, actor) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const name = String(input?.name ?? '').trim();
  if (!name) throw bad('Bilesen adi bos olamaz.');
  const type = normalizeType(input?.type);

  const parentId = input?.parentId ? String(input.parentId) : null;
  if (parentId) {
    const parent = await prisma.component.findUnique({ where: { id: parentId } });
    if (!parent || parent.projectId !== projectId) throw bad('Ust bilesen bulunamadi.', 404);
  }

  const partNo = input?.partNo
    ? await assertAssignablePartNo(prisma, projectId, String(input.partNo).trim(), cfg.format, null)
    : await allocatePartNo(prisma, projectId, parentId, project);

  const created = await prisma.component.create({
    data: {
      projectId,
      parentId,
      name,
      partNo,
      type,
      revision: String(input?.revision ?? 'A').trim() || 'A',
      partNoBlock: normalizeBlock(input?.partNoBlock),
      description: String(input?.description ?? '').trim(),
      order: Number.isInteger(input?.order) ? input.order : 0,
    },
  });
  await writeAudit(prisma, projectId, {
    action: 'CREATE',
    entityId: created.id,
    textId: created.partNo,
    message: `Yeni bilesen: "${created.name}" (${created.partNo}).`,
    actor,
  });
  return created;
}

/**
 * Bilesen guncelleme. Parca No elle degistirilebilir; CAKISMA varsa kayit
 * YAPILMAZ ve 409 ile uyari doner. Degisiklik AuditLog'a "eski -> yeni"
 * yazilir (hem izlenebilirlik hem kara liste).
 */
export async function updateComponent(prisma, projectId, id, input, actor) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const before = await prisma.component.findUnique({ where: { id } });
  if (!before || before.projectId !== projectId) throw bad('Bilesen bulunamadi.', 404);

  const data = {};
  if (input?.name != null) {
    const name = String(input.name).trim();
    if (!name) throw bad('Bilesen adi bos olamaz.');
    data.name = name;
  }
  if (input?.type != null) data.type = normalizeType(input.type);
  if (input?.revision != null) data.revision = String(input.revision).trim() || 'A';
  if (input?.description != null) data.description = String(input.description).trim();
  if (input?.order != null && Number.isInteger(input.order)) data.order = input.order;
  if (input?.partNoBlock !== undefined) data.partNoBlock = normalizeBlock(input.partNoBlock);
  if (input?.parentId !== undefined) data.parentId = await resolveParent(prisma, projectId, id, input.parentId);

  let partNoChanged = null;
  if (input?.partNo != null) {
    const next = String(input.partNo).trim();
    if (next !== before.partNo) {
      data.partNo = await assertAssignablePartNo(prisma, projectId, next, cfg.format, before.partNo);
      partNoChanged = { from: before.partNo, to: data.partNo };
    }
  }

  const updated = await prisma.component.update({ where: { id }, data });
  if (partNoChanged) {
    await writeAudit(prisma, projectId, {
      action: 'RENAME',
      entityId: id,
      // Eski numara kara listede kalsin diye ikisi BIRLIKTE yazilir.
      textId: `${partNoChanged.from} -> ${partNoChanged.to}`,
      field: 'partNo',
      oldValue: partNoChanged.from,
      newValue: partNoChanged.to,
      message: `Parca No guncellendi: ${partNoChanged.from} -> ${partNoChanged.to}.`,
      actor,
    });
  }
  const otherChanges = Object.keys(data).filter((k) => k !== 'partNo');
  if (otherChanges.length > 0) {
    await writeAudit(prisma, projectId, {
      action: 'UPDATE',
      entityId: id,
      textId: updated.partNo,
      message: `Bilesen guncellendi: "${updated.name}" (${otherChanges.join(', ')}).`,
      actor,
    });
  }
  return updated;
}

/**
 * Bilesen silme. Cocuklar SILINMEZ (schema: SetNull) — koke duser ve
 * tutarlilik raporunda ORPHAN olarak gorunur; sessiz veri kaybi yerine
 * gorunur uyari tercih edildi. Silinen Parca No audit'te kaldigi icin bir
 * daha URETILMEZ.
 */
export async function deleteComponent(prisma, projectId, id, reason, actor) {
  const before = await prisma.component.findUnique({ where: { id } });
  if (!before || before.projectId !== projectId) throw bad('Bilesen bulunamadi.', 404);
  const childCount = await prisma.component.count({ where: { projectId, parentId: id } });
  await prisma.component.delete({ where: { id } });
  await writeAudit(prisma, projectId, {
    action: 'DELETE',
    entityId: id,
    textId: before.partNo,
    reason,
    message:
      childCount > 0
        ? `Bilesen silindi: "${before.name}" (${before.partNo}). ${childCount} alt parca koke tasindi.`
        : `Bilesen silindi: "${before.name}" (${before.partNo}).`,
    actor,
  });
  return { id, partNo: before.partNo, orphanedChildren: childCount };
}

// --- Tutarlilik kontrolu ----------------------------------------------------

/**
 * Bilesen haritasinin dogrulugunu denetler. Agac tek sorguda bellege alinir
 * (recursive CTE yerine): dongu ve derinlik tespiti icin zaten TUM kenarlara
 * ihtiyac var, ayrica JS tarafinda kontrol hem test edilebilir hem de
 * ihlalleri TEK gecisde toplanabilir.
 * @returns {Promise<{issues: Array, counts: object, total: number}>}
 */
export async function checkComponentTree(prisma, projectId) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const rows = await listComponents(prisma, projectId);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const issues = [];
  const add = (code, severity, row, message) =>
    issues.push({
      code,
      severity,
      componentId: row?.id ?? null,
      partNo: row?.partNo ?? null,
      name: row?.name ?? null,
      message,
    });

  // 1) Ayni Parca No iki dugumde (DB @@unique bunu engeller; yine de eski
  //    veri / manuel mudahale ihtimaline karsi raporlanir).
  const seen = new Map();
  for (const row of rows) {
    if (!row.partNo) {
      add(CHECK_CODE.MISSING_PART_NO, SEVERITY.ERROR, row, `"${row.name}" bileseninin Parca No'su yok.`);
      continue;
    }
    if (seen.has(row.partNo)) {
      add(
        CHECK_CODE.DUPLICATE_PART_NO,
        SEVERITY.ERROR,
        row,
        `Parca No ${row.partNo} birden fazla dugumde kullanilmis.`,
      );
    } else {
      seen.set(row.partNo, row);
    }
    // 3) Bicime uymayan kayit.
    if (!isValidPartNo(row.partNo, cfg.format)) {
      add(CHECK_CODE.INVALID_FORMAT, SEVERITY.ERROR, row, `${row.partNo} bicime uymuyor (beklenen: ${cfg.format}).`);
    }
  }

  // 2) Ayni ust altinda ayni ada sahip iki kardes.
  const siblingNames = new Map();
  for (const row of rows) {
    const key = `${row.parentId ?? 'root'}::${String(row.name).trim().toLocaleLowerCase('tr')}`;
    if (siblingNames.has(key)) {
      add(
        CHECK_CODE.DUPLICATE_SIBLING_NAME,
        SEVERITY.WARN,
        row,
        `Ayni ust altinda "${row.name}" adinda birden fazla bilesen var.`,
      );
    } else {
      siblingNames.set(key, row);
    }
  }

  for (const row of rows) {
    // 5) Ustsuz (orphan): parentId dolu ama hedef yok / baska projede.
    if (row.parentId && !byId.has(row.parentId)) {
      add(CHECK_CODE.ORPHAN, SEVERITY.ERROR, row, `"${row.name}" bileseninin ust parcasi bulunamadi.`);
      continue;
    }
    // 4) Ustunun blok araligi disinda numara (orn. STC altinda 320.*).
    const parent = row.parentId ? byId.get(row.parentId) : null;
    const expected = childBlockOf(parent, cfg.format);
    const actual = blockOf(row.partNo, cfg.format);
    if (parent && expected && actual && expected !== actual) {
      add(
        CHECK_CODE.BLOCK_MISMATCH,
        SEVERITY.ERROR,
        row,
        `${row.partNo}, ust parca "${parent.name}" blogunun (${expected}.*) disinda.`,
      );
    }
    // 7) Hicbir gereksinime bagli olmayan bilesen (bilgi amacli).
    if (row.requirementCount === 0) {
      add(CHECK_CODE.NO_REQUIREMENTS, SEVERITY.INFO, row, `"${row.name}" bilesenine bagli gereksinim yok.`);
    }
  }

  // 5b/6) Dongu (cycle) ve maksimum derinlik asimi — tek gezintide.
  for (const row of rows) {
    let depth = 0;
    let cursor = row.parentId ? byId.get(row.parentId) : null;
    const path = new Set([row.id]);
    let cyclic = false;
    while (cursor) {
      if (path.has(cursor.id)) {
        cyclic = true;
        break;
      }
      path.add(cursor.id);
      depth += 1;
      if (depth > MAX_COMPONENT_DEPTH) break;
      cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    }
    if (cyclic) {
      add(CHECK_CODE.CYCLE, SEVERITY.ERROR, row, `"${row.name}" bileseni bir dongunun parcasi.`);
    } else if (depth > MAX_COMPONENT_DEPTH) {
      add(CHECK_CODE.MAX_DEPTH, SEVERITY.ERROR, row, `"${row.name}" azami derinligi (${MAX_COMPONENT_DEPTH}) asiyor.`);
    }
  }

  const counts = issues.reduce((acc, i) => ({ ...acc, [i.code]: (acc[i.code] ?? 0) + 1 }), {});
  return {
    issues,
    counts,
    total: issues.length,
    errorCount: issues.filter((i) => i.severity === SEVERITY.ERROR).length,
    format: cfg.format,
  };
}

// --- yardimcilar ------------------------------------------------------------

function normalizeBlock(value) {
  if (value == null) return null;
  const clean = String(value).trim();
  if (!clean) return null;
  if (!/^\d+$/.test(clean)) throw bad('Blok yalnizca rakam icerebilir (orn. 320).');
  return clean;
}

/** Yeni ust: proje ici olmali ve KENDI alt agacinda olmamali (dongu yasagi). */
async function resolveParent(prisma, projectId, id, rawParentId) {
  const parentId = rawParentId ? String(rawParentId) : null;
  if (!parentId) return null;
  if (parentId === id) throw bad('Bir bilesen kendisinin ustu olamaz.');
  const rows = await prisma.component.findMany({ where: { projectId }, select: { id: true, parentId: true } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  if (!byId.has(parentId)) throw bad('Ust bilesen bulunamadi.', 404);
  let cursor = byId.get(parentId);
  let depth = 0;
  while (cursor && depth <= MAX_COMPONENT_DEPTH) {
    if (cursor.id === id) throw bad('Bilesen kendi alt agacina tasinamaz (dongu).');
    cursor = cursor.parentId ? byId.get(cursor.parentId) : null;
    depth += 1;
  }
  return parentId;
}

/**
 * Elle verilen Parca No'yu dogrular: bicim + PROJE ICINDE TEKILLIK (silinmis
 * numaralar dahil). Cakismada 409 firlatir — cagiran hicbir sey YAZMAZ.
 */
async function assertAssignablePartNo(prisma, projectId, partNo, format, ownPartNo) {
  if (!partNo) throw bad('Parca No bos olamaz.');
  if (!isValidPartNo(partNo, format)) {
    throw bad(`Parca No bicime uymuyor: "${partNo}" (beklenen: ${format}).`);
  }
  if (partNo === ownPartNo) return partNo;
  const used = await usedPartNos(prisma, projectId);
  if (used.has(partNo)) {
    throw bad(`Parca No ${partNo} zaten kullanilmis (silinmis kayitlar dahil); kaydedilmedi.`, 409);
  }
  return partNo;
}

function writeAudit(
  prisma,
  projectId,
  { action, entityId, textId, field, oldValue, newValue, message, reason, actor },
) {
  return prisma.auditLog.create({
    data: {
      projectId,
      action,
      entityType: 'component',
      entityId,
      textId,
      field: field ?? null,
      oldValue: oldValue ?? null,
      newValue: newValue ?? null,
      message,
      reason: reason ?? null,
      actor: actor ?? null,
    },
  });
}
