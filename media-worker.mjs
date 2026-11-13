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
// Topic tags (산업·분야). BBC has no industry taxonomy, so each item gets the topics
// whose keywords appear in its title/summary, plus the topic of the BBC section feed
// it came from when that section is unambiguous. It is an approximation by design.
const TOPIC_RULES = [
  ["AI·테크",/\b(ai|artificial intelligence|chatbots?|chips?|chipmakers?|semiconductors?|software|tech|technology|cyber\w*|robots?|data cent(?:er|re)s?|algorithms?|apps?|startups?|openai|nvidia|quantum|internet|smartphones?|google|apple|microsoft|tiktok)\b/i],
  ["경제·금융",/\b(econom\w*|inflation|interest rates?|central bank|banks?|stocks?|markets?|invest\w*|financ\w*|budget|tax(?:es)?|recession|gdp|currency|dollar|profits?|shares|bonds?|mortgages?|debt|pensions?)\b/i],
  ["무역",/\b(tariffs?|trade|trading|exports?|imports?|shipping|supply chains?|customs|sanctions?|duty|duties|embargo)\b/i],
  ["에너지·기후",/\b(climate|energy|oil|gas|solar|wind farms?|renewables?|emissions?|carbon|coal|nuclear|electric|batter(?:y|ies)|power plants?|weather|floods?|heatwaves?|wildfires?|cop\d*|net zero)\b/i],
  ["헬스·바이오",/\b(health\w*|vaccines?|cancer|diseases?|hospitals?|nhs|drugs?|medic\w*|virus|flu|covid|doctors?|patients?|surgery|mental|biotech|gene\w*|dementia|obesity)\b/i],
  ["식품·뷰티",/\b(food|foods|restaurants?|menus?|chefs?|cook\w*|recipes?|diets?|vegan|plant-based|coffee|tea|wine|beauty|skincare|cosmetics?|makeup|fashion|perfume|snacks?|bakery|farm\w*|supermarkets?|grocer\w*)\b/i],
  ["교육",/\b(schools?|universit\w*|students?|teachers?|education|exams?|colleges?|curriculum|degrees?|pupils?|classroom|tuition)\b/i],
  ["엔터·문화",/\b(films?|movies?|music|albums?|concerts?|festivals?|actors?|actress|singers?|theatre|theater|netflix|books?|novels?|museums?|celebrit\w*|oscars?|podcasts?|artists?|exhibitions?|bbc sounds)\b/i],
  ["정치·국제",/\b(elections?|president|prime minister|ministers?|government|parliament|vote\w*|war|ukraine|gaza|israel|russia|china|trump|summit|diplomat\w*|military|treaty|nato|un|eu)\b/i],
  ["사회·생활",/\b(crime|police|court|family|families|housing|rent|community|protests?|charity|migrants?|immigration|lifestyle|homes?|jobs?|workers?|wages?|neighbou?rs?|cost of living)\b/i]
];
function topicsFor(text, hint = []) {
  const found = new Set(hint);
  for (const [label,pattern] of TOPIC_RULES) if (pattern.test(text)) found.add(label);
  return TOPIC_RULES.map(([label]) => label).filter(label => found.has(label));
}
export function parseNews(xml, withSummary = false, hint = []) {
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
    const summary = read("description");
    return [{id:url,type:"news",title,url,image,source:"BBC News",date:read("pubDate"),
      topics:topicsFor(title + " " + summary,hint),...(withSummary ? {summary} : {})}];
  });
}
async function upstream(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(8500)});
  if (!response.ok) throw new Error("Upstream unavailable");
  return response;
}
// Search needs no API: BBC publishes one public RSS feed per section, so we read
// them all, drop duplicates, and match the query against title and summary.
const SEARCH_FEEDS = [["world",[]],["technology",["AI·테크"]],["science_and_environment",[]],["health",["헬스·바이오"]],
  ["business",["경제·금융"]],["entertainment_and_arts",["엔터·문화"]],["education",["교육"]],["uk",[]],
  ["world/us_and_canada",[]],["world/asia",[]],["world/europe",[]]]
  .map(([name,hint]) => ["https://feeds.bbci.co.uk/news/" + name + "/rss.xml",hint]);
async function search(query, wanted = []) {
  const results = await Promise.allSettled(SEARCH_FEEDS.map(async ([url,hint]) => parseNews(await (await upstream(url)).text(),true,hint)));
  if (!results.some(result => result.status === "fulfilled")) return Response.json({error:"콘텐츠를 불러오지 못했어요."},{status:502});
  const unique = new Map();
  for (const result of results) {
    if (result.status === "fulfilled") for (const item of result.value) if (!unique.has(item.id)) unique.set(item.id,item);
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [...unique.values()]
    .filter(({title,summary,topics}) => terms.every(term => (title + " " + summary).toLowerCase().includes(term)) &&
      (!wanted.length || topics.some(topic => wanted.includes(topic))))
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
  // View counts are cumulative totals (YouTube has no per-day figure); one extra call per page.
  const views = new Map();
  const ids = (result.items ?? []).map(entry => entry.contentDetails?.videoId).filter(Boolean);
  if (ids.length) {
    try {
      const stats = await youtube("videos",{part:"statistics",id:ids.join(",")});
      for (const entry of stats.items ?? []) views.set(entry.id,Number(entry.statistics?.viewCount) || 0);
    } catch { /* view counts are optional */ }
  }
  const items = (result.items ?? []).flatMap(({snippet:s,contentDetails:d}) => {
    if (!s?.thumbnails || !/^[\w-]{11}$/.test(d?.videoId ?? "")) return [];
    return [{id:d.videoId,type:"video",title:s.title,source:s.videoOwnerChannelTitle || s.channelTitle,
      date:d.videoPublishedAt || s.publishedAt, image:https((s.thumbnails.high ?? s.thumbnails.medium ?? s.thumbnails.default)?.url),
      views:views.get(d.videoId),topics:topicsFor(s.title + " " + (s.description ?? "").slice(0,400)),
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
      const wanted = (url.searchParams.get("topics") ?? "").split(",").map(topic => topic.trim()).filter(Boolean).slice(0,10);
      if ((query && (query.length < 2 || query.length > 60)) || (!query && !wanted.length)) return new Response(null,{status:400});
      try { return await search(query,wanted); }
      catch { return Response.json({error:"콘텐츠를 불러오지 못했어요."},{status:502}); }
    }
    if (["/api/news","/api/videos"].includes(url.pathname)) {
      const cursor = url.searchParams.get("cursor") ?? "";
      if (cursor && (url.pathname !== "/api/videos" || !/^[\w=-]{1,512}$/.test(cursor))) return new Response(null,{status:400});
      return media(request,env,context,url.pathname,cursor);
    }
    const asset = assets[url.pathname === "/" ? "/index.html" : url.pathname];
    if (!asset) return new Response(null,{status:404});
    const body = asset.base64 ? Uint8Array.from(atob(asset.body),char => char.charCodeAt(0)) : asset.body;
    return new Response(request.method === "HEAD" ? null : body,{headers:{"Content-Type":asset.type,"X-Content-Type-Options":"nosniff"}});
  }};
}
