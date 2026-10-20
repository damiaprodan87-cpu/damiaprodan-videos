// Función serverless de Vercel: GET /api/latest
// Devuelve { live: { id } | null, videos: [{ id, title, published, views }] }
// No necesita API key: usa el feed RSS público del canal y detecta el directo
// mirando la página /live del canal (detección de mejor esfuerzo).

const CHANNEL_ID = 'UCpfI9tPbATkfMwW4IktVZUw';
const HANDLE = 'DamiaProdan';

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

module.exports = async (req, res) => {
  try {
    const [feedRes, liveRes] = await Promise.all([
      fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`, {
        headers: { 'user-agent': 'Mozilla/5.0 (compatible; DamiaProdanSite/1.0)' },
      }),
      fetch(`https://www.youtube.com/@${HANDLE}/live`, {
        headers: {
          'accept-language': 'es-AR,es;q=0.9',
          'user-agent': 'Mozilla/5.0 (compatible; DamiaProdanSite/1.0)',
        },
      }).catch(() => null),
    ]);

    if (!feedRes.ok) {
      res.status(502).json({ error: `YouTube devolvió ${feedRes.status} al pedir el feed` });
      return;
    }

    const xml = await feedRes.text();
    const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
      .map((m) => {
        const e = m[1];
        const id = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
        const title = decode((e.match(/<title>(.*?)<\/title>/) || [])[1] || '');
        const published = (e.match(/<published>(.*?)<\/published>/) || [])[1];
        const views = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
        return { id, title, published, views: views ? Number(views) : null };
      })
      .filter((v) => v.id)
      .slice(0, 9);

    if (!videos.length) {
      res.status(502).json({ error: 'El feed llegó vacío' });
      return;
    }

    let live = null;
    if (liveRes && liveRes.ok) {
      const html = await liveRes.text();
      const isLive = /"isLiveNow":true/.test(html);
      const id = (html.match(/<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/) || [])[1];
      if (isLive && id) live = { id };
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.status(200).json({ live, videos });
  } catch (err) {
    res.status(500).json({ error: 'No se pudo leer YouTube' });
  }
};
