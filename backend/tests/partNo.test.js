// ============================================================================
//  partNo.test.js — Parca No bicimi + numara uretimi (Issue #135).
//  DB GEREKTIRMEZ: partNo.js bilincli olarak saftir (prisma disaridan gelir),
//  bu yuzden bicim/blok/sira mantigi burada izole olarak dogrulanir.
// ============================================================================
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import {
  DEFAULT_PART_NO_FORMAT,
  blockOf,
  buildPartNo,
  childBlockOf,
  configOf,
  isValidPartNo,
  nextPartNoInBlock,
  nextRootBlock,
  parsePartNoFormat,
  partNoRegex,
  sequenceOf,
} from '../src/partNo.js';

const F = DEFAULT_PART_NO_FORMAT; // "NNN.NN.NNN"

describe('parsePartNoFormat — bicim ayristirma', () => {
  test('rakam gruplarini ve ayiraclari ayirir', () => {
    assert.deepEqual(parsePartNoFormat(F).groups, [3, 2, 3]);
    assert.deepEqual(parsePartNoFormat(F).separators, ['.', '.']);
  });

  test('farkli ayiraclar desteklenir', () => {
    assert.deepEqual(parsePartNoFormat('NN-NNNN').groups, [2, 4]);
    assert.deepEqual(parsePartNoFormat('NNN/NNN').separators, ['/']);
  });

  test('gecersiz bicimler reddedilir', () => {
    for (const bad of ['', '   ', 'NNN', 'ABC.NN', 'NNN..NN', '.NNN.NN', 'NNN.NN.']) {
      assert.throws(() => parsePartNoFormat(bad), /Parca No bicimi|bos olamaz/, `kabul edilmemeliydi: ${bad}`);
    }
  });
});

describe('isValidPartNo / partNoRegex', () => {
  test('bicime uyan deger kabul edilir', () => {
    assert.equal(isValidPartNo('320.00.001', F), true);
    assert.equal(isValidPartNo('340.12.999', F), true);
  });

  test('bicime uymayan deger reddedilir', () => {
    for (const bad of ['320.0.001', '32.00.001', '320-00-001', '320.00.0012', 'GY1', '']) {
      assert.equal(isValidPartNo(bad, F), false, `reddedilmeliydi: ${bad}`);
    }
  });

  test('regex bastan sona sabitlenmistir (kismi eslesme yok)', () => {
    assert.equal(partNoRegex(F).test('x320.00.001'), false);
    assert.equal(partNoRegex(F).test('320.00.001x'), false);
  });
});

describe('blockOf / sequenceOf / buildPartNo', () => {
  test('blok ilk grup, sira son gruptur', () => {
    assert.equal(blockOf('320.00.001', F), '320');
    assert.equal(sequenceOf('320.00.007', F), 7);
  });

  test('bicime uymayan degerde null doner', () => {
    assert.equal(blockOf('GY1', F), null);
    assert.equal(sequenceOf('GY1', F), null);
  });

  test('blok + sira -> tam numara (ara gruplar sifirlanir)', () => {
    assert.equal(buildPartNo('320', 1, F), '320.00.001');
    assert.equal(buildPartNo('340', 3, F), '340.00.003');
    assert.equal(buildPartNo('7', 3, F), '007.00.003'); // blok sola sifir doldurulur
  });

  test('sigmayan blok veya sira 409 ile reddedilir', () => {
    assert.throws(
      () => buildPartNo('3200', 1, F),
      (e) => e.status === 409,
    );
    assert.throws(
      () => buildPartNo('320', 1000, F),
      (e) => e.status === 409,
    );
  });
});

describe('nextRootBlock — kok dallarin blok araliklari', () => {
  const cfg = { format: F, blockStep: 10 };

  test('ilk dal ilk adimi alir', () => {
    assert.equal(nextRootBlock([], cfg), '010');
  });

  test('dolu bloklar atlanir', () => {
    assert.equal(nextRootBlock(['010', '020'], cfg), '030');
    assert.equal(nextRootBlock(['320', '010'], cfg), '020');
  });

  test('bos blok kalmayinca 409', () => {
    // NNN + adim 10 => 010..990 arasi 99 blok; hepsi doluysa yer kalmaz.
    const full = Array.from({ length: 99 }, (_, i) => String((i + 1) * 10));
    assert.throws(
      () => nextRootBlock(full, cfg),
      (e) => e.status === 409,
    );
  });
});

describe('nextPartNoInBlock — blok ici sira + kara liste', () => {
  test('bos blokta 001 ile baslar', () => {
    assert.equal(nextPartNoInBlock('320', new Set(), F), '320.00.001');
  });

  test('SILINEN numara yeniden kullanilmaz (kara liste)', () => {
    // 320.00.001 ve 320.00.002 silinmis olsa bile sira 003'ten devam eder.
    const used = new Set(['320.00.001', '320.00.002']);
    assert.equal(nextPartNoInBlock('320', used, F), '320.00.003');
  });

  test('aradaki bosluklar da atlanmaz — ilk GERCEKTEN bos numara verilir', () => {
    const used = new Set(['320.00.001', '320.00.003']);
    assert.equal(nextPartNoInBlock('320', used, F), '320.00.002');
  });

  test('farkli bloklar birbirini etkilemez (AMTB/GY1 != STC/GY1)', () => {
    const used = new Set(['320.00.001', '320.00.002']);
    assert.equal(nextPartNoInBlock('340', used, F), '340.00.001');
  });
});

describe('childBlockOf — dalin cocuklarina verdigi blok', () => {
  test('elle verilen blok onceliklidir', () => {
    assert.equal(childBlockOf({ partNo: '010.00.001', partNoBlock: '320' }, F), '320');
  });

  test('blok verilmemisse dugumun kendi blogu kullanilir', () => {
    assert.equal(childBlockOf({ partNo: '340.00.002', partNoBlock: null }, F), '340');
  });

  test('ust yoksa null', () => {
    assert.equal(childBlockOf(null, F), null);
  });
});

describe('configOf — proje bazli yapilandirma', () => {
  test('bos proje ayarinda varsayilanlar kullanilir', () => {
    assert.deepEqual(configOf({}), { format: F, blockStep: 10 });
  });

  test('proje ayari okunur', () => {
    assert.deepEqual(configOf({ partNoFormat: 'NN-NNNN', partNoBlockStep: 5 }), {
      format: 'NN-NNNN',
      blockStep: 5,
    });
  });

  test('gecersiz bicim configOf icinde yakalanir', () => {
    assert.throws(() => configOf({ partNoFormat: 'ABC' }), /Parca No bicimi/);
  });
});
