// ============================================================================
//  issue128-baselines.test.js — Baseline etiketleme / restore / diff (#128).
//
//  Kabul kriterleri birebir:
//   * Snapshot'a surum etiketi + aciklama girilebiliyor, baseline isaretlenebiliyor
//   * Baseline dondurulmus: normal yoldan silinemiyor (ozel izin gerekiyor)
//   * Baseline'a geri donulebiliyor; oncesinde otomatik guvenlik kopyasi aliniyor
//   * Restore TEK transaction; yarida kalirsa proje tutarsiz kalmiyor
//   * Restore oncesi onizleme gosteriliyor, gerekce zorunlu
//   * Baseline olusturma ve restore audit log'a yaziliyor
//   * Iki baseline arasi ve baseline <-> canli fark raporu alinabiliyor
// ============================================================================
import { resetDb } from './_setup.js';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';

const { default: app } = await import('../src/server.js');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let pmToken;
let memberToken;

const auth = (r) => r.set('Authorization', `Bearer ${pmToken}`);

/** Her test kendi projesinde calisir: snapshot adlari proje bazinda tekildir. */
async function freshProject(name) {
  const project = await prisma.project.create({ data: { name } });
  const user = await prisma.requirement.create({
    data: { projectId: project.id, text_id: 'REQ-USR-001', title: 'Kok', type: 'User Requirement' },
  });
  const sys = await prisma.requirement.create({
    data: {
      projectId: project.id,
      text_id: 'REQ-SYS-001',
      title: 'Alt',
      type: 'System Requirement',
      parentId: user.id,
    },
  });
  const tc = await prisma.testCase.create({
    data: { projectId: project.id, text_id: 'TC-SYS-001', title: 'Test', type: 'System Test' },
  });
  const link = await prisma.traceabilityLink.create({
    data: { projectId: project.id, fromId: sys.id, toId: tc.id, type: 'Verifies' },
  });
  return { project, user, sys, tc, link };
}

const snapshotsOf = (pid) => `/api/projects/${pid}/snapshots`;

const takeSnapshot = (pid, body) => auth(request(app).post(snapshotsOf(pid))).send(body);

before(async () => {
  resetDb();
  const { hashPassword, signToken } = await import('../src/auth.js');
  const pm = await prisma.user.create({
    data: {
      username: 'pm-baseline',
      passwordHash: await hashPassword('pm-pass-1234'),
      name: 'Baseline PM',
      role: 'Proje Yöneticisi',
      clearanceLevel: 5,
    },
  });
  pmToken = signToken({ userId: pm.id, roleKey: 'pm', clearanceLevel: 5 });
  const member = await prisma.user.create({
    data: {
      username: 'member-baseline',
      passwordHash: await hashPassword('member-pass-1234'),
      name: 'Baseline Member',
      role: 'System Engineer',
      roleKey: 'system_engineer',
      clearanceLevel: 5,
    },
  });
  memberToken = signToken({ userId: member.id, roleKey: 'system_engineer', clearanceLevel: 5 });
});

after(async () => {
  await prisma.$disconnect();
});

// --- 1) Baseline etiketleme -------------------------------------------------

test('snapshot surum etiketi + aciklama ile baseline olarak isaretlenebilir', async () => {
  const { project } = await freshProject('Etiket Projesi');
  const res = await takeSnapshot(project.id, {
    name: 'Teslim 1',
    label: 'v1.0',
    description: 'SRR teslimi',
    isBaseline: true,
    reason: 'Musteriye teslim edilen surum donduruldu.',
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.label, 'v1.0');
  assert.equal(res.body.description, 'SRR teslimi');
  assert.equal(res.body.isBaseline, true);
  assert.equal(res.body.kind, 'baseline');
  assert.match(res.body.reason, /teslim/i);
});

test('baseline GEREKCESIZ olusturulamaz (400)', async () => {
  const { project } = await freshProject('Gerekcesiz Baseline');
  const res = await takeSnapshot(project.id, { name: 'Teslim', label: 'v1.0', isBaseline: true });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /gerekce/i);
  assert.equal(await prisma.projectSnapshot.count({ where: { projectId: project.id } }), 0);
});

test('siradan snapshot gerekce istemez ve baseline degildir', async () => {
  const { project } = await freshProject('Siradan Snapshot');
  const res = await takeSnapshot(project.id, { name: 'Ara kayit' });
  assert.equal(res.status, 201);
  assert.equal(res.body.isBaseline, false);
  assert.equal(res.body.kind, 'manual');
});

test('mevcut bir snapshot sonradan baseline olarak isaretlenebilir', async () => {
  const { project } = await freshProject('Sonradan Baseline');
  const snap = (await takeSnapshot(project.id, { name: 'Ara kayit' })).body;
  const res = await auth(request(app).patch(`${snapshotsOf(project.id)}/${snap.id}`)).send({
    isBaseline: true,
    label: 'PDR',
    reason: 'PDR noktasi olarak resmilestirildi.',
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.isBaseline, true);
  assert.equal(res.body.label, 'PDR');

  const log = await prisma.auditLog.findFirst({
    where: { projectId: project.id, action: 'BASELINE_UPDATE', entityId: snap.id },
  });
  assert.ok(log, "baseline isaretleme audit log'a yazilmali");
});

test("baseline olusturma audit log'a gerekcesiyle yazilir", async () => {
  const { project } = await freshProject('Audit Projesi');
  const snap = (
    await takeSnapshot(project.id, {
      name: 'Teslim 1',
      label: 'v1.0',
      isBaseline: true,
      reason: 'CDR teslimi icin donduruldu.',
    })
  ).body;
  const log = await prisma.auditLog.findFirst({
    where: { projectId: project.id, action: 'BASELINE_CREATE', entityId: snap.id },
  });
  assert.ok(log);
  assert.match(log.reason, /CDR/);
  assert.match(log.textId, /v1\.0/);
});

// --- 2) Baseline dondurulmustur ---------------------------------------------

test('baseline normal yoldan SILINEMEZ (409)', async () => {
  const { project } = await freshProject('Dondurma Projesi');
  const snap = (
    await takeSnapshot(project.id, {
      name: 'Teslim 1',
      label: 'v1.0',
      isBaseline: true,
      reason: 'Teslim noktasi.',
    })
  ).body;
  const res = await auth(request(app).delete(`${snapshotsOf(project.id)}/${snap.id}`)).send({
    reason: 'Gereksiz sanildi',
  });
  assert.equal(res.status, 409);
  assert.match(res.body.error, /baseline/i);
  assert.ok(await prisma.projectSnapshot.findUnique({ where: { id: snap.id } }), 'kayit durmali');
});

test('baseline yalnizca OZEL IZIN (force) ile silinir ve audit ayrica isaretler', async () => {
  const { project } = await freshProject('Force Silme');
  const snap = (
    await takeSnapshot(project.id, {
      name: 'Teslim 1',
      label: 'v1.0',
      isBaseline: true,
      reason: 'Teslim noktasi.',
    })
  ).body;
  const res = await auth(request(app).delete(`${snapshotsOf(project.id)}/${snap.id}`)).send({
    reason: 'Yanlis alindigi tespit edildi',
    force: true,
  });
  assert.equal(res.status, 200);
  assert.equal(await prisma.projectSnapshot.findUnique({ where: { id: snap.id } }), null);
  const log = await prisma.auditLog.findFirst({
    where: { projectId: project.id, action: 'SNAPSHOT_DELETE', entityId: snap.id },
  });
  assert.match(log.message, /BASELINE silindi \(ozel izin\)/);
});

test('siradan snapshot force olmadan silinir', async () => {
  const { project } = await freshProject('Normal Silme');
  const snap = (await takeSnapshot(project.id, { name: 'Ara kayit' })).body;
  const res = await auth(request(app).delete(`${snapshotsOf(project.id)}/${snap.id}`)).send({
    reason: 'Artik gerekmiyor',
  });
  assert.equal(res.status, 200);
});

// --- 3) Restore onizleme + uygulama ----------------------------------------

test('restore onizlemesi kac kayit eklenecek/guncellenecek/silinecek gosterir ve HICBIR SEY yazmaz', async () => {
  const { project, sys } = await freshProject('Onizleme Projesi');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;

  // Snapshot'tan SONRA: bir kayit degistir, bir yenisini ekle, birini sil.
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Degismis baslik' } });
  await prisma.requirement.create({
    data: { projectId: project.id, text_id: 'REQ-SYS-002', title: 'Yeni', type: 'System Requirement' },
  });
  await prisma.testCase.deleteMany({ where: { projectId: project.id } });

  const res = await auth(request(app).get(`${snapshotsOf(project.id)}/${snap.id}/restore-preview`));
  assert.equal(res.status, 200);
  // Snapshot'ta olup canlida olmayan test yeniden EKLENECEK;
  // snapshot'ta olmayan yeni gereksinim SILINECEK.
  assert.equal(res.body.summary.testcase.added, 1);
  assert.equal(res.body.summary.requirement.deleted, 1);
  assert.equal(res.body.summary.requirement.updated, 2);
  assert.ok(res.body.totals.added >= 1 && res.body.totals.deleted >= 1);

  // Onizleme YAZMAZ: canli durum aynen durur.
  const stillChanged = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(stillChanged.title, 'Degismis baslik');
  assert.equal(await prisma.testCase.count({ where: { projectId: project.id } }), 0);
});

test('restore GEREKCESIZ calistirilamaz ve proje degismez', async () => {
  const { project, sys } = await freshProject('Gerekcesiz Restore');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Degismis' } });

  const res = await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({});
  assert.equal(res.status, 400);
  const row = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(row.title, 'Degismis', 'gerekcesiz istekte hicbir sey geri yuklenmemeli');
});

test("baseline'a geri donulur: degisen duzelir, eklenen silinir, silinen geri gelir", async () => {
  const { project, sys, tc } = await freshProject('Restore Projesi');
  const snap = (
    await takeSnapshot(project.id, {
      name: 'Teslim 1',
      label: 'v1.0',
      isBaseline: true,
      reason: 'Teslim noktasi.',
    })
  ).body;

  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Degismis baslik' } });
  const extra = await prisma.requirement.create({
    data: { projectId: project.id, text_id: 'REQ-SYS-002', title: 'Fazla', type: 'System Requirement' },
  });
  await prisma.testCase.delete({ where: { id: tc.id } });

  const res = await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'v1.0 teslim noktasina donuluyor',
  });
  assert.equal(res.status, 200);

  const restored = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(restored.title, 'Alt', 'degisen baslik baseline haline donmeli');
  assert.equal(await prisma.requirement.findUnique({ where: { id: extra.id } }), null, 'fazla kayit silinmeli');
  const backAgain = await prisma.testCase.findUnique({ where: { id: tc.id } });
  assert.ok(backAgain, 'silinen test geri gelmeli');
  assert.equal(backAgain.text_id, 'TC-SYS-001');
});

test('restore agac yapisini (parentId) ve baglari korur', async () => {
  const { project, user, sys, link } = await freshProject('Agac Restore');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;

  await prisma.requirement.update({ where: { id: sys.id }, data: { parentId: null } });
  await prisma.traceabilityLink.delete({ where: { id: link.id } });

  await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'Agac bozuldu, geri aliniyor',
  });

  const restored = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(restored.parentId, user.id, 'parentId geri yuklenmeli');
  const restoredLink = await prisma.traceabilityLink.findUnique({ where: { id: link.id } });
  assert.ok(restoredLink, 'silinen bag geri gelmeli');
  assert.equal(restoredLink.type, 'Verifies');
});

test('restore ONCESI otomatik guvenlik kopyasi alinir (islem geri alinabilir)', async () => {
  const { project, sys } = await freshProject('Guvenlik Kopyasi');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Restore oncesi hal' } });

  const res = await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'Baslangica donuluyor',
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.safetySnapshotId, "guvenlik kopyasinin id'si donmeli");

  const safety = await prisma.projectSnapshot.findUnique({ where: { id: res.body.safetySnapshotId } });
  assert.equal(safety.kind, 'safety');
  assert.equal(safety.restoredFromId, snap.id);

  // Guvenlik kopyasi RESTORE ONCESI hali tasir: ona donunce degisiklik geri gelir.
  const undo = await auth(request(app).post(`${snapshotsOf(project.id)}/${safety.id}/restore`)).send({
    reason: 'Geri yuklemeyi geri aliyoruz',
  });
  assert.equal(undo.status, 200);
  const row = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(row.title, 'Restore oncesi hal', 'guvenlik kopyasi islemi geri alabilmeli');
});

test("restore audit log'a kim/ne zaman/gerekce olarak yazilir", async () => {
  const { project } = await freshProject('Restore Audit');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;
  await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'Denetim izi testi',
  });
  const log = await prisma.auditLog.findFirst({
    where: { projectId: project.id, action: 'SNAPSHOT_RESTORE', entityId: snap.id },
  });
  assert.ok(log);
  assert.equal(log.reason, 'Denetim izi testi');
  assert.ok(log.actor, 'kim yaptigi yazilmali');
  assert.match(log.message, /Onay durumu ve kilitler/);
});

test("kilitli (locked) kayit restore'u engellemez; onay durumu da baseline haline doner", async () => {
  const { project, sys } = await freshProject('Kilit Projesi');
  // Baseline aninda kayit ONAYSIZ ve kilitsiz.
  const snap = (await takeSnapshot(project.id, { name: 'Onay oncesi' })).body;
  // Sonra onaylanip kilitlendi.
  await prisma.requirement.update({
    where: { id: sys.id },
    data: { approvalStatus: 'Approved', locked: true, title: 'Onayli hal' },
  });

  const res = await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'Onay oncesi hale donuluyor',
  });
  assert.equal(res.status, 200);
  const row = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(row.locked, false, 'kilit baseline haline donmeli');
  assert.equal(row.approvalStatus, 'Pending');
  assert.equal(row.title, 'Alt');
});

test('restore yalnizca PM tarafindan calistirilabilir (403)', async () => {
  const { project } = await freshProject('Yetki Projesi');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;
  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: (await prisma.user.findUnique({ where: { username: 'member-baseline' } })).id,
    },
  });
  const res = await request(app)
    .post(`${snapshotsOf(project.id)}/${snap.id}/restore`)
    .set('Authorization', `Bearer ${memberToken}`)
    .send({ reason: 'Yetkisiz deneme' });
  assert.equal(res.status, 403);
});

test('restore TEK transaction: gecersiz snapshot icerigi hicbir sey yazmaz', async () => {
  const { project, sys } = await freshProject('Transaction Projesi');
  const snap = (await takeSnapshot(project.id, { name: 'Baslangic' })).body;
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Restore oncesi' } });

  // Snapshot icerigini BOZ: ayni text_id'yi iki satira ver -> @@unique ihlali
  // restore transaction'ini basarisiz kilmali.
  const item = await prisma.snapshotItem.findFirst({
    where: { snapshotId: snap.id, entityType: 'requirement', entityId: sys.id },
  });
  await prisma.snapshotItem.create({
    data: {
      snapshotId: snap.id,
      entityType: 'requirement',
      entityId: '11111111-1111-1111-1111-111111111111',
      data: { ...item.data, id: '11111111-1111-1111-1111-111111111111' },
    },
  });

  const res = await auth(request(app).post(`${snapshotsOf(project.id)}/${snap.id}/restore`)).send({
    reason: 'Bozuk snapshot denemesi',
  });
  assert.ok(res.status >= 400, 'bozuk icerik hata dondurmeli');
  // Proje TUTARSIZ kalmamali: canli kayit restore oncesi halinde durmali.
  const row = await prisma.requirement.findUnique({ where: { id: sys.id } });
  assert.equal(row.title, 'Restore oncesi', 'yarida kalan restore hicbir sey yazmamali');
});

// --- 4) Fark (diff) ---------------------------------------------------------

test('baseline <-> canli farki: eklenen / silinen / degisen kayitlar', async () => {
  const { project, sys, tc } = await freshProject('Diff Canli');
  const snap = (await takeSnapshot(project.id, { name: 'Teslim 1', label: 'v1.0' })).body;

  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Yeni baslik' } });
  const added = await prisma.requirement.create({
    data: { projectId: project.id, text_id: 'REQ-SYS-002', title: 'Eklenen', type: 'System Requirement' },
  });
  await prisma.testCase.delete({ where: { id: tc.id } });

  const res = await auth(request(app).get(`/api/projects/${project.id}/snapshots-diff?from=${snap.id}&to=live`));
  assert.equal(res.status, 200);
  assert.equal(res.body.from.id, snap.id);
  assert.equal(res.body.to.isLive, true);

  const byId = Object.fromEntries(res.body.entries.map((e) => [e.entityId, e]));
  assert.equal(byId[added.id].status, 'added');
  assert.equal(byId[tc.id].status, 'removed');
  assert.equal(byId[sys.id].status, 'changed');
  const titleChange = byId[sys.id].fields.find((f) => f.field === 'title');
  assert.equal(titleChange.from, 'Alt');
  assert.equal(titleChange.to, 'Yeni baslik');
});

test('iki baseline arasi fark alinabilir', async () => {
  const { project, sys } = await freshProject('Diff Iki Baseline');
  const first = (await takeSnapshot(project.id, { name: 'v1', label: 'v1.0', isBaseline: true, reason: 'ilk' })).body;
  await prisma.requirement.update({ where: { id: sys.id }, data: { title: 'Ikinci surum basligi' } });
  const second = (await takeSnapshot(project.id, { name: 'v2', label: 'v2.0', isBaseline: true, reason: 'ikinci' }))
    .body;

  const res = await auth(
    request(app).get(`/api/projects/${project.id}/snapshots-diff?from=${first.id}&to=${second.id}`),
  );
  assert.equal(res.status, 200);
  assert.equal(res.body.summary.requirement.changed, 1);
  assert.equal(res.body.totals.added, 0);
  assert.equal(res.body.totals.removed, 0);
  const entry = res.body.entries.find((e) => e.entityId === sys.id);
  assert.equal(entry.status, 'changed');
  assert.equal(entry.label, 'REQ-SYS-001');
});

test('degisen bag ve SUPHELI (suspect) durumu farkta gorunur', async () => {
  const { project, link } = await freshProject('Diff Suspect');
  const snap = (await takeSnapshot(project.id, { name: 'Teslim 1' })).body;
  await prisma.traceabilityLink.update({ where: { id: link.id }, data: { isSuspect: true } });

  const res = await auth(request(app).get(`/api/projects/${project.id}/snapshots-diff?from=${snap.id}&to=live`));
  const entry = res.body.entries.find((e) => e.entityId === link.id);
  assert.ok(entry, 'bag farkta gorunmeli');
  assert.equal(entry.status, 'changed');
  const suspect = entry.fields.find((f) => f.field === 'isSuspect');
  assert.equal(suspect.from, false);
  assert.equal(suspect.to, true);
  assert.match(entry.label, /Verifies/);
});

test('ayni taraf iki kez secilemez (400)', async () => {
  const { project } = await freshProject('Diff Ayni Taraf');
  const res = await auth(request(app).get(`/api/projects/${project.id}/snapshots-diff?from=live&to=live`));
  assert.equal(res.status, 400);
});

test('degismeyen kayit farkta CHANGED olarak listelenmez', async () => {
  const { project } = await freshProject('Diff Degisiklik Yok');
  const snap = (await takeSnapshot(project.id, { name: 'Teslim 1' })).body;
  const res = await auth(request(app).get(`/api/projects/${project.id}/snapshots-diff?from=${snap.id}&to=live`));
  assert.equal(res.body.totals.added, 0);
  assert.equal(res.body.totals.removed, 0);
  assert.equal(res.body.totals.changed, 0);
  assert.ok(res.body.totals.unchanged > 0);
});
