const express = require('express');
const puppeteer = require('puppeteer');
const cors = require('cors'); // ← added

const app = express();
app.use(cors());              // allow all origins
app.use(express.json());

// In‑memory daily limit
const dailyLimits = new Map();
const PREMIUM_IPS = new Set();
const FREE_LIMIT = 10;

function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.socket.remoteAddress || '127.0.0.1';
}

app.post('/generate-pdf', async (req, res) => {
  const ip = getClientIP(req);
  const today = new Date().toDateString();
  const key = `${ip}_${today}`;

  if (!PREMIUM_IPS.has(ip)) {
    const count = dailyLimits.get(key) || 0;
    if (count >= FREE_LIMIT) {
      return res.status(429).json({ error: 'Daily free limit reached.' });
    }
  }

  const { url, paperFormat, scale } = req.body;
  if (!url || !paperFormat || !scale) {
    return res.status(400).json({ error: 'Missing parameters' });
  }

  try { new URL(url); } catch {
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

    let pw, ph;
    if (paperFormat === 'A4') { pw = 8.27; ph = 11.69; }
    else                     { pw = 8.5;  ph = 11; }

    const pdfBuf = await page.pdf({
      width: `${pw}in`, height: `${ph}in`, scale,
      printBackground: true,
      margin: { top: 0, bottom: 0, left: 0, right: 0 }
    });

    if (!PREMIUM_IPS.has(ip)) {
      dailyLimits.set(key, (dailyLimits.get(key) || 0) + 1);
    }

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="resume.pdf"');
    res.send(Buffer.from(pdfBuf));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'PDF generation failed: ' + err.message });
  } finally {
    if (browser) await browser.close();
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`CORS-enabled server on ${PORT}`));
