// ============================================================================
//  issue128-baseline-scope.test.js — Baseline KAPSAMI (#128, 2. asama).
//
//  Kabul kriterleri birebir:
//   * Baseline alinirken kapsam secilebiliyor: tek modul / birkac modul / proje
//   * Her modulun kendi baseline gecmisi ve surum numarasi AYRI ilerliyor
//   * Birden cok modul baseline'i bir SET altinda toplanabiliyor
//   * Kapsam disina giden baglar referanslariyla (text_id + surum) kaydediliyor
//   * Restore kapsam disindaki kayitlara DOKUNMUYOR
//   * Kismi restore (secili kayitlar) calisiyor
//   * Modul <-> canli ve ayni modulun iki surumu arasi fark alinabiliyor
//   * Kayit detayinda yer aldigi baseline'lar listeleniyor, o surumdeki hali
//     ve canli halle farki okunabiliyor; hicbir baseline'da degilse bos doner
// ============================================================================
import { resetDb } from './_setup.js';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';

const { default: app } = await import('../src/server.js');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let pmToken;
const auth = (r) => r.set('Authorization', `Bearer ${pmToken}`);

/**
 * Her modulden en az bir kayit iceren taze bir proje:
 *   USR-001 (req-user) -> SYS-001 (req-system) -> SW-001 (req-subsystem)
 *   TC-SYS-001 (test-system) SYS-001'i dogrular
 *   GLO-001 (glossary)
 * Baglar modulleri KESER: kapsam disi bag davranisi boylece sinanabilir.
 */
async function freshProject(name) {
  const project = await prisma.project.create({ data: { name } });
  const pid = project.id;
  const usr = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'USR-001', title: 'Kullanici', type: 'User Requirement' },
  });
  const sys = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'SYS-001', title: 'Sistem', type: 'System Requirement', parentId: usr.id },
  });
  const sw = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'SW-001', title: 'Yazilim', type: 'Software Requirement', parentId: sys.id },
  });
  const tc = await prisma.testCase.create({
    data: { projectId: pid, text_id: 'TC-SYS-001', title: 'Sistem testi', type: 'System Test' },
  });
  const glo = await prisma.glossaryTerm.create({
    data: { projectId: pid, text_id: 'GLO-001', term: 'EHSIM', definition: 'Kisaltma' },
  });
  // SYS -> USR (Satisfies): req-system'den req-user'a, MODUL DISI bag.
  const satisfies = await prisma.traceabilityLink.create({
    data: { projectId: pid, fromId: usr.id, toId: sys.id, type: 'Satisfies' },
  });
  // TC -> SYS (Verifies): test-system'den req-system'e, yine MODUL DISI.
  const verifies = await prisma.traceabilityLink.create({
    data: { projectId: pid, fromId: sys.id, toId: tc.id, type: 'Verifies' },
  });
  return { project, pid, usr, sys, sw, tc, glo, satisfies, verifies };
}

const take = (pid, body) => auth(request(app).post(`/api/projects/${pid}/snapshots`)).send(body);
const preview = (pid, sid, query = '') =>
  auth(request(app).get(`/api/projects/${pid}/snapshots/${sid}/restore-preview${query}`));
const restore = (pid, sid, body) => auth(request(app).post(`/api/projects/${pid}/snapshots/${sid}/restore`)).send(body);
const diff = (pid, from, to) => auth(request(app).get(`/api/projects/${pid}/snapshots-diff?from=${from}&to=${to}`));
const entityBaselines = (pid, type, id, sid = '') =>
  auth(request(app).get(`/api/projects/${pid}/entity-baselines/${type}/${id}${sid ? `/${sid}` : ''}`));

const itemsOf = (sid, entityType) => prisma.snapshotItem.findMany({ where: { snapshotId: sid, entityType } });

before(async () => {
  resetDb();
  const { hashPassword, signToken } = await import('../src/auth.js');
  const pm = await prisma.user.create({
    data: {
      username: 'pm-scope',
      passwordHash: await hashPassword('pm-pass-1234'),
      name: 'Kapsam PM',
      role: 'Proje Yöneticisi',
      clearanceLevel: 5,
    },
  });
  pmToken = signToken({ userId: pm.id, roleKey: 'pm', clearanceLevel: 5 });
});

after(async () => {
  await prisma.$disconnect();
});

// --- 1) Kapsam secimi -------------------------------------------------------

test('MODUL baseline yalnizca o modulun kayitlarini dondurur', async () => {
  const { pid } = await freshProject('Modul Kapsami');
  const res = await take(pid, {
    name: 'SRS',
    label: 'v1.0',
    isBaseline: true,
    reason: 'Sistem gereksinimleri donduruldu.',
    modules: ['req-system'],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.scope, 'module');
  assert.deepEqual(res.body.modules, ['req-system']);
  assert.equal(res.body.moduleKey, 'req-system');

  const reqs = await itemsOf(res.body.id, 'requirement');
  assert.deepEqual(
    reqs.map((i) => i.data.text_id),
    ['SYS-001'],
  );
  // Kapsam disi moduller hic girmez.
  assert.equal((await itemsOf(res.body.id, 'testcase')).length, 0);
  assert.equal((await itemsOf(res.body.id, 'glossary')).length, 0);
});

test('PROJE kapsami varsayilandir ve her seyi icerir', async () => {
  const { pid } = await freshProject('Proje Kapsami');
  const res = await take(pid, { name: 'Tum proje' });
  assert.equal(res.status, 201);
  assert.equal(res.body.scope, 'project');
  assert.equal(res.body.modules, null);
  assert.equal((await itemsOf(res.body.id, 'requirement')).length, 3);
  assert.equal((await itemsOf(res.body.id, 'testcase')).length, 1);
  assert.equal((await itemsOf(res.body.id, 'glossary')).length, 1);
  // Proje kapsaminda hicbir bag "kapsam disi" degildir.
  assert.equal((await itemsOf(res.body.id, 'externalLink')).length, 0);
});

test('TUM moduller secilirse kapsam proje genelidir (tek gosterim)', async () => {
  const { pid } = await freshProject('Hepsi Secili');
  const res = await take(pid, {
    name: 'Hepsi',
    modules: [
      'req-user',
      'req-system',
      'req-subsystem',
      'test-acceptance',
      'test-system',
      'test-subsystem',
      'glossary',
    ],
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.scope, 'project');
  assert.equal(res.body.modules, null);
});

test('gecersiz modul anahtari reddedilir (400)', async () => {
  const { pid } = await freshProject('Gecersiz Modul');
  const res = await take(pid, { name: 'Hatali', modules: ['req-olmayan'] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /modul/i);
  assert.equal(await prisma.projectSnapshot.count({ where: { projectId: pid } }), 0);
});

// --- 2) Modul basina bagimsiz surum gecmisi ---------------------------------

test('her modulun surum numarasi BAGIMSIZ ilerler', async () => {
  const { pid } = await freshProject('Surum Gecmisi');
  const srs1 = await take(pid, {
    name: 'SRS v1',
    label: 'v1.0',
    isBaseline: true,
    reason: 'ilk',
    modules: ['req-system'],
  });
  const sdd1 = await take(pid, {
    name: 'SDD v1',
    label: 'v1.0',
    isBaseline: true,
    reason: 'ilk',
    modules: ['req-subsystem'],
  });
  const srs2 = await take(pid, {
    name: 'SRS v2',
    label: 'v1.1',
    isBaseline: true,
    reason: 'ikinci',
    modules: ['req-system'],
  });

  assert.equal(srs1.body.version, 1);
  // Baska bir modulun baseline'i SRS sayacini ILERLETMEZ.
  assert.equal(sdd1.body.version, 1);
  assert.equal(srs2.body.version, 2);
});

test('siradan snapshot surum numarasi ALMAZ', async () => {
  const { pid } = await freshProject('Surumsuz Ara Kayit');
  const res = await take(pid, { name: 'Ara kayit', modules: ['req-system'] });
  assert.equal(res.status, 201);
  assert.equal(res.body.version, null);
});

// --- 3) Baseline seti -------------------------------------------------------

test('birden cok modul secilince BASELINE SET olusur, modul basina bir baseline', async () => {
  const { pid } = await freshProject('CDR Paketi');
  const res = await take(pid, {
    name: 'CDR paketi',
    label: 'CDR',
    isBaseline: true,
    reason: 'Kritik tasarim gozden gecirmesi teslimi.',
    modules: ['req-system', 'req-subsystem', 'test-system'],
  });
  assert.equal(res.status, 201);
  assert.ok(res.body.set, 'set dondurulmeli');
  assert.equal(res.body.snapshots.length, 3);
  for (const snap of res.body.snapshots) {
    assert.equal(snap.setId, res.body.set.id);
    assert.equal(snap.isBaseline, true);
    // Her modul KENDI sayacinda 1. surumdedir.
    assert.equal(snap.version, 1);
  }
  assert.deepEqual(
    res.body.snapshots.map((s) => s.moduleKey),
    ['req-system', 'req-subsystem', 'test-system'],
  );

  const sets = await auth(request(app).get(`/api/projects/${pid}/baseline-sets`));
  assert.equal(sets.status, 200);
  assert.equal(sets.body.length, 1);
  assert.equal(sets.body[0].label, 'CDR');
  assert.equal(sets.body[0].snapshots.length, 3);
});

test('baseline seti olusturma her modul icin AYRI audit kaydi yazar', async () => {
  const { pid } = await freshProject('Set Audit');
  await take(pid, {
    name: 'PDR paketi',
    isBaseline: true,
    reason: 'PDR teslimi.',
    modules: ['req-system', 'test-system'],
  });
  const rows = await prisma.auditLog.findMany({ where: { projectId: pid, action: 'BASELINE_CREATE' } });
  assert.equal(rows.length, 2);
  // Kapsam ve set adi audit mesajinda gorunur (kim/ne zaman/hangi kapsam).
  assert.ok(rows.every((r) => /kapsam:/i.test(r.message)));
  assert.ok(rows.every((r) => /PDR paketi/.test(r.message)));
});

// --- 4) Kapsam disina giden baglar -----------------------------------------

test('kapsam disina giden baglar hedefin text_id ve SURUMU ile saklanir', async () => {
  const { pid, sys } = await freshProject('Kapsam Disi Bag');
  // SYS-001'i bir kez degistir: surumu 2'ye ciksin.
  await prisma.requirementHistory.create({
    data: {
      projectId: pid,
      requirementId: sys.id,
      version: 1,
      text_id: 'SYS-001',
      title: 'Sistem',
      type: 'System Requirement',
      status: 'In Review',
    },
  });

  const res = await take(pid, { name: 'Sadece testler', modules: ['test-system'] });
  const external = await itemsOf(res.body.id, 'externalLink');
  // TC -> SYS bagi kapsam disina cikar; SYS referansiyla birlikte kalir.
  assert.equal(external.length, 1);
  const data = external[0].data;
  assert.equal(data.outsideTextId, 'SYS-001');
  assert.equal(data.outsideModule, 'req-system');
  assert.equal(data.outsideVersion, 2, 'hedefin o anki surumu kaydedilmeli');
  assert.equal(data.outsideEntityType, 'requirement');
  // Kapsam ici bag olarak SAYILMAZ.
  assert.equal((await itemsOf(res.body.id, 'link')).length, 0);
});

test('kapsam disi baglar RESTORE edilmez, referans olarak kalir', async () => {
  const { pid, sys, tc } = await freshProject('Kapsam Disi Restore');
  const snap = await take(pid, { name: 'Test modulu', modules: ['test-system'] });
  assert.equal((await itemsOf(snap.body.id, 'externalLink')).length, 1);

  // Bagi sil, sonra baseline'a don: kapsam disi bag GERI GELMEZ.
  await prisma.traceabilityLink.deleteMany({ where: { fromId: sys.id, toId: tc.id } });
  const res = await restore(pid, snap.body.id, { reason: 'Test modulu geri yuklendi.' });
  assert.equal(res.status, 200);
  assert.equal(await prisma.traceabilityLink.count({ where: { fromId: sys.id, toId: tc.id } }), 0);
});

// --- 5) Kapsamli restore ----------------------------------------------------

test('MODUL restore kapsam disindaki kayitlara DOKUNMAZ', async () => {
  const { pid, sys } = await freshProject('Kapsamli Restore');
  const snap = await take(pid, {
    name: 'SRS',
    label: 'v1.0',
    isBaseline: true,
    reason: 'dondur',
    modules: ['req-system'],
  });

  // Kapsam ICINDE degisiklik + kapsam DISINDA yeni kayit.
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Degistirildi' } });
  const yeniUsr = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'USR-002', title: 'Sonradan eklendi', type: 'User Requirement' },
  });
  const yeniTc = await prisma.testCase.create({
    data: { projectId: pid, text_id: 'TC-SYS-002', title: 'Sonradan eklendi', type: 'System Test' },
  });

  const res = await restore(pid, snap.body.id, { reason: 'SRS v1.0 durumuna donuldu.' });
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'module');

  // Kapsam ici: eski haline dondu.
  assert.equal((await prisma.requirement.findUnique({ where: { id: sys.id } })).title, 'Sistem');
  // Kapsam disi: sonradan eklenenler DURUYOR.
  assert.ok(await prisma.requirement.findUnique({ where: { id: yeniUsr.id } }));
  assert.ok(await prisma.testCase.findUnique({ where: { id: yeniTc.id } }));
});

test('MODUL restore, kapsam icinde SONRADAN eklenen kaydi siler', async () => {
  const { pid } = await freshProject('Kapsam Ici Silme');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });
  const fazlalik = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'SYS-002', title: 'Fazladan', type: 'System Requirement' },
  });

  const plan = await preview(pid, snap.body.id);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.summary.requirement.deleted, 1);
  assert.equal(plan.body.partial, false);

  await restore(pid, snap.body.id, { reason: 'Fazlalik temizlendi.' });
  assert.equal(await prisma.requirement.findUnique({ where: { id: fazlalik.id } }), null);
});

test('MODUL restore proje geneli oznitelik semasina ve menuye dokunmaz', async () => {
  const { pid } = await freshProject('Sema Korunur');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });
  const def = await prisma.attributeDefinition.create({
    data: { projectId: pid, entityType: 'requirement', key: 'sonradan', label: 'Sonradan', dataType: 'text' },
  });

  await restore(pid, snap.body.id, { reason: 'Modul geri yuklendi.' });
  // Oznitelik tanimi kapsam disidir: silinmemeli.
  assert.ok(await prisma.attributeDefinition.findUnique({ where: { id: def.id } }));
});

test('ust dugum kapsam disinda silinmisse restore patlamaz, parentId bosa duser', async () => {
  const { pid, usr, sys } = await freshProject('Kayip Ebeveyn');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });
  // Ust dugum (USR) kapsam disindadir ve siliniyor -> SYS.parentId SetNull.
  await prisma.requirement.delete({ where: { id: usr.id } });

  const res = await restore(pid, snap.body.id, { reason: 'Ust dugum silinmisken geri yukleme.' });
  assert.equal(res.status, 200);
  const after = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(after.parentId, null);
});

// --- 6) Kismi restore -------------------------------------------------------

test('KISMI restore yalnizca secili kayitlari geri yukler ve hicbir sey silmez', async () => {
  const { pid, sys, sw } = await freshProject('Kismi Restore');
  const snap = await take(pid, { name: 'Tum proje' });

  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'SYS degisti' } });
  await prisma.requirement.update({ where: { id: sw.id }, data: { title: 'SW degisti' } });
  const fazlalik = await prisma.requirement.create({
    data: { projectId: pid, text_id: 'SYS-002', title: 'Fazladan', type: 'System Requirement' },
  });

  const res = await restore(pid, snap.body.id, {
    reason: 'Yalnizca SYS-001 geri alindi.',
    selection: [sys.id],
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.partial, true);

  // Secili kayit dondu...
  assert.equal((await prisma.requirement.findUnique({ where: { id: sys.id } })).title, 'Sistem');
  // ...secilmeyen kayit DOKUNULMADAN kaldi...
  assert.equal((await prisma.requirement.findUnique({ where: { id: sw.id } })).title, 'SW degisti');
  // ...ve snapshot'ta olmayan kayit SILINMEDI.
  assert.ok(await prisma.requirement.findUnique({ where: { id: fazlalik.id } }));
});

test('kismi restore onizlemesi yalnizca secili kayitlari sayar, silme gostermez', async () => {
  const { pid, sys } = await freshProject('Kismi Onizleme');
  const snap = await take(pid, { name: 'Tum proje' });
  await prisma.requirement.create({
    data: { projectId: pid, text_id: 'SYS-002', title: 'Fazladan', type: 'System Requirement' },
  });

  const plan = await preview(pid, snap.body.id, `?selection=${sys.id}`);
  assert.equal(plan.status, 200);
  assert.equal(plan.body.partial, true);
  assert.equal(plan.body.totals.updated, 1);
  assert.equal(plan.body.totals.added, 0);
  assert.equal(plan.body.totals.deleted, 0, 'kismi restore silmez');
});

test('onizleme kayit listesini (entries) dondurur — kismi secim bunun uzerinden yapilir', async () => {
  const { pid, sys } = await freshProject('Onizleme Listesi');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });
  const plan = await preview(pid, snap.body.id);
  const entry = plan.body.entries.find((e) => e.entityId === sys.id);
  assert.ok(entry);
  assert.equal(entry.entityType, 'requirement');
  assert.equal(entry.label, 'SYS-001');
  assert.equal(entry.action, 'update');
});

test('bos secim listesi reddedilir (400)', async () => {
  const { pid } = await freshProject('Bos Secim');
  const snap = await take(pid, { name: 'Tum proje' });
  const res = await restore(pid, snap.body.id, { reason: 'Gecersiz secim denemesi.', selection: [] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /secil/i);
});

test('guvenlik kopyasi geri yuklenenle AYNI kapsami alir', async () => {
  const { pid } = await freshProject('Guvenlik Kapsami');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });
  const res = await restore(pid, snap.body.id, { reason: 'Kapsam kontrolu.' });
  const safety = await prisma.projectSnapshot.findUnique({ where: { id: res.body.safetySnapshotId } });
  assert.equal(safety.kind, 'safety');
  assert.equal(safety.scope, 'module');
  assert.deepEqual(safety.modules, ['req-system']);
});

// --- 7) Kapsamli fark -------------------------------------------------------

test('MODUL baseline <-> canli farki yalnizca o modulu kapsar', async () => {
  const { pid, sys } = await freshProject('Kapsamli Fark');
  const snap = await take(pid, { name: 'SRS', modules: ['req-system'] });

  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'SYS degisti' } });
  // Kapsam DISINDA yeni kayit: farkta GORUNMEMELI.
  await prisma.requirement.create({
    data: { projectId: pid, text_id: 'USR-002', title: 'Kapsam disi yeni', type: 'User Requirement' },
  });

  const res = await diff(pid, snap.body.id, 'live');
  assert.equal(res.status, 200);
  assert.equal(res.body.scope, 'module');
  assert.deepEqual(res.body.modules, ['req-system']);
  assert.equal(res.body.summary.requirement.added, 0, 'kapsam disi kayit "eklendi" sayilmamali');
  assert.equal(res.body.summary.requirement.changed, 1);
  const changed = res.body.entries.find((e) => e.status === 'changed');
  assert.equal(changed.label, 'SYS-001');
  assert.ok(changed.fields.some((f) => f.field === 'title'));
});

test('ayni modulun iki surumu karsilastirilabilir (SRS v1.0 <-> v1.1)', async () => {
  const { pid, sys } = await freshProject('Iki Surum');
  const v1 = await take(pid, {
    name: 'SRS v1',
    label: 'v1.0',
    isBaseline: true,
    reason: 'ilk',
    modules: ['req-system'],
  });
  await prisma.requirement.update({ where: { id: sys.id }, data: { status: 'Approved' } });
  const v2 = await take(pid, {
    name: 'SRS v2',
    label: 'v1.1',
    isBaseline: true,
    reason: 'ikinci',
    modules: ['req-system'],
  });

  const res = await diff(pid, v1.body.id, v2.body.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.from.label, 'v1.0');
  assert.equal(res.body.to.label, 'v1.1');
  assert.equal(res.body.summary.requirement.changed, 1);
  const entry = res.body.entries.find((e) => e.entityId === sys.id);
  assert.ok(entry.fields.some((f) => f.field === 'status' && f.to === 'Approved'));
});

test('kapsam disi baglarin SUPHELI durumu farkta gorunur', async () => {
  const { pid, verifies } = await freshProject('Kapsam Disi Suspect');
  const snap = await take(pid, { name: 'Testler', modules: ['test-system'] });
  await prisma.traceabilityLink.update({ where: { id: verifies.id }, data: { isSuspect: true } });

  const res = await diff(pid, snap.body.id, 'live');
  const entry = res.body.entries.find((e) => e.entityType === 'externalLink');
  assert.ok(entry, 'kapsam disi bag farkta yer almali');
  assert.ok(entry.fields.some((f) => f.field === 'isSuspect' && f.to === true));
});

// --- 8) Kayit uzerinde baseline gorunurlugu --------------------------------

test('kaydin icinde oldugu baseline listelenir; resmi olanlar once gelir', async () => {
  const { pid, sys } = await freshProject('Kayit Baselinelari');
  await take(pid, { name: 'Ara kayit', modules: ['req-system'] });
  const b = await take(pid, {
    name: 'SRS',
    label: 'v1.0',
    isBaseline: true,
    reason: 'teslim',
    modules: ['req-system'],
  });

  const res = await entityBaselines(pid, 'requirement', sys.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 2);
  assert.equal(res.body.baselines[0].id, b.body.id, 'resmi baseline once');
  assert.equal(res.body.baselines[0].label, 'v1.0');
  assert.equal(res.body.baselines[0].moduleKey, 'req-system');
  assert.equal(res.body.baselines[0].version, 1);
});

test('hicbir baselinede yer almayan kayit BOS liste dondurur', async () => {
  const { pid, usr } = await freshProject('Baselinesiz Kayit');
  // Yalnizca req-system dondurulur; USR hicbir kapsama girmez.
  await take(pid, { name: 'SRS', modules: ['req-system'] });
  const res = await entityBaselines(pid, 'requirement', usr.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.total, 0);
  assert.deepEqual(res.body.baselines, []);
});

test('kaydin baselinedeki hali ve canli halle ALAN BAZINDA farki okunur', async () => {
  const { pid, sys } = await freshProject('Kayit Farki');
  const b = await take(pid, {
    name: 'SRS',
    label: 'v1.0',
    isBaseline: true,
    reason: 'teslim',
    modules: ['req-system'],
  });
  await prisma.requirement.update({
    where: { id: sys.id },
    data: { title: 'Yeni baslik', status: 'Approved' },
  });

  const res = await entityBaselines(pid, 'requirement', sys.id, b.body.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.data.title, 'Sistem', 'baseline anindaki hal');
  assert.equal(res.body.live.title, 'Yeni baslik', 'canli hal');
  assert.equal(res.body.changed, true);
  const fields = res.body.fields.map((f) => f.field);
  assert.ok(fields.includes('title'));
  assert.ok(fields.includes('status'));
});

test('kayit canlida silinmisse baseline hali yine okunur (liveDeleted)', async () => {
  const { pid, sys } = await freshProject('Silinmis Kayit');
  const b = await take(pid, { name: 'SRS', modules: ['req-system'] });
  await prisma.requirement.delete({ where: { id: sys.id } });

  const res = await entityBaselines(pid, 'requirement', sys.id, b.body.id);
  assert.equal(res.status, 200);
  assert.equal(res.body.liveDeleted, true);
  assert.equal(res.body.data.text_id, 'SYS-001');
});

test('kayit o baseline icinde degilse 404', async () => {
  const { pid, usr } = await freshProject('Kapsam Disi Kayit Detayi');
  const b = await take(pid, { name: 'SRS', modules: ['req-system'] });
  const res = await entityBaselines(pid, 'requirement', usr.id, b.body.id);
  assert.equal(res.status, 404);
});

test('gecersiz kayit tipi reddedilir (400)', async () => {
  const { pid } = await freshProject('Gecersiz Kayit Tipi');
  const res = await entityBaselines(pid, 'link', 'herhangi');
  assert.equal(res.status, 400);
});
