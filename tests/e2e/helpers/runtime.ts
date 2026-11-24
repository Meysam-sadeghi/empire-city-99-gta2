import { expect, type Page } from '@playwright/test';

export const SCREENSHOT_DIR =
  '/home/root1/.gemini/antigravity/brain/df956d3b-b47b-4fad-b066-c04fc2283efd/scratch/e2e_screenshots';

export interface RuntimeGuardHandle {
  pageErrors: string[];
  consoleErrors: string[];
  failedResponses: string[];
  failedRequests: string[];
  externalRequests: string[];
  assertClean: () => void;
  reset: () => void;
}

const LOCAL_URL_PREFIXES = [
  'http://127.0.0.1:4173',
  'http://localhost:4173',
  'data:',
  'blob:',
];

export function isAllowedLocalUrl(url: string): boolean {
  return LOCAL_URL_PREFIXES.some((prefix) => url.startsWith(prefix));
}

export function attachRuntimeGuards(page: Page): RuntimeGuardHandle {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedResponses: string[] = [];
  const failedRequests: string[] = [];
  const externalRequests: string[] = [];

  page.on('pageerror', (err) => {
    pageErrors.push(err?.stack || err?.message || String(err));
  });

  page.on('console', (msg) => {
    if (msg.type() === 'error') {
      consoleErrors.push(msg.text());
    }
  });

  page.on('request', (req) => {
    const url = req.url();
    if (!isAllowedLocalUrl(url)) {
      externalRequests.push(`${req.method()} ${url}`);
    }
  });

  page.on('response', (res) => {
    if (res.status() >= 400) {
      failedResponses.push(`${res.status()} ${res.url()}`);
    }
  });

  page.on('requestfailed', (req) => {
    const url = req.url();
    const reason = req.failure()?.errorText ?? 'unknown';
    failedRequests.push(`${reason} ${url}`);
  });

  return {
    pageErrors,
    consoleErrors,
    failedResponses,
    failedRequests,
    externalRequests,
    assertClean: () => {
      expect(pageErrors, `Uncaught pageerrors: ${pageErrors.join(' | ')}`).toEqual([]);
      expect(consoleErrors, `Console errors: ${consoleErrors.join(' | ')}`).toEqual([]);
      expect(failedResponses, `HTTP >=400 responses: ${failedResponses.join(' | ')}`).toEqual([]);
      expect(failedRequests, `Failed requests: ${failedRequests.join(' | ')}`).toEqual([]);
      expect(externalRequests, `External network requests: ${externalRequests.join(' | ')}`).toEqual([]);
    },
    reset: () => {
      pageErrors.length = 0;
      consoleErrors.length = 0;
      failedResponses.length = 0;
      failedRequests.length = 0;
      externalRequests.length = 0;
    },
  };
}

export async function waitForGameReady(page: Page, timeoutMs = 15_000): Promise<void> {
  await page.waitForSelector('#game-canvas-container canvas', { state: 'attached', timeout: timeoutMs });
  await page.getByRole('heading', { name: /EMPIRE CITY/i }).waitFor({ state: 'visible', timeout: timeoutMs });
  const box = await page.locator('#game-canvas-container canvas').boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(800);
  expect(box!.height).toBeGreaterThanOrEqual(600);
}

export async function detectRenderBackend(page: Page): Promise<'webgl' | 'canvas2d' | 'unknown'> {
  return page.evaluate(() => {
    const canvas = document.querySelector('#game-canvas-container canvas') as HTMLCanvasElement | null;
    if (!canvas) return 'unknown';
    try {
      if (canvas.getContext('2d')) return 'canvas2d';
    } catch {
      // ignore
    }
    try {
      if (canvas.getContext('webgl2') || canvas.getContext('webgl')) return 'webgl';
    } catch {
      // ignore
    }
    return 'unknown';
  });
}

export interface PngAnalysis {
  width: number;
  height: number;
  meanLuma: number;
  lumaStdDev: number;
  nonBlackRatio: number;
  sampleMeanDiff?: number;
}

function paethPredictor(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const c of chunks) total += c.byteLength;
  const out = new Uint8Array(total);
  let pos = 0;
  for (const c of chunks) {
    out.set(c, pos);
    pos += c.byteLength;
  }
  return out;
}

async function inflateZlib(compressed: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream('deflate');
  const writer = ds.writable.getWriter();
  const outPromise = new Response(ds.readable).arrayBuffer();
  await writer.write(new Uint8Array(compressed));
  await writer.close();
  return new Uint8Array(await outPromise);
}

export async function decodePngPixels(
  buf: Uint8Array
): Promise<{ width: number; height: number; rgba: Uint8Array }> {
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  if (buf.byteLength < 24 || !PNG_SIG.every((b, i) => buf[i] === b)) {
    throw new Error('Invalid PNG buffer');
  }

  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idatChunks: Uint8Array[] = [];

  while (offset + 8 <= buf.byteLength) {
    const length = view.getUint32(offset, false);
    const type = String.fromCharCode(
      buf[offset + 4],
      buf[offset + 5],
      buf[offset + 6],
      buf[offset + 7]
    );
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd > buf.byteLength) break;

    if (type === 'IHDR') {
      width = view.getUint32(dataStart, false);
      height = view.getUint32(dataStart + 4, false);
      bitDepth = buf[dataStart + 8];
      colorType = buf[dataStart + 9];
    } else if (type === 'IDAT') {
      idatChunks.push(buf.subarray(dataStart, dataEnd));
    } else if (type === 'IEND') {
      break;
    }

    offset = dataEnd + 4; // skip CRC
  }

  if (width <= 0 || height <= 0 || bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`Unsupported PNG format: ${width}x${height} depth=${bitDepth} colorType=${colorType}`);
  }

  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const raw = await inflateZlib(concatBytes(idatChunks));
  const unfiltered = new Uint8Array(height * stride);

  for (let y = 0; y < height; y++) {
    const rowStart = y * (stride + 1);
    const filterType = raw[rowStart];
    const outRow = y * stride;
    const prevRow = (y - 1) * stride;

    for (let x = 0; x < stride; x++) {
      const recon = raw[rowStart + 1 + x];
      const a = x >= bpp ? unfiltered[outRow + x - bpp] : 0;
      const b = y > 0 ? unfiltered[prevRow + x] : 0;
      const c = y > 0 && x >= bpp ? unfiltered[prevRow + x - bpp] : 0;

      let val = recon;
      if (filterType === 1) val = (recon + a) & 0xff;
      else if (filterType === 2) val = (recon + b) & 0xff;
      else if (filterType === 3) val = (recon + ((a + b) >> 1)) & 0xff;
      else if (filterType === 4) val = (recon + paethPredictor(a, b, c)) & 0xff;

      unfiltered[outRow + x] = val;
    }
  }

  if (bpp === 4) {
    return { width, height, rgba: unfiltered };
  }

  const rgba = new Uint8Array(width * height * 4);
  for (let i = 0, j = 0; i < unfiltered.length; i += 3, j += 4) {
    rgba[j] = unfiltered[i];
    rgba[j + 1] = unfiltered[i + 1];
    rgba[j + 2] = unfiltered[i + 2];
    rgba[j + 3] = 255;
  }
  return { width, height, rgba };
}

export async function analyzePngBuffer(
  buf: Uint8Array,
  compareWith?: Uint8Array
): Promise<PngAnalysis> {
  const { width, height, rgba } = await decodePngPixels(buf);
  const other = compareWith ? await decodePngPixels(compareWith) : null;

  let count = 0;
  let sumLuma = 0;
  let sumSq = 0;
  let nonBlack = 0;
  let sumDiff = 0;

  // Step by 4 pixels to keep analysis fast (~81k samples for 1280x720)
  const stepX = 4;
  const stepY = 4;
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const idx = (y * width + x) * 4;
      const r = rgba[idx];
      const g = rgba[idx + 1];
      const b = rgba[idx + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sumLuma += luma;
      sumSq += luma * luma;
      if (r > 10 || g > 10 || b > 10) nonBlack++;
      if (other && other.width === width && other.height === height) {
        sumDiff +=
          (Math.abs(r - other.rgba[idx]) +
            Math.abs(g - other.rgba[idx + 1]) +
            Math.abs(b - other.rgba[idx + 2])) /
          3;
      }
      count++;
    }
  }

  const meanLuma = sumLuma / Math.max(1, count);
  const variance = Math.max(0, sumSq / Math.max(1, count) - meanLuma * meanLuma);

  return {
    width,
    height,
    meanLuma,
    lumaStdDev: Math.sqrt(variance),
    nonBlackRatio: nonBlack / Math.max(1, count),
    sampleMeanDiff: other ? sumDiff / Math.max(1, count) : undefined,
  };
}

export async function captureVerifiedScreenshot(
  page: Page,
  filename: string
): Promise<{ filePath: string; analysis: PngAnalysis; canvasAnalysis: PngAnalysis }> {
  const filePath = `${SCREENSHOT_DIR}/${filename}`;
  const buf = await page.screenshot({ path: filePath });
  expect(buf.byteLength).toBeGreaterThan(10_000);
  const analysis = await analyzePngBuffer(buf);
  expect(analysis.width).toBeGreaterThanOrEqual(800);
  expect(analysis.height).toBeGreaterThanOrEqual(600);
  expect(analysis.lumaStdDev).toBeGreaterThan(2.0);
  expect(analysis.nonBlackRatio).toBeGreaterThan(0.05);

  const canvasBuf = await page.locator('#game-canvas-container canvas').screenshot();
  const canvasAnalysis = await analyzePngBuffer(canvasBuf);
  expect(canvasAnalysis.width).toBeGreaterThanOrEqual(800);
  expect(canvasAnalysis.height).toBeGreaterThanOrEqual(600);
  expect(canvasAnalysis.lumaStdDev).toBeGreaterThan(2.0);
  expect(canvasAnalysis.nonBlackRatio).toBeGreaterThan(0.05);

  return { filePath, analysis, canvasAnalysis };
}
