import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { validateXlsxArchive, XlsxSecurityError } from '../src/features/members/safeXlsxGuard.ts';
import { CompressionStream } from 'node:stream/web';

/** Helper to compress a byte buffer using raw deflate */
async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream('deflate-raw');
  const writer = cs.writable.getWriter();
  writer.write(data);
  writer.close();
  const reader = cs.readable.getReader();
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  return Buffer.concat(chunks);
}

/** Helper to build a minimal synthetic ZIP buffer */
async function createSyntheticZip(
  entries: Array<{
    name: string;
    content: Uint8Array;
    compress?: boolean;
    forceCompressedSize?: number;
    forceUncompressedSize?: number;
    overrideCompressionMethod?: number;
  }>,
  options: {
    addZip64Locator?: boolean;
    duplicateCentralDirectoryEntry?: boolean;
    corruptMagic?: boolean;
  } = {}
): Promise<ArrayBuffer> {
  const localHeaders: Uint8Array[] = [];
  const cdEntries: Uint8Array[] = [];
  let currentOffset = 0;

  for (const entry of entries) {
    const nameBytes = Buffer.from(entry.name, 'utf-8');
    const compress = entry.compress ?? true;
    const compressionMethod = entry.overrideCompressionMethod ?? (compress ? 8 : 0);

    const payload = compress ? await deflateRaw(entry.content) : entry.content;
    const compressedSize = entry.forceCompressedSize ?? payload.byteLength;
    const uncompressedSize = entry.forceUncompressedSize ?? entry.content.byteLength;

    // Local Header
    const local = Buffer.alloc(30 + nameBytes.length + payload.length);
    local.writeUInt32LE(options.corruptMagic ? 0x00000000 : 0x04034b50, 0); // PK\x03\x04
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(compressionMethod, 8);
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(0x12345678, 14); // crc32 dummy
    local.writeUInt32LE(compressedSize, 18);
    local.writeUInt32LE(uncompressedSize, 22);
    local.writeUInt16LE(nameBytes.length, 26);
    local.writeUInt16LE(0, 28); // extra field len
    nameBytes.copy(local, 30);
    Buffer.from(payload).copy(local, 30 + nameBytes.length);

    localHeaders.push(local);

    // Central Directory Entry
    const cd = Buffer.alloc(46 + nameBytes.length);
    cd.writeUInt32LE(0x02014b50, 0); // PK\x01\x02
    cd.writeUInt16LE(20, 4); // version made
    cd.writeUInt16LE(20, 6); // version needed
    cd.writeUInt16LE(0, 8); // flags
    cd.writeUInt16LE(compressionMethod, 10);
    cd.writeUInt16LE(0, 12); // time
    cd.writeUInt16LE(0, 14); // date
    cd.writeUInt32LE(0x12345678, 16); // crc32
    cd.writeUInt32LE(compressedSize, 20);
    cd.writeUInt32LE(uncompressedSize, 24);
    cd.writeUInt16LE(nameBytes.length, 28);
    cd.writeUInt16LE(0, 30); // extra len
    cd.writeUInt16LE(0, 32); // comment len
    cd.writeUInt16LE(0, 34); // disk num
    cd.writeUInt16LE(0, 36); // internal attr
    cd.writeUInt32LE(0, 38); // external attr
    cd.writeUInt32LE(currentOffset, 42); // local header offset
    nameBytes.copy(cd, 46);

    cdEntries.push(cd);
    if (options.duplicateCentralDirectoryEntry) {
      cdEntries.push(Buffer.from(cd));
    }

    currentOffset += local.length;
  }

  const allLocals = Buffer.concat(localHeaders);
  const allCd = Buffer.concat(cdEntries);

  // EOCD
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // PK\x05\x06
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  const totalEntries = cdEntries.length;
  eocd.writeUInt16LE(totalEntries, 8);
  eocd.writeUInt16LE(totalEntries, 10);
  eocd.writeUInt32LE(allCd.length, 12);
  eocd.writeUInt32LE(allLocals.length, 16);
  eocd.writeUInt16LE(0, 20); // comment len

  let finalBuffer: Buffer;
  if (options.addZip64Locator) {
    // Inject ZIP64 Locator right before EOCD
    const zip64Loc = Buffer.alloc(20);
    zip64Loc.writeUInt32LE(0x07064b50, 0); // PK\x06\x07
    finalBuffer = Buffer.concat([allLocals, allCd, zip64Loc, eocd]);
  } else {
    finalBuffer = Buffer.concat([allLocals, allCd, eocd]);
  }

  const ab = new ArrayBuffer(finalBuffer.byteLength);
  new Uint8Array(ab).set(finalBuffer);
  return ab;
}

test('Spreadsheet Security Guard (CVE-2026-78206 & Archive Defense)', async (t) => {
  await t.test('legitimate ExcelJS workbook passes validation', async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('الأعضاء');
    ws.addRow(['الاسم الكامل', 'البريد الإلكتروني']);
    ws.addRow(['أحمد علي', 'ahmed@example.com']);
    const buffer = await wb.xlsx.writeBuffer();

    const ab = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
    await assert.doesNotReject(async () => {
      await validateXlsxArchive(ab);
    });
  });

  await t.test('rejects non-ZIP file (invalid magic bytes)', async () => {
    const corrupt = new ArrayBuffer(100);
    new Uint8Array(corrupt).fill(0x41); // 'AAAA...'

    await assert.rejects(
      async () => validateXlsxArchive(corrupt),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'INVALID_MAGIC_BYTES');
        return true;
      }
    );
  });

  await t.test('rejects truncated archive (<30 bytes)', async () => {
    const tiny = new ArrayBuffer(20);
    await assert.rejects(
      async () => validateXlsxArchive(tiny),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'FILE_TOO_SMALL');
        return true;
      }
    );
  });

  await t.test('rejects archive with ZIP64 locator', async () => {
    const zipWithZip64 = await createSyntheticZip(
      [{ name: 'xl/workbook.xml', content: Buffer.from('<xml/>') }],
      { addZip64Locator: true }
    );

    await assert.rejects(
      async () => validateXlsxArchive(zipWithZip64),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'ZIP64_DISALLOWED');
        return true;
      }
    );
  });

  await t.test('rejects path traversal in entry name', async () => {
    const maliciousZip = await createSyntheticZip([
      { name: '../etc/passwd', content: Buffer.from('root:x:0:0') },
    ]);

    await assert.rejects(
      async () => validateXlsxArchive(maliciousZip),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'PATH_TRAVERSAL');
        return true;
      }
    );
  });

  await t.test('rejects duplicate entry names (collision attack)', async () => {
    const maliciousZip = await createSyntheticZip(
      [{ name: 'xl/workbook.xml', content: Buffer.from('<xml/>') }],
      { duplicateCentralDirectoryEntry: true }
    );

    await assert.rejects(
      async () => validateXlsxArchive(maliciousZip),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'DUPLICATE_ENTRY_NAME');
        return true;
      }
    );
  });

  await t.test('rejects excessive entry count (> 50)', async () => {
    const entries = Array.from({ length: 55 }, (_, i) => ({
      name: `xl/worksheets/sheet${i + 1}.xml`,
      content: Buffer.from('<sheet/>'),
    }));
    const maliciousZip = await createSyntheticZip(entries);

    await assert.rejects(
      async () => validateXlsxArchive(maliciousZip),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'ENTRY_COUNT_EXCEEDED');
        return true;
      }
    );
  });

  await t.test('rejects unsupported compression methods (e.g. method 9 / bzip2)', async () => {
    const maliciousZip = await createSyntheticZip([
      {
        name: 'xl/workbook.xml',
        content: Buffer.from('<xml/>'),
        compress: false,
        overrideCompressionMethod: 9,
      },
    ]);

    await assert.rejects(
      async () => validateXlsxArchive(maliciousZip),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.strictEqual((err as XlsxSecurityError).code, 'UNSUPPORTED_COMPRESSION_METHOD');
        return true;
      }
    );
  });

  await t.test('rejects data amplification / Zip Bomb (ratio > 40:1)', async () => {
    // 100,000 bytes of repetitive 'A's compress down to ~100 bytes (ratio ~1000:1)
    const highlyCompressible = Buffer.alloc(100_000, 0x41);
    const bombZip = await createSyntheticZip([
      {
        name: 'xl/sharedStrings.xml',
        content: highlyCompressible,
        compress: true,
      },
    ]);

    await assert.rejects(
      async () => validateXlsxArchive(bombZip),
      (err: Error) => {
        assert.ok(err instanceof XlsxSecurityError);
        assert.ok(
          err.message.includes('Zip Bomb') || (err as XlsxSecurityError).code.includes('RATIO'),
          `Expected Zip Bomb or ratio error, got: ${err.message}`
        );
        return true;
      }
    );
  });
});
