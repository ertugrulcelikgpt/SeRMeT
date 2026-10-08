// ============================================================================
//  partNumbers.js — PBS dugumlerine Parca No atama + tutarlilik kontrolu (#135).
//
//  NEREDE YASAR? "Bilesenler" sayfasi (#129) bilesenleri PBS agacindan
//  turetir: bir bilesen, alt kirilimi olan bir Requirement dugumudur. Bu
//  yuzden parca kimligi de AYNI satirda durur (Requirement.partNo) — ayri bir
//  tablo ve ayri bir ekran yoktur; her sey Bilesenler sayfasinda olur.
//
//  NUMARA DALA BAGLIDIR: ust dugum kendi blogunu belirler (partNoBlock, orn.
//  AMTB -> "320"), cocuklar o bloktan siradaki BOS numarayi alir. Ayni ada
//  sahip iki dugum (AMTB/GY1 ve STC/GY1) bu sayede farkli numara alir.
//
//  OMUR BOYU BENZERSIZLIK: silinen numara asla yeniden uretilmez — kara liste
//  canli kayitlara ek olarak AuditLog izlerini de tarar (bkz. partNo.js
//  usedPartNos, idGen.js ile ayni yaklasim).
// ============================================================================
import { MAX_COMPONENT_DEPTH } from './constants.js';
import {
  PART_NO_AUDIT_FIELD,
  blockOf,
  childBlockOf,
  configOf,
  isValidPartNo,
  nextPartNoInBlock,
  nextRootBlock,
  usedPartNos,
} from './partNo.js';

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
};

// 'info' seviyesindeki bulgular bir HATA degildir; rozet sayilirken ayrilsin
// diye isaretlenir.
const SEVERITY = { ERROR: 'error', WARN: 'warn', INFO: 'info' };

async function loadProject(prisma, projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { id: true, partNoFormat: true, partNoBlockStep: true },
  });
  if (!project) throw bad('Proje bulunamadi.', 404);
  return project;
}

/** Agac gezintisi icin: ust -> cocuklar (text_id'ye gore, tree.js ile ayni sira). */
function childMapOf(rows) {
  const byParent = new Map();
  for (const row of rows) {
    const key = row.parentId ?? null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key).push(row);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => String(a.text_id || '').localeCompare(String(b.text_id || '')));
  }
  return byParent;
}

/**
 * Parca No'su OLMAYAN her PBS dugumune numara atar. Idempotenttir: zaten
 * numarasi olan kayda DOKUNMAZ (kullanicinin elle verdigi numara korunur).
 *
 * Neden tek gecisde ve YUKARIDAN ASAGI? Cocugun numarasi ustun blogundan
 * turer; ust heniz numarasizken cocugu numaralamak yanlis bloga yazardi.
 * Bu yuzden kokten baslanir ve yeni atanan numaralar ayni gecis icinde
 * "kullanildi" sayilir (tek DB turu, N+1 yok).
 *
 * @returns {Promise<{assigned: number, skipped: number, items: Array}>}
 */
export async function ensurePartNumbers(prisma, projectId, actor) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const rows = await prisma.requirement.findMany({
    where: { projectId },
    select: { id: true, parentId: true, text_id: true, title: true, partNo: true, partNoBlock: true },
  });
  const used = await usedPartNos(prisma, projectId);
  const byParent = childMapOf(rows);
  const byId = new Map(rows.map((r) => [r.id, { ...r }]));

  // Kok bloklarini tek yerden dagitmak icin: halihazirda kullanilan bloklar.
  const rootBlocks = (byParent.get(null) || [])
    .map((r) => String(r.partNoBlock || '').trim() || blockOf(r.partNo, cfg.format))
    .filter(Boolean);

  const assignments = [];
  let skipped = 0;

  const walk = (parentId, depth) => {
    if (depth > MAX_COMPONENT_DEPTH) return;
    for (const child of byParent.get(parentId) || []) {
      const node = byId.get(child.id);
      if (node.partNo) {
        skipped += 1;
      } else {
        const parent = parentId ? byId.get(parentId) : null;
        let block = childBlockOf(parent, cfg.format);
        if (!block) {
          block = nextRootBlock(rootBlocks, cfg);
          rootBlocks.push(block);
        }
        const partNo = nextPartNoInBlock(block, used, cfg.format);
        used.add(partNo); // ayni gecisteki kardesler ayni numarayi almasin
        node.partNo = partNo;
        assignments.push({ id: node.id, partNo, text_id: node.text_id, title: node.title });
      }
      walk(child.id, depth + 1);
    }
  };
  walk(null, 0);

  if (assignments.length > 0) {
    await prisma.$transaction([
      ...assignments.map((a) => prisma.requirement.update({ where: { id: a.id }, data: { partNo: a.partNo } })),
      ...assignments.map((a) =>
        prisma.auditLog.create({
          data: {
            projectId,
            action: 'PARTNO_ASSIGN',
            entityType: 'requirement',
            entityId: a.id,
            textId: a.partNo,
            field: PART_NO_AUDIT_FIELD,
            newValue: a.partNo,
            message: `Parca No atandi: ${a.partNo} (${a.text_id}).`,
            actor: actor ?? null,
          },
        }),
      ),
    ]);
  }
  return { assigned: assignments.length, skipped, items: assignments };
}

/**
 * Tek bir dugumun Parca No'sunu ELLE ayarlar (kullanici duzenlemesi).
 * Bicim ve PROJE ICI TEKILLIK (silinmis numaralar dahil) dogrulanir;
 * cakismada 409 firlatilir ve HICBIR SEY yazilmaz.
 * Bos string gonderilirse numara KALDIRILIR.
 * @returns {Promise<object>} guncellenmis gereksinim
 */
export async function setPartNo(prisma, projectId, requirementId, rawPartNo, actor) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const before = await prisma.requirement.findUnique({ where: { id: requirementId } });
  if (!before || before.projectId !== projectId) throw bad('Gereksinim bulunamadi.', 404);

  const next = rawPartNo == null ? '' : String(rawPartNo).trim();
  if (next === (before.partNo || '')) return before;

  if (next && !isValidPartNo(next, cfg.format)) {
    throw bad(`Parca No bicime uymuyor: "${next}" (beklenen: ${cfg.format}).`);
  }
  if (next) {
    const used = await usedPartNos(prisma, projectId);
    used.delete(before.partNo || '');
    if (used.has(next)) {
      throw bad(`Parca No ${next} zaten kullanilmis (silinmis kayitlar dahil); kaydedilmedi.`, 409);
    }
  }

  const updated = await prisma.requirement.update({
    where: { id: requirementId },
    data: { partNo: next || null },
  });
  await prisma.auditLog.create({
    data: {
      projectId,
      action: 'PARTNO_CHANGE',
      entityType: 'requirement',
      entityId: requirementId,
      // Eski numara kara listede kalsin diye ikisi BIRLIKTE yazilir.
      textId: [before.partNo, next].filter(Boolean).join(' -> ') || before.text_id,
      field: PART_NO_AUDIT_FIELD,
      oldValue: before.partNo || null,
      newValue: next || null,
      message: next
        ? `Parca No guncellendi: ${before.partNo || '—'} -> ${next} (${before.text_id}).`
        : `Parca No kaldirildi: ${before.partNo} (${before.text_id}).`,
      actor: actor ?? null,
    },
  });
  return updated;
}

/** Bir dalin cocuklarina verecegi blok/onek (orn. AMTB -> "320"). */
export async function setPartNoBlock(prisma, projectId, requirementId, rawBlock, actor) {
  const before = await prisma.requirement.findUnique({ where: { id: requirementId } });
  if (!before || before.projectId !== projectId) throw bad('Gereksinim bulunamadi.', 404);
  const clean = rawBlock == null ? '' : String(rawBlock).trim();
  if (clean && !/^\d+$/.test(clean)) throw bad('Blok yalnizca rakam icerebilir (orn. 320).');
  const updated = await prisma.requirement.update({
    where: { id: requirementId },
    data: { partNoBlock: clean || null },
  });
  await prisma.auditLog.create({
    data: {
      projectId,
      action: 'UPDATE',
      entityType: 'requirement',
      entityId: requirementId,
      textId: before.text_id,
      field: 'partNoBlock',
      oldValue: before.partNoBlock || null,
      newValue: clean || null,
      message: `Alt parca blogu: ${before.partNoBlock || '—'} -> ${clean || '—'} (${before.text_id}).`,
      actor: actor ?? null,
    },
  });
  return updated;
}

/**
 * Bilesen haritasinin tutarliligini denetler. Agac tek sorguda bellege alinir
 * (recursive CTE yerine): dongu ve derinlik tespiti zaten TUM kenarlari
 * gerektirir, ayrica ihlaller tek gecisde toplanabilir.
 * @returns {Promise<{issues: Array, counts: object, total: number}>}
 */
export async function checkPartNumbers(prisma, projectId) {
  const project = await loadProject(prisma, projectId);
  const cfg = configOf(project);
  const rows = await prisma.requirement.findMany({
    where: { projectId },
    select: { id: true, parentId: true, text_id: true, title: true, partNo: true, partNoBlock: true },
  });
  const byId = new Map(rows.map((r) => [r.id, r]));
  const childCount = new Map();
  for (const row of rows) {
    if (row.parentId) childCount.set(row.parentId, (childCount.get(row.parentId) ?? 0) + 1);
  }
  const issues = [];
  const label = (r) => r.title?.trim() || r.text_id;
  const add = (code, severity, row, message) =>
    issues.push({
      code,
      severity,
      requirementId: row?.id ?? null,
      partNo: row?.partNo ?? null,
      text_id: row?.text_id ?? null,
      name: row ? label(row) : null,
      message,
    });

  // 1) Ayni Parca No iki dugumde + 3) bicime uymayan kayit + Parca No'su yok.
  const seen = new Map();
  for (const row of rows) {
    if (!row.partNo) {
      // Numarasizlik yalnizca BILESEN dugumlerinde (alt kirilimi olanlarda)
      // bir eksikliktir; yaprak gereksinimler numarasiz kalabilir.
      if ((childCount.get(row.id) ?? 0) > 0) {
        add(CHECK_CODE.MISSING_PART_NO, SEVERITY.WARN, row, `"${label(row)}" bileseninin Parca No'su yok.`);
      }
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
    if (!isValidPartNo(row.partNo, cfg.format)) {
      add(CHECK_CODE.INVALID_FORMAT, SEVERITY.ERROR, row, `${row.partNo} bicime uymuyor (beklenen: ${cfg.format}).`);
    }
  }

  // 2) Ayni ust altinda ayni ada sahip iki kardes.
  const siblingNames = new Map();
  for (const row of rows) {
    const key = `${row.parentId ?? 'root'}::${label(row).toLocaleLowerCase('tr')}`;
    if (siblingNames.has(key)) {
      add(
        CHECK_CODE.DUPLICATE_SIBLING_NAME,
        SEVERITY.WARN,
        row,
        `Ayni ust altinda "${label(row)}" adinda birden fazla dugum var.`,
      );
    } else {
      siblingNames.set(key, row);
    }
  }

  for (const row of rows) {
    // 5) Ustsuz (orphan): parentId dolu ama hedef bu projede yok.
    if (row.parentId && !byId.has(row.parentId)) {
      add(CHECK_CODE.ORPHAN, SEVERITY.ERROR, row, `"${label(row)}" dugumunun ust parcasi bulunamadi.`);
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
        `${row.partNo}, ust parca "${label(parent)}" blogunun (${expected}.*) disinda.`,
      );
    }
  }

  // 6) Dongu (cycle) ve maksimum derinlik asimi — tek gezintide.
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
      add(CHECK_CODE.CYCLE, SEVERITY.ERROR, row, `"${label(row)}" dugumu bir dongunun parcasi.`);
    } else if (depth > MAX_COMPONENT_DEPTH) {
      add(
        CHECK_CODE.MAX_DEPTH,
        SEVERITY.ERROR,
        row,
        `"${label(row)}" azami derinligi (${MAX_COMPONENT_DEPTH}) asiyor.`,
      );
    }
  }

  const counts = issues.reduce((acc, i) => ({ ...acc, [i.code]: (acc[i.code] ?? 0) + 1 }), {});
  return {
    issues,
    counts,
    total: issues.length,
    errorCount: issues.filter((i) => i.severity === SEVERITY.ERROR).length,
    format: cfg.format,
    blockStep: cfg.blockStep,
  };
}
