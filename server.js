const express = require('express');
const multer = require('multer');
const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

const UPLOADS_DIR = path.join(__dirname, 'uploads');
const DATA_FILE = path.join(__dirname, 'data.json');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR);

// Multer stores files in memory for sharp processing
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ------- Data helpers -------

function readData() {
  try {
    if (fs.existsSync(DATA_FILE)) return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch { /* corrupted – start fresh */ }
  return { nextId: 0, images: [] };
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ------- Routes -------

// Serve index.html and static uploads
app.use('/uploads', express.static(UPLOADS_DIR));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'index.html')));

// List all images (metadata only – client builds URLs from id)
app.get('/api/images', (_req, res) => {
  const data = readData();
  res.json(data.images);
});

// Upload one or more images – compress to JPEG with sharp
app.post('/api/images', upload.array('images', 50), async (req, res) => {
  if (!req.files || req.files.length === 0) return res.status(400).json({ error: 'No files' });

  const data = readData();
  const added = [];

  for (const file of req.files) {
    try {
      const id = data.nextId++;
      const filename = `${id}.jpg`;
      const filepath = path.join(UPLOADS_DIR, filename);

      // Compress: resize large images, convert to JPEG quality 80
      const pipeline = sharp(file.buffer).rotate(); // auto-rotate based on EXIF
      const metadata = await pipeline.metadata();

      const maxDim = 2048;
      let width = metadata.width || 1;
      let height = metadata.height || 1;

      if (width > maxDim || height > maxDim) {
        pipeline.resize({ width: maxDim, height: maxDim, fit: 'inside', withoutEnlargement: true });
        // Recalculate dimensions after resize
        const scale = Math.min(maxDim / width, maxDim / height);
        width = Math.round(width * scale);
        height = Math.round(height * scale);
      }

      await pipeline.jpeg({ quality: 80, mozjpeg: true }).toFile(filepath);

      // Read back actual dimensions from the written file
      const info = await sharp(filepath).metadata();
      const actualWidth = info.width || width;
      const actualHeight = info.height || height;

      const entry = {
        id,
        filename,
        aspect: actualWidth / actualHeight,
        area: actualWidth * actualHeight
      };
      data.images.push(entry);
      added.push(entry);
    } catch (err) {
      console.error('Failed to process image:', err.message);
    }
  }

  writeData(data);
  res.json(added);
});

// Delete a single image
app.delete('/api/images/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  const data = readData();
  const idx = data.images.findIndex(img => img.id === id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });

  const [removed] = data.images.splice(idx, 1);
  writeData(data);

  // Remove file from disk
  const filepath = path.join(UPLOADS_DIR, removed.filename);
  try { fs.unlinkSync(filepath); } catch { /* already gone */ }

  res.json({ ok: true });
});

// Clear all images
app.delete('/api/images', (_req, res) => {
  const data = readData();
  for (const img of data.images) {
    try { fs.unlinkSync(path.join(UPLOADS_DIR, img.filename)); } catch { /* ignore */ }
  }
  writeData({ nextId: data.nextId, images: [] });
  res.json({ ok: true });
});

app.listen(PORT, () => console.log(`Collage server running on http://localhost:${PORT}`));
