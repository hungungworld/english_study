const BBC_FEED = "https://feeds.bbci.co.uk/news/world/rss.xml";

function plain(value = "") {
  return value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, "")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (entity, code) => {
      if (code[0] !== "#") return {amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" "}[code.toLowerCase()];
      const number = code[1].toLowerCase() === "x" ? parseInt(code.slice(2),16) : Number(code.slice(1));
      return number <= 0x10ffff ? String.fromCodePoint(number) : entity;
    }).trim();
}
function https(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : "";
  } catch { return ""; }
}
export function parseNews(xml, withSummary = false) {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([,item]) => {
    const read = name => plain(item.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"))?.[1]);
    const url = https(read("link"));
    const title = read("title");
    if (!url || !title) return [];
    const thumbnails = [...item.matchAll(/<media:thumbnail\b([^>]*)>/gi)];
    const image = thumbnails.map(([,attributes]) => {
      const value = attributes.match(/\burl\s*=\s*(["'])(.*?)\1/i)?.[2];
      return https(plain(value));
    }).find(Boolean) ?? "";
    return [{id:url,type:"news",title,url,image,source:"BBC News",date:read("pubDate"),
      ...(withSummary ? {summary:read("description")} : {})}];
  });
}
async function upstream(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(8500)});
  if (!response.ok) throw new Error("Upstream unavailable");
  return response;
}
// Search needs no API: BBC publishes one public RSS feed per section, so we read
// them all, drop duplicates, and match the query against title and summary.
const SEARCH_FEEDS = ["world","technology","science_and_environment","health","business",
  "entertainment_and_arts","education","uk","world/us_and_canada","world/asia","world/europe"]
  .map(name => "https://feeds.bbci.co.uk/news/" + name + "/rss.xml");
async function search(query) {
  const results = await Promise.allSettled(SEARCH_FEEDS.map(async url => parseNews(await (await upstream(url)).text(),true)));
  if (!results.some(result => result.status === "fulfilled")) return Response.json({error:"콘텐츠를 불러오지 못했어요."},{status:502});
  const unique = new Map();
  for (const result of results) {
    if (result.status === "fulfilled") for (const item of result.value) if (!unique.has(item.id)) unique.set(item.id,item);
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [...unique.values()]
    .filter(({title,summary}) => terms.every(term => (title + " " + summary).toLowerCase().includes(term)))
    .sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0,60).map(({summary,...item}) => item);
  return Response.json({items,scanned:unique.size},{headers:{"Cache-Control":"public, max-age=60, s-maxage=300"}});
}
async function videos(env, cursor) {
  if (!env.YOUTUBE_API_KEY) return {items:[],next:null,configured:false};
  async function youtube(resource, query) {
    const url = new URL("https://www.googleapis.com/youtube/v3/" + resource);
    url.search = new URLSearchParams({...query,key:env.YOUTUBE_API_KEY});
    return (await upstream(url)).json();
  }
  let playlist = env.YOUTUBE_PLAYLIST_ID?.trim();
  if (!playlist) {
    const result = await youtube("channels",{part:"contentDetails",forHandle:env.YOUTUBE_CHANNEL_HANDLE || "@bbclearningenglish"});
    playlist = result.items?.[0]?.contentDetails?.relatedPlaylists?.uploads;
  }
  if (!playlist) throw new Error("Playlist unavailable");
  const result = await youtube("playlistItems",{part:"snippet,contentDetails",maxResults:"24",playlistId:playlist,...(cursor ? {pageToken:cursor} : {})});
  const items = (result.items ?? []).flatMap(({snippet:s,contentDetails:d}) => {
    if (!s?.thumbnails || !/^[\w-]{11}$/.test(d?.videoId ?? "")) return [];
    return [{id:d.videoId,type:"video",title:s.title,source:s.videoOwnerChannelTitle || s.channelTitle,
      date:d.videoPublishedAt || s.publishedAt, image:https((s.thumbnails.high ?? s.thumbnails.medium ?? s.thumbnails.default)?.url),
      url:"https://www.youtube.com/watch?v=" + d.videoId}];
  });
  return {items,next:result.nextPageToken ?? null,configured:true};
}
async function media(request, env, context, path, cursor) {
  const cacheUrl = new URL(request.url);
  cacheUrl.search = cursor ? new URLSearchParams({cursor}) : "";
  if (path === "/api/news") cacheUrl.searchParams.set("format","thumbnail");
  const cacheKey = new Request(cacheUrl);
  const cache = globalThis.caches?.default;
  const cached = await cache?.match(cacheKey).catch(() => undefined);
  if (cached) return cached;
  try {
    const data = path === "/api/news"
      ? {items:parseNews(await (await upstream(BBC_FEED)).text())}
      : await videos(env,cursor);
    const response = Response.json(data,{headers:{"Cache-Control":data.configured === false ? "no-store" : "public, max-age=300"}});
    if (cache && context && data.configured !== false) context.waitUntil(cache.put(cacheKey,response.clone()).catch(() => {}));
    return response;
  } catch {
    return Response.json({error:"콘텐츠를 불러오지 못했어요."},{status:502});
  }
}
export function handler(assets) {
  return {async fetch(request, env = {}, context) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null,{status:405});
    if (url.pathname === "/api/search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      if (query.length < 2 || query.length > 60) return new Response(null,{status:400});
      try { return await search(query); }
      catch { return Response.json({error:"콘텐츠를 불러오지 못했어요."},{status:502}); }
    }
    if (["/api/news","/api/videos"].includes(url.pathname)) {
      const cursor = url.searchParams.get("cursor") ?? "";
      if (cursor && (url.pathname !== "/api/videos" || !/^[\w=-]{1,512}$/.test(cursor))) return new Response(null,{status:400});
      return media(request,env,context,url.pathname,cursor);
    }
    const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
    if (!asset) return new Response(null,{status:404});
    return new Response(request.method === "HEAD" ? null : asset.body,{headers:{"Content-Type":asset.type,"X-Content-Type-Options":"nosniff"}});
  }};
}
