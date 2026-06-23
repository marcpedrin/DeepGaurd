/**
 * DeepGuard — Icon Generator
 * Generates proper PNG icon files in multiple sizes using raw PNG encoding.
 * No external dependencies required.
 */

import { writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createWriteStream } from 'fs';
import zlib from 'zlib';

const __dirname = dirname(fileURLToPath(import.meta.url));
const iconsDir = resolve(__dirname, '../public/icons');

// Pure JS minimal PNG encoder
function createPNG(width, height, pixels) {
  // pixels is a Uint8Array of RGBA values (width * height * 4 bytes)
  
  function crc32(data) {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c;
    }
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = table[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  function chunk(type, data) {
    const typeBytes = Buffer.from(type, 'ascii');
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length, 0);
    const crcData = Buffer.concat([typeBytes, data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(crcData), 0);
    return Buffer.concat([len, typeBytes, data, crc]);
  }

  // IHDR
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 2;  // color type: RGB (no alpha for simplicity)
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Image data — filter type 0 (None) per scanline
  const scanlines = [];
  for (let y = 0; y < height; y++) {
    const row = [0]; // filter type
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      row.push(pixels[idx], pixels[idx+1], pixels[idx+2]); // RGB only
    }
    scanlines.push(...row);
  }

  const rawData = Buffer.from(scanlines);
  const compressed = zlib.deflateSync(rawData);

  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', compressed),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function generateShieldIcon(size) {
  const pixels = new Uint8Array(size * size * 4);
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 1;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = (y * size + x) * 4;
      
      // Normalized coordinates [-1, 1]
      const nx = (x - cx) / r;
      const ny = (y - cy) / r;
      
      // Shield shape: wider at top, tapers to point at bottom
      const shieldTop = -0.85;
      const shieldBottom = 0.95;
      
      // Shield outline
      let halfWidth;
      if (ny < -0.5) {
        // Top arc (rounded)
        halfWidth = Math.sqrt(Math.max(0, 1 - ny * ny)) * 0.85;
      } else if (ny < 0.3) {
        // Middle section
        halfWidth = 0.85 - (ny + 0.5) * 0.1;
      } else {
        // Taper to point
        halfWidth = Math.max(0, 0.85 - (ny - 0.3) * 1.3);
      }
      
      const insideShield = ny >= shieldTop && ny <= shieldBottom && Math.abs(nx) <= halfWidth;
      
      if (insideShield) {
        // Deep navy/blue gradient background
        const t = (ny - shieldTop) / (shieldBottom - shieldTop);
        const r1 = Math.round(13 + t * 5);
        const g1 = Math.round(17 + t * 8);
        const b1 = Math.round(38 + t * (26 - 38));
        
        pixels[idx]   = r1;
        pixels[idx+1] = g1;
        pixels[idx+2] = b1;
        pixels[idx+3] = 255;
        
        // Draw a "D" or checkmark in the center
        const inCenter = Math.abs(nx) < 0.45 && Math.abs(ny) < 0.45;
        if (inCenter && size >= 32) {
          // Draw shield inner glow / highlight (stylized "D")
          const dx = nx;
          const dy = ny + 0.05;
          const dist = Math.sqrt(dx*dx + dy*dy);
          
          if (dist < 0.38 && dist > 0.20) {
            // Ring / arc
            const angle = Math.atan2(dy, dx) * 180 / Math.PI;
            if (angle > -120 && angle < 120) {
              pixels[idx]   = 96;
              pixels[idx+1] = 165;
              pixels[idx+2] = 250;
              pixels[idx+3] = 255;
            }
          } else if (dist < 0.18) {
            // Center dot
            pixels[idx]   = 167;
            pixels[idx+1] = 139;
            pixels[idx+2] = 250;
            pixels[idx+3] = 255;
          }
        }
        
        // Shield border glow (edge detection)
        const borderWidth = 0.08;
        const edgeDist = halfWidth - Math.abs(nx);
        const topEdgeDist = ny - shieldTop;
        if (edgeDist < borderWidth || topEdgeDist < borderWidth) {
          const blend = Math.min(1, Math.min(edgeDist, topEdgeDist) / borderWidth);
          pixels[idx]   = Math.round(pixels[idx]   * blend + 59  * (1 - blend));
          pixels[idx+1] = Math.round(pixels[idx+1] * blend + 130 * (1 - blend));
          pixels[idx+2] = Math.round(pixels[idx+2] * blend + 246 * (1 - blend));
        }
      } else {
        // Transparent
        pixels[idx]   = 0;
        pixels[idx+1] = 0;
        pixels[idx+2] = 0;
        pixels[idx+3] = 0;
      }
    }
  }
  
  return pixels;
}

const sizes = [16, 32, 48, 128];

for (const size of sizes) {
  const pixels = generateShieldIcon(size);
  
  // Simple approach: create minimal valid PNG
  // Use Buffer directly  
  const png = createPNG(size, size, pixels);
  const outPath = resolve(iconsDir, `icon${size}.png`);
  writeFileSync(outPath, png);
  console.log(`Generated icon${size}.png (${png.length} bytes)`);
}

console.log('Icons generated successfully!');
