// ============================================================================
//  issue138-components.test.js — ELLE tanimlanan bilesenler (Issue #138).
//
//  Kabul kriterleri (issue metninden):
//    * Yepyeni (hic gereksinimi olmayan) projede bilesen olusturulabilir ve
//      kalicidir — gereksinim GEREKMEZ.
//    * Arka arkaya birden fazla bilesen eklenebilir; SIRA kullanicinin
//      verdigi gibi kalir (ad/numaraya gore yeniden siralanmaz).
//    * Bilesen adi duzenlenebilir, bilesen silinebilir; bagli gereksinim ya da
//      alt bilesen varsa silme ONAY (force) ister ve gereksinim SILINMEZ.
//    * Bir bilesenin altina alt bilesen eklenebilir (elle urun kirilimi).
//    * Gereksinimler SONRADAN bilesene baglanabilir.
//    * Parca No elle verilebilir; otomatik atama yalnizca ONERIDIR.
//    * Mevcut projeler bozulmaz: PBS'ten turetilen bilesenler tek seferlik
//      ice aktarmayla kalici kayda cevrilir (idempotent).
// ============================================================================
import { resetDb } from './_setup.js';
import assert from 'node:assert/strict';
import { before, after, test } from 'node:test';
import request from 'supertest';

const { default: app } = await import('../src/server.js');
const { PrismaClient } = await import('@prisma/client');
const prisma = new PrismaClient();

let proj;
let pmToken;

const auth = (r) => r.set('Authorization', `Bearer ${pmToken}`);
const base = () => `/api/projects/${proj.id}`;

const addComponent = async (body) => {
  const res = await auth(request(app).post(`${base()}/components`)).send(body);
  assert.equal(res.status, 201, `bilesen olusturulamadi: ${JSON.stringify(res.body)}`);
  return res.body;
};

const listComponents = async () => {
  const res = await auth(request(app).get(`${base()}/components`));
  assert.equal(res.status, 200);
  return res.body;
};

before(async () => {
  resetDb();

  const { hashPassword, signToken } = await import('../src/auth.js');
  const user = await prisma.user.create({
    data: {
      username: 'pm-components',
      passwordHash: await hashPassword('pm-pass'),
      name: 'Bilesen PM',
      role: 'Proje Yöneticisi',
      clearanceLevel: 5,
    },
  });
  pmToken = signToken({ userId: user.id, roleKey: 'pm', clearanceLevel: 5 });

  proj = await prisma.project.create({ data: { name: 'Bilesen Projesi', description: 'Issue #138' } });
});

after(async () => {
  await prisma.$disconnect();
});

// --- Bos projede bilesen olusturma -----------------------------------------

test('hic gereksinimi olmayan projede bilesen olusturulur ve kalicidir', async () => {
  const reqCount = await prisma.requirement.count({ where: { projectId: proj.id } });
  assert.equal(reqCount, 0, 'on kosul: proje bos olmali');

  const comp = await addComponent({ name: 'Su Pompasi Unitesi' });
  assert.equal(comp.name, 'Su Pompasi Unitesi');
  assert.equal(comp.parentId, null);

  // "Sayfa yenilendiginde bilesen durur": ayri bir istekte de gorunur.
  const rows = await listComponents();
  assert.ok(rows.some((c) => c.id === comp.id));
  assert.equal(rows.find((c) => c.id === comp.id).requirementCount, 0);
});

test('adsiz bilesen reddedilir', async () => {
  const res = await auth(request(app).post(`${base()}/components`)).send({ name: '   ' });
  assert.equal(res.status, 400);
});

test('arka arkaya eklenen bilesenler EKLENME sirasini korur', async () => {
  const names = ['Zeta Modulu', 'Alfa Modulu', 'Beta Modulu'];
  const created = [];
  for (const name of names) created.push(await addComponent({ name }));

  const roots = (await listComponents()).filter((c) => c.parentId === null);
  const order = roots.map((c) => c.name).filter((n) => names.includes(n));
  // Alfabetik degil, KULLANICININ verdigi sira.
  assert.deepEqual(order, names);
  assert.ok(created.every((c) => c.id));
});

test('siralama degistirilebilir ve kalici olur', async () => {
  const roots = (await listComponents()).filter((c) => c.parentId === null);
  const reversed = [...roots].reverse().map((c) => c.id);
  const res = await auth(request(app).post(`${base()}/components/reorder`)).send({ parentId: null, ids: reversed });
  assert.equal(res.status, 200);

  const after = (await listComponents()).filter((c) => c.parentId === null).map((c) => c.id);
  assert.deepEqual(after, reversed);
});

// --- Kirilim (alt bilesen) --------------------------------------------------

test('bir bilesenin altina alt bilesen eklenebilir', async () => {
  const parent = await addComponent({ name: 'AMTB' });
  const child = await addComponent({ name: 'Donanim', parentId: parent.id });
  const grandChild = await addComponent({ name: 'Kentel', parentId: child.id });

  assert.equal(child.parentId, parent.id);
  assert.equal(grandChild.parentId, child.id);

  const rows = await listComponents();
  assert.equal(rows.find((c) => c.id === parent.id).childCount, 1);
});

test('bilesen kendi alt kiriliminin altina tasinamaz (dongu korumasi)', async () => {
  const top = await addComponent({ name: 'Dongu Ust' });
  const mid = await addComponent({ name: 'Dongu Orta', parentId: top.id });
  const res = await auth(request(app).patch(`${base()}/components/${top.id}`)).send({ parentId: mid.id });
  assert.equal(res.status, 400);
});

// --- Duzenleme --------------------------------------------------------------

test('bilesen adi duzenlenebilir', async () => {
  const comp = await addComponent({ name: 'Eski Ad' });
  const res = await auth(request(app).patch(`${base()}/components/${comp.id}`)).send({ name: 'Yeni Ad' });
  assert.equal(res.status, 200);
  assert.equal(res.body.name, 'Yeni Ad');

  const stored = await prisma.component.findUnique({ where: { id: comp.id } });
  assert.equal(stored.name, 'Yeni Ad');
});

// --- Parca No: elle > otomatik ---------------------------------------------

test('Parca No verilmezse bilesen NUMARASIZ olusur (otomatik atama zorunlu degil)', async () => {
  const comp = await addComponent({ name: 'Numarasiz Bilesen' });
  assert.equal(comp.partNo, null);
});

test('Parca No elle verilebilir; oneri uc noktasi bos numara dondurur', async () => {
  const suggestion = await auth(request(app).get(`${base()}/components/suggest-part-no`));
  assert.equal(suggestion.status, 200);
  assert.match(suggestion.body.partNo, /^\d{3}\.\d{2}\.\d{3}$/);

  const comp = await addComponent({ name: 'Numarali Bilesen', partNo: '910.00.007' });
  assert.equal(comp.partNo, '910.00.007');
});

test('cakisan Parca No reddedilir ve HICBIR SEY yazilmaz', async () => {
  const before = await prisma.component.count({ where: { projectId: proj.id } });
  const res = await auth(request(app).post(`${base()}/components`)).send({
    name: 'Cakisan',
    partNo: '910.00.007',
  });
  assert.equal(res.status, 409);
  assert.equal(await prisma.component.count({ where: { projectId: proj.id } }), before);
});

test('bicime uymayan Parca No reddedilir', async () => {
  const res = await auth(request(app).post(`${base()}/components`)).send({ name: 'Bozuk', partNo: 'ABC' });
  assert.equal(res.status, 400);
});

test('autoPartNo istenirse numara ONERILIR ve yazilir', async () => {
  const comp = await addComponent({ name: 'Otomatik Numarali', autoPartNo: true });
  assert.match(comp.partNo, /^\d{3}\.\d{2}\.\d{3}$/);
});

// --- Gereksinim bagi --------------------------------------------------------

test('gereksinimler SONRADAN bilesene baglanabilir', async () => {
  const comp = await addComponent({ name: 'Bagli Bilesen' });
  const reqRes = await auth(request(app).post(`${base()}/requirements`)).send({
    title: 'Pompa basinci',
    type: 'System Requirement',
  });
  assert.equal(reqRes.status, 201);
  assert.equal(reqRes.body.componentId, null, 'gereksinim bagsiz dogar');

  const link = await auth(request(app).post(`${base()}/components/link-requirements`)).send({
    componentId: comp.id,
    requirementIds: [reqRes.body.id],
  });
  assert.equal(link.status, 200);
  assert.equal(link.body.count, 1);

  const stored = await prisma.requirement.findUnique({ where: { id: reqRes.body.id } });
  assert.equal(stored.componentId, comp.id);

  // Bag kaldirilabilir.
  const unlink = await auth(request(app).post(`${base()}/components/link-requirements`)).send({
    componentId: null,
    requirementIds: [reqRes.body.id],
  });
  assert.equal(unlink.status, 200);
  assert.equal((await prisma.requirement.findUnique({ where: { id: reqRes.body.id } })).componentId, null);
});

test('gereksinim olustururken bilesen bagi verilebilir', async () => {
  const comp = await addComponent({ name: 'Dogumda Bagli' });
  const res = await auth(request(app).post(`${base()}/requirements`)).send({
    title: 'Dogumda bagli gereksinim',
    type: 'System Requirement',
    componentId: comp.id,
  });
  assert.equal(res.status, 201);
  assert.equal(res.body.componentId, comp.id);
});

// --- Silme ------------------------------------------------------------------

test('bos bilesen gerekce ile silinir', async () => {
  const comp = await addComponent({ name: 'Silinecek' });
  const res = await auth(request(app).delete(`${base()}/components/${comp.id}`)).send({
    reason: 'Artik kullanilmiyor',
  });
  assert.equal(res.status, 200);
  assert.equal(await prisma.component.findUnique({ where: { id: comp.id } }), null);
});

test('gerekcesiz silme reddedilir', async () => {
  const comp = await addComponent({ name: 'Gerekcesiz' });
  const res = await auth(request(app).delete(`${base()}/components/${comp.id}`)).send({});
  assert.equal(res.status, 400);
  assert.ok(await prisma.component.findUnique({ where: { id: comp.id } }));
});

test('bagli gereksinimi olan bilesen UYARI verir; force ile silinince gereksinim KALIR', async () => {
  const comp = await addComponent({ name: 'Bagli Gereksinimli' });
  const reqRes = await auth(request(app).post(`${base()}/requirements`)).send({
    title: 'Bagi kalkacak gereksinim',
    type: 'System Requirement',
    componentId: comp.id,
  });
  assert.equal(reqRes.status, 201);

  const impact = await auth(request(app).get(`${base()}/components/${comp.id}/delete-impact`));
  assert.equal(impact.status, 200);
  assert.equal(impact.body.requirementCount, 1);

  const refused = await auth(request(app).delete(`${base()}/components/${comp.id}`)).send({
    reason: 'Deneme',
  });
  assert.equal(refused.status, 409);
  assert.ok(await prisma.component.findUnique({ where: { id: comp.id } }), 'onaysiz silinmemeli');

  const forced = await auth(request(app).delete(`${base()}/components/${comp.id}`)).send({
    reason: 'Urun kirilimi degisti',
    force: true,
  });
  assert.equal(forced.status, 200);
  const survivor = await prisma.requirement.findUnique({ where: { id: reqRes.body.id } });
  assert.ok(survivor, 'gereksinim SILINMEMELI');
  assert.equal(survivor.componentId, null, 'yalnizca bag bosa duser');
});

test('alt bileseni olan bilesen force ile silinince alt kirilim da silinir', async () => {
  const parent = await addComponent({ name: 'Ust (silinecek)' });
  const child = await addComponent({ name: 'Alt (silinecek)', parentId: parent.id });

  const refused = await auth(request(app).delete(`${base()}/components/${parent.id}`)).send({ reason: 'Deneme' });
  assert.equal(refused.status, 409);

  const forced = await auth(request(app).delete(`${base()}/components/${parent.id}`)).send({
    reason: 'Kirilim kaldirildi',
    force: true,
  });
  assert.equal(forced.status, 200);
  assert.equal(await prisma.component.findUnique({ where: { id: child.id } }), null);
});

// --- Proje izolasyonu (IDOR) ------------------------------------------------

test('baska projenin bileseni bu proje uzerinden goruntulenemez', async () => {
  const other = await prisma.project.create({ data: { name: 'Baska Proje' } });
  const foreign = await prisma.component.create({ data: { projectId: other.id, name: 'Yabanci' } });
  const res = await auth(request(app).patch(`${base()}/components/${foreign.id}`)).send({ name: 'Ele gecirme' });
  assert.equal(res.status, 404);
  assert.equal((await prisma.component.findUnique({ where: { id: foreign.id } })).name, 'Yabanci');
});

// --- Gecis: PBS'ten ice aktarma --------------------------------------------

test('PBS agacindan ice aktarma bilesenleri ve gereksinim baglarini uretir (idempotent)', async () => {
  const pbsProject = await prisma.project.create({ data: { name: 'PBS Projesi' } });
  const pbsBase = `/api/projects/${pbsProject.id}`;
  const addNode = async (title, type, parentId) => {
    const res = await auth(request(app).post(`${pbsBase}/requirements`)).send({ title, type, parentId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    return res.body;
  };
  const sistem = await addNode('Sistem', 'User Requirement', null);
  const pompa = await addNode('Su Pompasi Unitesi', 'System Requirement', sistem.id);
  await addNode('Pompa basinci', 'Hardware Requirement', pompa.id);

  const res = await auth(request(app).post(`${pbsBase}/components/import-from-pbs`)).send({});
  assert.equal(res.status, 200);
  // Alt kirilimi olan dugumler: Sistem + Su Pompasi Unitesi
  assert.equal(res.body.created, 2);
  assert.ok(res.body.linked >= 3, `beklenen >=3 bag, gelen: ${res.body.linked}`);

  const imported = await prisma.component.findMany({ where: { projectId: pbsProject.id } });
  const names = imported.map((c) => c.name).sort();
  assert.deepEqual(names, ['Sistem', 'Su Pompasi Unitesi']);
  // Yaprak gereksinim, kendisini iceren EN YAKIN bilesene baglanir.
  const leaf = await prisma.requirement.findFirst({ where: { projectId: pbsProject.id, title: 'Pompa basinci' } });
  const pump = imported.find((c) => c.name === 'Su Pompasi Unitesi');
  assert.equal(leaf.componentId, pump.id);

  // Ikinci calistirma KOPYA uretmez.
  const again = await auth(request(app).post(`${pbsBase}/components/import-from-pbs`)).send({});
  assert.equal(again.status, 200);
  assert.equal(again.body.created, 0);
  assert.equal(await prisma.component.count({ where: { projectId: pbsProject.id } }), 2);
});
