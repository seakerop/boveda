import { yahooProxy } from './_lib/yahoo.js';

export default async function handler(req, res) {
  try {
    const data = await yahooProxy(req.query || {});
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    res.status(200).json(data);
  } catch (e) {
    res.status(502).json({ error: String(e.message || e) });
  }
}
