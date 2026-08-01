/**
 * Creates simple garment base template PNGs for the mockup compositor.
 * Each template is a 1200x1600 PNG with a simple garment silhouette.
 * Colors: white garment on transparent background.
 */

import sharp from 'sharp';
import { mkdir, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const OUTPUT_WIDTH = 1200;
const OUTPUT_HEIGHT = 1600;

const GARMENT_TYPES = ['camiseta', 'short', 'legging', 'sudadera', 'tank-top', 'tank_top'];
const VIEWS = ['front', 'back'];

/**
 * Generate an SVG silhouette for a garment type and view.
 */
function generateGarmentSvg(garmentType, view) {
  const w = OUTPUT_WIDTH;
  const h = OUTPUT_HEIGHT;

  // Base garment shapes (simplified silhouettes)
  let bodyPath = '';
  let extraPath = '';

  if (garmentType === 'camiseta' || garmentType === 'sudadera') {
    // T-shirt / sweatshirt shape
    bodyPath = `
      M 350,180 
      L 200,280 L 150,420 L 250,430 L 260,300
      L 300,360
      L 300,1100
      L 900,1100
      L 900,360
      L 940,300
      L 950,430 L 1050,420 L 1000,280
      L 850,180
      L 750,130 L 650,110 L 550,110 L 450,130
      Z
    `;
    if (garmentType === 'sudadera') {
      // Add hood hint
      extraPath = `<ellipse cx="600" cy="105" rx="80" ry="40" fill="#E8E8E8" opacity="0.5"/>`;
    }
  } else if (garmentType === 'tank-top' || garmentType === 'tank_top') {
    // Tank top shape
    bodyPath = `
      M 400,180
      L 350,200 L 300,260
      L 300,1100
      L 900,1100
      L 900,260
      L 850,200
      L 800,180
      L 750,160 L 700,150 L 650,150 L 600,150 L 550,150 L 500,150 L 450,160
      Z
    `;
  } else if (garmentType === 'short') {
    // Shorts shape
    bodyPath = `
      M 350,180
      L 280,200
      L 280,700
      L 330,720
      L 330,1100
      L 570,1100
      L 600,900
      L 630,1100
      L 870,1100
      L 870,720
      L 920,700
      L 920,200
      L 850,180
      L 750,160 L 650,150 L 550,150 L 450,160
      Z
    `;
  } else if (garmentType === 'legging') {
    // Leggings shape
    bodyPath = `
      M 380,160
      L 300,200
      L 300,700
      L 330,720
      L 280,1400
      L 520,1400
      L 600,950
      L 680,1400
      L 920,1400
      L 870,720
      L 900,700
      L 900,200
      L 820,160
      L 720,140 L 650,135 L 580,135 L 500,140
      Z
    `;
  } else {
    // Default: simple rectangle garment
    bodyPath = `M 300,180 L 300,1100 L 900,1100 L 900,180 Z`;
  }

  // Color based on view
  const fillColor = view === 'front' ? '#F0F0F0' : '#E0E0E0';
  const strokeColor = '#CCCCCC';

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <filter id="shadow">
      <feDropShadow dx="2" dy="4" stdDeviation="8" flood-opacity="0.15"/>
    </filter>
  </defs>
  <!-- Transparent background (no rect) -->
  <!-- Garment silhouette -->
  <path d="${bodyPath.trim()}" 
        fill="${fillColor}" 
        stroke="${strokeColor}" 
        stroke-width="2"
        filter="url(#shadow)"/>
  ${extraPath}
  <!-- Brand area indicator (where design will be placed) -->
  <!-- Subtle center guide lines -->
  <line x1="600" y1="0" x2="600" y2="${h}" stroke="#EEEEEE" stroke-width="1" opacity="0.3"/>
  <line x1="0" y1="800" x2="${w}" y2="800" stroke="#EEEEEE" stroke-width="1" opacity="0.3"/>
  <!-- View indicator -->
  <text x="600" y="${h - 30}" 
        text-anchor="middle" 
        font-family="Arial, sans-serif" 
        font-size="18" 
        fill="#AAAAAA"
        opacity="0.5">
    ${garmentType.toUpperCase()} ${view.toUpperCase()}
  </text>
</svg>`;
}

async function main() {
  const outputDir = 'dist/garment-templates';
  
  for (const garmentType of GARMENT_TYPES) {
    for (const view of VIEWS) {
      const dir = `${outputDir}/${garmentType}`;
      await mkdir(dir, { recursive: true });
      
      const svgContent = generateGarmentSvg(garmentType, view);
      const svgPath = `${dir}/${view}.svg`;
      const pngPath = `${dir}/${view}.png`;
      
      // Save SVG
      await writeFile(svgPath, svgContent, 'utf-8');
      
      // Convert SVG to PNG using sharp
      try {
        await sharp(Buffer.from(svgContent))
          .resize(OUTPUT_WIDTH, OUTPUT_HEIGHT)
          .png()
          .toFile(pngPath);
        console.log(`  ✓ ${garmentType}/${view}.png`);
      } catch (err) {
        // sharp can't always handle SVG (requires libvips with SVG support)
        // Fall back to creating a simple colored PNG
        console.log(`  ⚠ SVG failed for ${garmentType}/${view}, creating plain PNG...`);
        await sharp({
          create: {
            width: OUTPUT_WIDTH,
            height: OUTPUT_HEIGHT,
            channels: 4,
            background: { r: 240, g: 240, b: 240, alpha: 0 }
          }
        })
        .png()
        .toFile(pngPath);
        console.log(`  ✓ ${garmentType}/${view}.png (plain)`);
      }
    }
  }
  
  console.log(`\nTemplates created in ${outputDir}/`);
  console.log('Upload to S3 with:');
  console.log(`aws s3 sync ${outputDir}/ s3://cronusfit-exhibition-site-prod/templates/garment-bases/ --region us-east-1`);
}

main().catch(console.error);
