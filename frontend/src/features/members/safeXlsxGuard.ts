/**
 * ============================================================================
 * Safe XLSX Decompression Guard (CWE-409 / CVE-2026-78206 Mitigation)
 * ============================================================================
 * Defense-in-depth pre-decompression validation for Excel OpenXML (.xlsx) files.
 *
 * Prevents:
 * 1. Data amplification / Zip Bombs (excessive uncompressed size or ratio).
 * 2. ZIP64 exploitation and integer overflow in 32-bit archive parsers.
 * 3. Central Directory vs Local File Header inconsistency attacks.
 * 4. Path traversal / entry collision attacks in archive streams.
 * 5. Event loop exhaustion / CPU DoS via strict processing deadlines.
 *
 * Validates actual decompressed bytes using streaming DecompressionStream
 * before passing the buffer to higher-level workbook parsers (e.g. ExcelJS).
 */

export const XLSX_LIMITS = {
  /** Maximum uploaded raw file size: 5 MB */
  MAX_FILE_SIZE_BYTES: 5 * 1024 * 1024,
  /** Minimum valid ZIP file size (Local Header + EOCD minimum bytes) */
  MIN_FILE_SIZE_BYTES: 30,
  /** Maximum total decompressed size across all entries: 15 MB */
  MAX_TOTAL_UNCOMPRESSED_BYTES: 15 * 1024 * 1024,
  /** Maximum decompressed size for any single internal entry: 8 MB */
  MAX_ENTRY_UNCOMPRESSED_BYTES: 8 * 1024 * 1024,
  /** Maximum allowed internal ZIP entries (legitimate XLSX files contain ~10-25 files) */
  MAX_ZIP_ENTRIES: 50,
  /** Maximum allowed compression ratio (decompressed / compressed). Legitimate XML rarely exceeds 15:1 */
  MAX_COMPRESSION_RATIO: 40,
  /** Processing deadline in milliseconds to prevent CPU exhaustion */
  MAX_PROCESSING_TIME_MS: 3000,
} as const;

// Standard ZIP magic constants
const SIGNATURE_LOCAL_FILE_HEADER = 0x04034b50; // PK\x03\x04
const SIGNATURE_CENTRAL_DIRECTORY = 0x02014b50; // PK\x01\x02
const SIGNATURE_EOCD = 0x06054b50; // PK\x05\x06
const SIGNATURE_ZIP64_LOCATOR = 0x07064b50; // PK\x06\x07

export class XlsxSecurityError extends Error {
  readonly code: string;

  constructor(message: string, code: string) {
    super(message);
    this.code = code;
    this.name = 'XlsxSecurityError';
  }
}

interface ZipEntryMetadata {
  name: string;
  compressionMethod: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
}

/**
 * Searches for the End of Central Directory (EOCD) record in the archive.
 * EOCD is located within the last 65557 bytes (22 bytes min size + 65535 max comment length).
 */
function findEocdOffset(view: DataView): number {
  const fileLength = view.byteLength;
  const searchStart = Math.max(0, fileLength - 65557);

  for (let offset = fileLength - 22; offset >= searchStart; offset--) {
    if (view.getUint32(offset, true) === SIGNATURE_EOCD) {
      return offset;
    }
  }
  return -1;
}

/**
 * Validates that an ArrayBuffer contains a safe, legitimate OpenXML (.xlsx) archive.
 * Throws XlsxSecurityError if any decompression bomb, malformed header, or limit violation is detected.
 */
export async function validateXlsxArchive(buffer: ArrayBuffer): Promise<void> {
  const startTime = Date.now();

  // 1. Buffer Envelope Check
  if (!buffer || !(buffer instanceof ArrayBuffer)) {
    throw new XlsxSecurityError('بيانات الملف غير صحيحة.', 'INVALID_BUFFER');
  }

  if (buffer.byteLength < XLSX_LIMITS.MIN_FILE_SIZE_BYTES) {
    throw new XlsxSecurityError('حجم الملف صغير جدًا ولا يمكن أن يكون ملف Excel صحيحًا.', 'FILE_TOO_SMALL');
  }

  if (buffer.byteLength > XLSX_LIMITS.MAX_FILE_SIZE_BYTES) {
    throw new XlsxSecurityError(
      `حجم الملف (${(buffer.byteLength / (1024 * 1024)).toFixed(1)} ميجابايت) يتجاوز الحد الأقصى المسموح (5 ميجابايت).`,
      'FILE_TOO_LARGE'
    );
  }

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // 2. Magic Bytes Check: Must start with PK\x03\x04
  if (view.getUint32(0, true) !== SIGNATURE_LOCAL_FILE_HEADER) {
    throw new XlsxSecurityError('الملف ليس بصيغة Excel (OpenXML / ZIP) صالحة.', 'INVALID_MAGIC_BYTES');
  }

  // 3. Locate and inspect End of Central Directory (EOCD)
  const eocdOffset = findEocdOffset(view);
  if (eocdOffset === -1) {
    throw new XlsxSecurityError('هيكل أرشيف Excel تالف (تعذر العثور على سجل نهاية الفهرس EOCD).', 'MALFORMED_EOCD');
  }

  // Check for ZIP64 presence (Locator or 64-bit EOCD)
  if (eocdOffset >= 20) {
    const potentialZip64Locator = view.getUint32(eocdOffset - 20, true);
    if (potentialZip64Locator === SIGNATURE_ZIP64_LOCATOR) {
      throw new XlsxSecurityError('صيغة ZIP64 محظورة لأسباب أمنية.', 'ZIP64_DISALLOWED');
    }
  }

  const diskNumber = view.getUint16(eocdOffset + 4, true);
  const startDisk = view.getUint16(eocdOffset + 6, true);
  const totalEntriesDisk = view.getUint16(eocdOffset + 8, true);
  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  // Multi-disk archives are invalid for single xlsx files
  if (diskNumber !== 0 || startDisk !== 0 || totalEntriesDisk !== totalEntries) {
    throw new XlsxSecurityError('أرشيفات ZIP المقسمة على عدة أقراص غير مدعومة.', 'MULTI_DISK_DISALLOWED');
  }

  // Check for ZIP64 magic indicator values
  if (totalEntries === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) {
    throw new XlsxSecurityError('صيغة ZIP64 محظورة لأسباب أمنية.', 'ZIP64_INDICATOR_DETECTED');
  }

  // 4. Entry Count Limit
  if (totalEntries > XLSX_LIMITS.MAX_ZIP_ENTRIES) {
    throw new XlsxSecurityError(
      `عدد الملفات داخل أرشيف Excel (${totalEntries}) يتجاوز الحد الآمن المسموح به (${XLSX_LIMITS.MAX_ZIP_ENTRIES}).`,
      'ENTRY_COUNT_EXCEEDED'
    );
  }

  if (cdOffset + cdSize > buffer.byteLength) {
    throw new XlsxSecurityError('هيكل الفهرس المركزي يتجاوز نهاية الملف.', 'CD_OUT_OF_BOUNDS');
  }

  // 5. Traverse Central Directory Entries
  const entries: ZipEntryMetadata[] = [];
  const seenPaths = new Set<string>();
  let currentCdOffset = cdOffset;
  let declaredTotalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (currentCdOffset + 46 > buffer.byteLength) {
      throw new XlsxSecurityError('فهرس الملفات مبتور قبل نهايته.', 'CD_TRUNCATED');
    }

    const cdSig = view.getUint32(currentCdOffset, true);
    if (cdSig !== SIGNATURE_CENTRAL_DIRECTORY) {
      throw new XlsxSecurityError(`توقيع غير صالح في الفهرس المركزي عند الإدخال رقم ${i + 1}.`, 'CD_INVALID_SIGNATURE');
    }

    const compressionMethod = view.getUint16(currentCdOffset + 10, true);
    const compressedSize = view.getUint32(currentCdOffset + 20, true);
    const uncompressedSize = view.getUint32(currentCdOffset + 24, true);
    const nameLength = view.getUint16(currentCdOffset + 28, true);
    const extraLength = view.getUint16(currentCdOffset + 30, true);
    const commentLength = view.getUint16(currentCdOffset + 32, true);
    const localHeaderOffset = view.getUint32(currentCdOffset + 42, true);

    const nameOffset = currentCdOffset + 46;
    if (nameOffset + nameLength > buffer.byteLength) {
      throw new XlsxSecurityError('اسم الملف داخل الأرشيف مبتور.', 'ENTRY_NAME_TRUNCATED');
    }

    const nameBytes = bytes.subarray(nameOffset, nameOffset + nameLength);
    const name = new TextDecoder('utf-8', { fatal: false }).decode(nameBytes).replace(/\\/g, '/');

    // Security Checks on Entry Name
    if (name.includes('..') || name.startsWith('/') || name.includes('\0')) {
      throw new XlsxSecurityError(`مسار غير آمن في الأرشيف: "${name}".`, 'PATH_TRAVERSAL');
    }

    const normalizedPath = name.toLowerCase();
    if (seenPaths.has(normalizedPath)) {
      throw new XlsxSecurityError(`تكرار مسارات متطابقة داخل الأرشيف: "${name}".`, 'DUPLICATE_ENTRY_NAME');
    }
    seenPaths.add(normalizedPath);

    // Validate compression method: 0 = Stored (no compression), 8 = Deflate
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new XlsxSecurityError(
        `طريقة ضغط غير مدعومة (${compressionMethod}) في الملف "${name}". المسموح فقط Deflate أو بدون ضغط.`,
        'UNSUPPORTED_COMPRESSION_METHOD'
      );
    }

    // Declared size checks
    if (uncompressedSize > XLSX_LIMITS.MAX_ENTRY_UNCOMPRESSED_BYTES) {
      throw new XlsxSecurityError(
        `الحجم المعلن للملف "${name}" (${(uncompressedSize / (1024 * 1024)).toFixed(1)}MB) يتجاوز الحد الأقصى المسموح.`,
        'ENTRY_DECLARED_SIZE_EXCEEDED'
      );
    }

    declaredTotalUncompressed += uncompressedSize;
    if (declaredTotalUncompressed > XLSX_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
      throw new XlsxSecurityError(
        'إجمالي الحجم غير المضغوط المعلن للأرشيف يتجاوز الحد الأقصى المسموح (15 ميجابايت).',
        'TOTAL_DECLARED_SIZE_EXCEEDED'
      );
    }

    // Declared compression ratio check
    if (compressionMethod === 8 && compressedSize > 0) {
      const declaredRatio = uncompressedSize / compressedSize;
      if (declaredRatio > XLSX_LIMITS.MAX_COMPRESSION_RATIO) {
        throw new XlsxSecurityError(
          `نسبة ضغط معلنة غير طبيعية (${declaredRatio.toFixed(1)}:1) في الملف "${name}". اشتباه في هجوم تضخيم البيانات.`,
          'DECLARED_COMPRESSION_RATIO_EXCEEDED'
        );
      }
    }

    entries.push({
      name,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
    });

    currentCdOffset += 46 + nameLength + extraLength + commentLength;
  }

  // 6. Cross-Validate Local File Headers & Perform Active Stream Decompression Verification
  let actualTotalDecompressed = 0;

  for (const entry of entries) {
    if (Date.now() - startTime > XLSX_LIMITS.MAX_PROCESSING_TIME_MS) {
      throw new XlsxSecurityError('استغرقت معالجة الأرشيف وقتاً أطول من المسموح (مهلة الحماية: 3 ثوانٍ).', 'PROCESSING_TIMEOUT');
    }

    const { localHeaderOffset, compressionMethod, compressedSize, name } = entry;

    if (localHeaderOffset + 30 > buffer.byteLength) {
      throw new XlsxSecurityError(`موقع الترويسة المحلية للملف "${name}" خارج حدود الملف.`, 'LOCAL_HEADER_OUT_OF_BOUNDS');
    }

    const localSig = view.getUint32(localHeaderOffset, true);
    if (localSig !== SIGNATURE_LOCAL_FILE_HEADER) {
      throw new XlsxSecurityError(`توقيع غير صالح في الترويسة المحلية للملف "${name}".`, 'LOCAL_HEADER_INVALID_SIGNATURE');
    }

    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;

    if (dataOffset + compressedSize > buffer.byteLength) {
      throw new XlsxSecurityError(`البيانات المضغوطة للملف "${name}" تتجاوز نهاية الأرشيف.`, 'COMPRESSED_DATA_OUT_OF_BOUNDS');
    }

    const compressedSlice = bytes.subarray(dataOffset, dataOffset + compressedSize);

    if (compressionMethod === 0) {
      // Stored (Uncompressed)
      actualTotalDecompressed += compressedSize;
      if (actualTotalDecompressed > XLSX_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
        throw new XlsxSecurityError('إجمالي البيانات المفكوكة يتجاوز الحد الأقصى المسموح به.', 'TOTAL_DECOMPRESSED_SIZE_EXCEEDED');
      }
    } else if (compressionMethod === 8) {
      // Deflate: Active Streaming Decompression Verification
      let entryDecompressedBytes = 0;

      try {
        // Use standard Web API DecompressionStream
        const ds = new DecompressionStream('deflate-raw');
        const writer = ds.writable.getWriter();
        const reader = ds.readable.getReader();

        // Feed compressed slice
        const writePromise = (async () => {
          await writer.write(compressedSlice);
          await writer.close();
        })();

        // Consume and meter decompressed stream
        while (true) {
          if (Date.now() - startTime > XLSX_LIMITS.MAX_PROCESSING_TIME_MS) {
            await reader.cancel();
            throw new XlsxSecurityError('انتهت مهلة معالجة فك الضغط (مهلة الحماية: 3 ثوانٍ).', 'PROCESSING_TIMEOUT');
          }

          const { done, value } = await reader.read();
          if (done) break;

          entryDecompressedBytes += value.byteLength;
          actualTotalDecompressed += value.byteLength;

          // Check single entry uncompressed bound
          if (entryDecompressedBytes > XLSX_LIMITS.MAX_ENTRY_UNCOMPRESSED_BYTES) {
            await reader.cancel();
            throw new XlsxSecurityError(
              `تجاوز الملف "${name}" الحد الأقصى للحجم المفكوك (${(entryDecompressedBytes / (1024 * 1024)).toFixed(1)}MB).`,
              'ENTRY_DECOMPRESSED_SIZE_EXCEEDED'
            );
          }

          // Check global uncompressed bound
          if (actualTotalDecompressed > XLSX_LIMITS.MAX_TOTAL_UNCOMPRESSED_BYTES) {
            await reader.cancel();
            throw new XlsxSecurityError(
              `تجاوز إجمالي بيانات الأرشيف المفكوكة الحد الأقصى المسموح به (${(actualTotalDecompressed / (1024 * 1024)).toFixed(1)}MB).`,
              'TOTAL_DECOMPRESSED_SIZE_EXCEEDED'
            );
          }

          // Check dynamic compression ratio
          if (compressedSize > 0) {
            const currentRatio = entryDecompressedBytes / compressedSize;
            if (currentRatio > XLSX_LIMITS.MAX_COMPRESSION_RATIO) {
              await reader.cancel();
              throw new XlsxSecurityError(
                `تم اكتشاف نسبة ضغط عالية جدًا (${currentRatio.toFixed(1)}:1) في الملف "${name}". اشتباه في هجوم تضخيم البيانات (Zip Bomb).`,
                'COMPRESSION_RATIO_EXCEEDED'
              );
            }
          }
        }

        await writePromise;
      } catch (err) {
        if (err instanceof XlsxSecurityError) throw err;
        throw new XlsxSecurityError(
          `فشل فك ضغط الملف "${name}" (بيانات تالفة أو غير متوافقة).`,
          'DECOMPRESSION_FAILED'
        );
      }
    }
  }
}
