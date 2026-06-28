const express = require('express');
const puppeteer = require('puppeteer');
const path = require('path');

const app = express();
app.use(express.json());

// In‑memory daily limit (resets when server restarts; upgrade to DB for production)
const dailyLimits = new Map();
const PREMIUM_IPS = new Set();
const FREE_LIMIT = 10;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket.remoteAddress ||
         '127.0.0.1';
}

app.post('/generate-pdf', async (req, res) => {
  const ip = getClientIP(req);
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;

  // Premium check
  if (!PREMIUM_IPS.has(ip)) {
    const count = dailyLimits.get(key) || 0;
    if (count >= FREE_LIMIT) {
      return res.status(429).json({ error: 'Daily free limit reached. Upgrade to premium.' });
    }
  }

  const { url, paperFormat, scale } = req.body;
  if (!url || !paperFormat || !scale) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try {
    new URL(url); // validate
  } catch {
    return res.status(400).json({ error: 'Invalid URL' });
  }

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });

    let paperWidth, paperHeight;
    if (paperFormat === 'A4') {
      paperWidth = 8.27; paperHeight = 11.69;
    } else {
      paperWidth = 8.5; paperHeight = 11;
    }

    const pdfBuffer = await page.pdf({
      width: `${paperWidth}in`,
      height: `${paperHeight}in`,
      scale: scale,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    if (!PREMIUM_IPS.has(ip)) {
      dailyLimits.set(key, (dailyLimits.get(key) || 0) + 1);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to generate PDF: ' + err.message });
  } finally {
    if (browser) await browser.close();
  }
});

// Simulated premium (replace with real payment)
app.post('/upgrade', (req, res) => {
  const ip = getClientIP(req);
  PREMIUM_IPS.add(ip);
  res.json({ success: true });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
