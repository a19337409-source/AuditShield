import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT) || 3000;

const VALID_STATUSES = new Set([
  'Occupied',
  'VacantClean',
  'VacantDirty',
  'OutOfOrder',
  'Complimentary',
  'HouseUse',
]);

function normalizeStatus(raw: unknown): string {
  const str = String(raw || '').trim();
  if (VALID_STATUSES.has(str)) return str;
  const lower = str.toLowerCase();
  if (lower.includes('occ') || lower.includes('in-house') || lower.includes('stay')) {
    return 'Occupied';
  }
  if (lower.includes('ooo') || lower.includes('out of order') || lower.includes('maint')) {
    return 'OutOfOrder';
  }
  if (lower.includes('dirty') || lower.includes('vd')) {
    return 'VacantDirty';
  }
  if (lower.includes('comp')) {
    return 'Complimentary';
  }
  if (lower.includes('house')) {
    return 'HouseUse';
  }
  return 'VacantClean';
}

function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '15mb' }));

  app.post('/api/rooms/extract-from-image', async (req, res) => {
    try {
      const { imageBase64, mimeType, defaultRate } = req.body as {
        imageBase64?: string;
        mimeType?: string;
        defaultRate?: number;
      };

      if (!imageBase64 || typeof imageBase64 !== 'string') {
        res.status(400).json({ error: 'Image payload is required.' });
        return;
      }

      const ai = getGeminiClient();
      if (!ai) {
        res.status(500).json({
          error:
            'GEMINI_API_KEY is not configured on the server. Add your API key in Settings > Secrets.',
        });
        return;
      }

      const cleanedBase64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
      const safeMime =
        typeof mimeType === 'string' && mimeType.startsWith('image/')
          ? mimeType
          : 'image/png';
      const fallbackRate = typeof defaultRate === 'number' && defaultRate > 0 ? defaultRate : 2400;

      const imagePart = {
        inlineData: {
          mimeType: safeMime,
          data: cleanedBase64,
        },
      };

      const textPart = {
        text:
          'Inspect this hotel room rack, floor plan, PMS screenshot (e.g. Kwentra / Opera), or room list photo. ' +
          'Extract every visible hotel room into structured JSON. ' +
          'For each room extract: roomNumber (string), floor (string, infer first digit of 3-digit room number if floor is not explicitly shown), ' +
          'roomType (e.g. Standard King, Twin Classic, Deluxe Nile View, Junior Suite, Executive Suite), ' +
          `baseRate (number, use ${fallbackRate} if no rate is visible), ` +
          'maxOccupancy (integer, default 2 if unknown), ' +
          'status (strictly one of: Occupied, VacantClean, VacantDirty, OutOfOrder, Complimentary, HouseUse), ' +
          'guestName (string, empty if vacant), and notes (string, optional).',
      };

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: { parts: [imagePart, textPart] },
        config: {
          systemInstruction:
            'You are a hotel Night Audit & Room Rack OCR specialist. Return only accurate rooms visible in the image.',
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                roomNumber: { type: Type.STRING },
                floor: { type: Type.STRING },
                roomType: { type: Type.STRING },
                baseRate: { type: Type.NUMBER },
                maxOccupancy: { type: Type.INTEGER },
                status: { type: Type.STRING },
                guestName: { type: Type.STRING },
                notes: { type: Type.STRING },
              },
              required: ['roomNumber'],
            },
          },
        },
      });

      const rawText = (response.text ?? '[]').trim();
      const parsed = JSON.parse(rawText);
      const rawArray = Array.isArray(parsed) ? parsed : [];

      const rooms = rawArray
        .map((item, idx) => {
          const roomNo = String(item?.roomNumber ?? '').trim();
          if (!roomNo) return null;
          const inferredFloor =
            roomNo.length >= 3 && /^\d+$/.test(roomNo)
              ? roomNo.slice(0, roomNo.length - 2)
              : '1';
          const rateVal = Number(item?.baseRate);
          const occVal = Number(item?.maxOccupancy);
          return {
            id: `rm-img-${Date.now()}-${idx}`,
            roomNumber: roomNo,
            floor: String(item?.floor || inferredFloor).trim(),
            roomType: String(item?.roomType || 'Standard King').trim(),
            baseRate: Number.isFinite(rateVal) && rateVal > 0 ? rateVal : fallbackRate,
            maxOccupancy:
              Number.isFinite(occVal) && occVal >= 1 && occVal <= 10
                ? Math.round(occVal)
                : 2,
            status: normalizeStatus(item?.status),
            guestName: item?.guestName ? String(item.guestName).trim() : undefined,
            notes: item?.notes ? String(item.notes).trim() : undefined,
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null);

      res.json({ rooms });
    } catch (err: unknown) {
      const message =
        err instanceof Error ? err.message : 'Failed to extract rooms from image.';
      res.status(500).json({ error: message });
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
