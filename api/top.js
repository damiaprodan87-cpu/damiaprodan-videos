// Función serverless de Vercel: GET /api/top
// Devuelve { scope: 'all' | 'recent', videos: [{ id, title, published, views }] } ordenado por vistas.
//
// - Con la variable de entorno YOUTUBE_API_KEY (YouTube Data API v3): top de los últimos ~200 videos subidos.
// - Sin la clave: top entre los últimos 15 videos del feed RSS público (scope 'recent').

const CHANNEL_ID = 'UCpfI9tPbATkfMwW4IktVZUw';
const UPLOADS_PLAYLIST = 'UU' + CHANNEL_ID.slice(2);
const KEY = process.env.YOUTUBE_API_KEY;
const TOP_SIZE = 9;

function decode(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function viaDataApi() {
  const ids = [];
  let pageToken = '';
  for (let page = 0; page < 4; page++) {
    const params = { part: 'contentDetails', playlistId: UPLOADS_PLAYLIST, maxResults: '50', key: KEY };
    if (pageToken) params.pageToken = pageToken;
    const r = await fetch('https://www.googleapis.com/youtube/v3/playlistItems?' + new URLSearchParams(params));
    if (!r.ok) throw new Error('playlistItems ' + r.status);
    const j = await r.json();
    (j.items || []).forEach((it) => ids.push(it.contentDetails.videoId));
    pageToken = j.nextPageToken;
    if (!pageToken) break;
  }

  const videos = [];
  for (let i = 0; i < ids.length; i += 50) {
    const params = { part: 'snippet,statistics', id: ids.slice(i, i + 50).join(','), key: KEY };
    const r = await fetch('https://www.googleapis.com/youtube/v3/videos?' + new URLSearchParams(params));
    if (!r.ok) throw new Error('videos ' + r.status);
    const j = await r.json();
    (j.items || []).forEach((v) =>
      videos.push({
        id: v.id,
        title: v.snippet.title,
        published: v.snippet.publishedAt,
        views: Number((v.statistics && v.statistics.viewCount) || 0),
      })
    );
  }

  videos.sort((a, b) => b.views - a.views);
  return { scope: 'all', videos: videos.slice(0, TOP_SIZE) };
}

async function viaRss() {
  const r = await fetch('https://www.youtube.com/feeds/videos.xml?channel_id=' + CHANNEL_ID, {
    headers: { 'user-agent': 'Mozilla/5.0 (compatible; DamiaProdanSite/1.0)' },
  });
  if (!r.ok) throw new Error('feed ' + r.status);
  const xml = await r.text();
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map((m) => {
      const e = m[1];
      const id = (e.match(/<yt:videoId>(.*?)<\/yt:videoId>/) || [])[1];
      const title = decode((e.match(/<title>(.*?)<\/title>/) || [])[1] || '');
      const published = (e.match(/<published>(.*?)<\/published>/) || [])[1];
      const views = (e.match(/<media:statistics views="(\d+)"/) || [])[1];
      return { id, title, published, views: views ? Number(views) : 0 };
    })
    .filter((v) => v.id);
  if (!videos.length) throw new Error('feed vacío');
  videos.sort((a, b) => b.views - a.views);
  return { scope: 'recent', videos: videos.slice(0, TOP_SIZE) };
}

module.exports = async (req, res) => {
  try {
    let out;
    if (KEY) {
      try {
        out = await viaDataApi();
      } catch (e) {
        out = await viaRss();
      }
    } else {
      out = await viaRss();
    }
    res.setHeader('Cache-Control', 's-maxage=1800, stale-while-revalidate=3600');
    res.status(200).json(out);
  } catch (err) {
    res.status(502).json({ error: 'No se pudo armar el top: ' + err.message });
  }
};
