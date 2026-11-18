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
// Topic tags (industry and field). BBC has no industry taxonomy, so each item gets the topics
// whose keywords appear in its title/summary, plus the topic of the BBC section feed
// it came from when that section is unambiguous. It is an approximation by design.
const TOPIC_RULES = [
  ["AI & Tech",/\b(ai|artificial intelligence|chatbots?|chips?|chipmakers?|semiconductors?|software|tech|technology|cyber\w*|robots?|data cent(?:er|re)s?|algorithms?|apps?|startups?|openai|nvidia|quantum|internet|smartphones?|google|apple|microsoft|tiktok)\b/i],
  ["Economy & Finance",/\b(econom\w*|inflation|interest rates?|central bank|banks?|stocks?|markets?|invest\w*|financ\w*|budget|tax(?:es)?|recession|gdp|currency|dollar|profits?|shares|bonds?|mortgages?|debt|pensions?)\b/i],
  ["Trade",/\b(tariffs?|trade|trading|exports?|imports?|shipping|supply chains?|customs|sanctions?|duty|duties|embargo)\b/i],
  ["Energy & Climate",/\b(climate|energy|oil|gas|solar|wind farms?|renewables?|emissions?|carbon|coal|nuclear|electric|batter(?:y|ies)|power plants?|weather|floods?|heatwaves?|wildfires?|cop\d*|net zero)\b/i],
  ["Health & Bio",/\b(health\w*|vaccines?|cancer|diseases?|hospitals?|nhs|drugs?|medic\w*|virus|flu|covid|doctors?|patients?|surgery|mental|biotech|gene\w*|dementia|obesity)\b/i],
  ["Food & Beauty",/\b(food|foods|restaurants?|menus?|chefs?|cook\w*|recipes?|diets?|vegan|plant-based|coffee|tea|wine|beauty|skincare|cosmetics?|makeup|fashion|perfume|snacks?|bakery|farm\w*|supermarkets?|grocer\w*)\b/i],
  ["Education",/\b(schools?|universit\w*|students?|teachers?|education|exams?|colleges?|curriculum|degrees?|pupils?|classroom|tuition)\b/i],
  ["Culture & Entertainment",/\b(films?|movies?|music|albums?|concerts?|festivals?|actors?|actress|singers?|theatre|theater|netflix|books?|novels?|museums?|celebrit\w*|oscars?|podcasts?|artists?|exhibitions?|bbc sounds)\b/i],
  ["Politics & World",/\b(elections?|president|prime minister|ministers?|government|parliament|vote\w*|war|ukraine|gaza|israel|russia|china|trump|summit|diplomat\w*|military|treaty|nato|un|eu)\b/i],
  ["Society & Life",/\b(crime|police|court|family|families|housing|rent|community|protests?|charity|migrants?|immigration|lifestyle|homes?|jobs?|workers?|wages?|neighbou?rs?|cost of living)\b/i]
];
function topicsFor(text, hint = []) {
  const found = new Set(hint);
  for (const [label,pattern] of TOPIC_RULES) if (pattern.test(text)) found.add(label);
  return TOPIC_RULES.map(([label]) => label).filter(label => found.has(label));
}
export function parseNews(xml, withSummary = false, hint = [], source = "BBC News") {
  return [...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi)].flatMap(([,item]) => {
    const read = name => plain(item.match(new RegExp("<" + name + "(?:\\s[^>]*)?>([\\s\\S]*?)<\\/" + name + ">", "i"))?.[1]);
    const url = https(read("link"));
    const title = read("title");
    if (!url || !title) return [];
    // BBC gives <media:thumbnail>; Korea Herald gives <media:content medium="image">.
    const thumbnails = [...item.matchAll(/<media:(?:thumbnail|content)\b([^>]*)>/gi)];
    const image = thumbnails.map(([,attributes]) => {
      const value = attributes.match(/\burl\s*=\s*(["'])(.*?)\1/i)?.[2];
      return https(plain(value));
    }).find(Boolean) ?? "";
    const summary = read("description");
    return [{id:url,type:"news",title,url,image,source,date:read("pubDate"),
      summary,topics:topicsFor(title + " " + summary,hint)}];
  });
}
async function upstream(url) {
  const response = await fetch(url,{signal:AbortSignal.timeout(8500)});
  if (!response.ok) throw new Error("Upstream unavailable");
  return response;
}
// Search needs no API: BBC publishes one public RSS feed per section, so we read
// them all, drop duplicates, and match the query against title and summary.
const SEARCH_FEEDS = [["world",[]],["technology",["AI & Tech"]],["science_and_environment",[]],["health",["Health & Bio"]],
  ["business",["Economy & Finance"]],["entertainment_and_arts",["Culture & Entertainment"]],["education",["Education"]],["uk",[]],
  ["world/us_and_canada",[]],["world/asia",[]],["world/europe",[]]]
  .map(([name,hint]) => ["https://feeds.bbci.co.uk/news/" + name + "/rss.xml",hint]);
// The Korea Herald publishes public RSS feeds too (50 items each).
const HERALD_NAME = "The Korea Herald";
const HERALD_FEEDS = [["newsAll",[]],["kh_National",[]],["kh_Business",["Economy & Finance"]],["kh_World",["Politics & World"]],
  ["kh_LifenCulture",["Culture & Entertainment"]],["kh_Kpop",["Culture & Entertainment"]]]
  .map(([name,hint]) => ["https://www.koreaherald.com/rss/" + name,hint]);
const newest = (a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
async function news() {
  const [bbc,herald] = await Promise.allSettled([
    upstream(BBC_FEED).then(response => response.text()).then(xml => parseNews(xml)),
    upstream(HERALD_FEEDS[0][0]).then(response => response.text()).then(xml => parseNews(xml,false,[],HERALD_NAME))]);
  if (bbc.status === "rejected" && herald.status === "rejected") throw new Error("Upstream unavailable");
  return [...(bbc.value ?? []),...(herald.value ?? [])].sort(newest);
}
async function search(query, wanted = []) {
  const results = await Promise.allSettled([
    ...SEARCH_FEEDS.map(async ([url,hint]) => parseNews(await (await upstream(url)).text(),true,hint)),
    ...HERALD_FEEDS.map(async ([url,hint]) => parseNews(await (await upstream(url)).text(),true,hint,HERALD_NAME))]);
  if (!results.some(result => result.status === "fulfilled")) return Response.json({error:"Could not load content."},{status:502});
  const unique = new Map();
  for (const result of results) {
    if (result.status === "fulfilled") for (const item of result.value) if (!unique.has(item.id)) unique.set(item.id,item);
  }
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const items = [...unique.values()]
    .filter(({title,summary,topics}) => terms.every(term => (title + " " + summary).toLowerCase().includes(term)) &&
      (!wanted.length || topics.some(topic => wanted.includes(topic))))
    .sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0,60);
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
      ? {items:await news()}
      : await videos(env,cursor);
    const response = Response.json(data,{headers:{"Cache-Control":data.configured === false ? "no-store" : "public, max-age=300"}});
    if (cache && context && data.configured !== false) context.waitUntil(cache.put(cacheKey,response.clone()).catch(() => {}));
    return response;
  } catch {
    return Response.json({error:"Could not load content."},{status:502});
  }
}
const koreanCache = new Map();
const hangul = /^[가-힣 ]{1,14}$/;
// Dictionary answers are cleaned: weak guesses, polite or casual sentence endings, and the same word with a particle attached are dropped.
const sentenceEnding = /(해요|어요|아요|습니다|ㅂ니다|세요|네요|지요|드릴|드리겠)/;
function cleanKorean(translations, strict = false) {
  const kept = [];
  const ranked = (translations ?? []).filter(item => hangul.test(item.displayTarget) && item.confidence >= 0.05).sort((a,b) => b.confidence - a.confidence);
  for (const {displayTarget:text} of ranked) {
    if (strict && ((text.length >= 2 && /[게길할겨워]$/.test(text)) || (text.length >= 3 && /[이지은는을를]$/.test(text)) || kept.some(known => known.length >= 2 && known.slice(0,2) === text.slice(0,2)))) continue;
    if (sentenceEnding.test(text) || (text.length >= 3 && text.endsWith("해"))) continue;
    if (kept.some(known => known.length >= 2 && text.startsWith(known) && text !== known)) continue;
    if (!kept.includes(text)) kept.push(text);
  }
  return kept;
}
async function similarWords(term) {
  try {
    const response = await fetch(`https://api.datamuse.com/words?ml=${encodeURIComponent(term)}&max=12`,{signal:AbortSignal.timeout(4000)});
    if (!response.ok) return [];
    return (await response.json()).map(item => item.word).filter(word => /^[a-z]{3,16}$/.test(word) && word !== term.toLowerCase()).slice(0,5);
  } catch { return []; }
}
async function koreanFor(words, env) {
  const missing = [...new Set(words)].filter(word => !koreanCache.has(word));
  for (let start = 0; start < missing.length; start += 10) {
    const batch = missing.slice(start,start + 10);
    const response = await fetch("https://api.cognitive.microsofttranslator.com/dictionary/lookup?api-version=3.0&from=en&to=ko",{
      method:"POST",
      headers:{"Content-Type":"application/json","Ocp-Apim-Subscription-Key":env.MS_TRANSLATOR_KEY,"Ocp-Apim-Subscription-Region":env.MS_TRANSLATOR_REGION || "global"},
      body:JSON.stringify(batch.map(Text => ({Text}))),
      signal:AbortSignal.timeout(6000)
    });
    if (!response.ok) throw new Error("translator");
    const data = await response.json();
    batch.forEach((word,index) => {
      koreanCache.set(word,cleanKorean(data[index]?.translations,true)[0] ?? "");
    });
  }
  return words.map(word => koreanCache.get(word) || "");
}
async function quizOptions(terms, env) {
  if (!env.MS_TRANSLATOR_KEY) return Response.json({configured:false,options:{}});
  try {
    const similar = await Promise.all(terms.map(similarWords));
    const korean = await koreanFor(similar.flat(),env);
    let cursor = 0;
    const options = {};
    terms.forEach((term,index) => {
      options[term] = [...new Set(similar[index].map(() => korean[cursor++]).filter(Boolean))].filter((text,at,list) => !list.slice(0,at).some(known => known.slice(0,2) === text.slice(0,2)));
    });
    return Response.json({configured:true,options},{headers:{"Cache-Control":"public, max-age=0, s-maxage=86400, must-revalidate"}});
  } catch { return Response.json({configured:false,options:{}}); }
}
async function translateTerm(term, env) {
  if (!env.MS_TRANSLATOR_KEY) return Response.json({configured:false,korean:""});
  const headers = {"Content-Type":"application/json","Ocp-Apim-Subscription-Key":env.MS_TRANSLATOR_KEY,"Ocp-Apim-Subscription-Region":env.MS_TRANSLATOR_REGION || "global"};
  const call = async (path,signal) => {
    const response = await fetch(`https://api.cognitive.microsofttranslator.com/${path}`,{method:"POST",headers,body:JSON.stringify([{Text:term}]),signal});
    if (!response.ok) throw new Error("translator");
    return (await response.json())[0];
  };
  try {
    const entry = await call("dictionary/lookup?api-version=3.0&from=en&to=ko",AbortSignal.timeout(6000));
    let korean = cleanKorean(entry?.translations).slice(0,2).join(", ");
    if (!korean) {
      const phrase = await call("translate?api-version=3.0&from=en&to=ko",AbortSignal.timeout(6000));
      let text = (phrase?.translations?.[0]?.text ?? "").trim().replace(/[.!?。]+$/,"");
      if (text.length >= 3 && /해(요)?$/.test(text)) text = text.replace(/해(요)?$/,"하다");
      if (text.length <= 30 && !/[A-Za-z]{3,}/.test(text)) korean = text;
    }
    return Response.json({configured:true,korean},{headers:{"Cache-Control":"public, max-age=0, s-maxage=86400, must-revalidate"}});
  } catch { return Response.json({configured:false,korean:""}); }
}
// ---- The Guardian Open Platform (free non-commercial key): article list, article text, and Korean translation of paragraphs ----
const GUARDIAN = "https://content.guardianapis.com/";
const GUARDIAN_SECTIONS = "world|technology|science|environment|business|culture|education|society|lifeandstyle|food|travel|sport";
async function guardianJson(path, params, env) {
  const url = new URL(GUARDIAN + path);
  url.search = new URLSearchParams({...params,"api-key":env.GUARDIAN_API_KEY});
  const response = await fetch(url,{signal:AbortSignal.timeout(8000)});
  if (!response.ok) throw new Error("guardian");
  return (await response.json()).response;
}
async function guardianList(env) {
  if (!env.GUARDIAN_API_KEY) return Response.json({items:[],configured:false},{headers:{"Cache-Control":"no-store"}});
  try {
    const data = await guardianJson("search",{section:GUARDIAN_SECTIONS,"order-by":"newest","page-size":"50","show-fields":"trailText,thumbnail,wordcount",type:"article"},env);
    // Beginners read short pieces: skip very long articles and bare snippets.
    const items = (data.results ?? []).flatMap(result => {
      const fields = result.fields ?? {};
      const words = Number(fields.wordcount) || 0;
      if (words < 120 || words > 900 || !https(result.webUrl)) return [];
      const summary = plain(fields.trailText ?? "");
      return [{id:"gd:" + result.id,apiId:result.id,type:"read",title:plain(result.webTitle),url:result.webUrl,image:https(fields.thumbnail),
        source:"The Guardian",date:result.webPublicationDate,summary,words,topics:topicsFor(result.webTitle + " " + summary,[])}];
    });
    return Response.json({items,configured:true},{headers:{"Cache-Control":"public, max-age=300, s-maxage=600"}});
  } catch { return Response.json({error:"Could not load content."},{status:502}); }
}
// The API often returns the body as one block: group sentences, three per paragraph, so each piece is easy to translate.
function chunkText(text) {
  if (text.length < 420) return [text];
  const sentences = text.split(/(?<=[.!?]["”’]?)\s+(?=["“‘]?[A-Z])/);
  const out = [];
  for (let i = 0; i < sentences.length; i += 3) out.push(sentences.slice(i,i + 3).join(" "));
  return out;
}
async function guardianArticle(id, env) {
  if (!env.GUARDIAN_API_KEY) return Response.json({configured:false},{status:200});
  try {
    const data = await guardianJson("" + id,{"show-fields":"bodyText,byline,wordcount"},env);
    const fields = data.content?.fields ?? {};
    const paragraphs = String(fields.bodyText ?? "").split(/[\r\n]+/).map(line => line.trim()).filter(Boolean).flatMap(chunkText).slice(0,80);
    if (!paragraphs.length) throw new Error("empty");
    return Response.json({configured:true,title:plain(data.content.webTitle),byline:plain(fields.byline ?? ""),url:data.content.webUrl,paragraphs},
      {headers:{"Cache-Control":"public, max-age=3600, s-maxage=3600"}});
  } catch { return Response.json({error:"Could not load the article."},{status:502}); }
}
const paragraphCache = new Map();
async function translateParagraphs(texts, env) {
  if (!env.MS_TRANSLATOR_KEY) return Response.json({configured:false,translations:[]});
  try {
    const missing = [...new Set(texts)].filter(text => !paragraphCache.has(text));
    if (missing.length) {
      const response = await fetch("https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&from=en&to=ko",{
        method:"POST",
        headers:{"Content-Type":"application/json","Ocp-Apim-Subscription-Key":env.MS_TRANSLATOR_KEY,"Ocp-Apim-Subscription-Region":env.MS_TRANSLATOR_REGION || "global"},
        body:JSON.stringify(missing.map(Text => ({Text}))),signal:AbortSignal.timeout(15000)
      });
      if (!response.ok) throw new Error("translator");
      const data = await response.json();
      missing.forEach((text,index) => paragraphCache.set(text,data[index]?.translations?.[0]?.text ?? ""));
      while (paragraphCache.size > 500) paragraphCache.delete(paragraphCache.keys().next().value);
    }
    return Response.json({configured:true,translations:texts.map(text => paragraphCache.get(text) ?? "")});
  } catch { return Response.json({configured:false,translations:[]}); }
}
// Natural English voice (Microsoft Azure Speech, free tier). The key stays on the server; answers are cached because the same word is asked for again and again.
const speechCache = new Map();
async function speakText(text, env) {
  if (!env.MS_SPEECH_KEY || !env.MS_SPEECH_REGION) return new Response(null,{status:204});
  const clean = text.replace(/\([^)]*\)/g," ").replace(/\s+/g," ").trim();
  if (!clean) return new Response(null,{status:400});
  try {
    if (!speechCache.has(clean)) {
      const ssml = `<speak version="1.0" xml:lang="en-US"><voice xml:lang="en-US" name="en-US-AriaNeural"><prosody rate="-8%">${clean.replace(/&/g,"&amp;").replace(/</g,"&lt;")}</prosody></voice></speak>`;
      const response = await fetch(`https://${env.MS_SPEECH_REGION}.tts.speech.microsoft.com/cognitiveservices/v1`,{
        method:"POST",
        headers:{"Ocp-Apim-Subscription-Key":env.MS_SPEECH_KEY,"Content-Type":"application/ssml+xml","X-Microsoft-OutputFormat":"audio-24khz-48kbitrate-mono-mp3","User-Agent":"axciting"},
        body:ssml,signal:AbortSignal.timeout(8000)
      });
      if (!response.ok) throw new Error("speech");
      speechCache.set(clean,new Uint8Array(await response.arrayBuffer()));
      while (speechCache.size > 300) speechCache.delete(speechCache.keys().next().value);
    }
    return new Response(speechCache.get(clean),{headers:{"Content-Type":"audio/mpeg","Cache-Control":"public, max-age=2592000, immutable"}});
  } catch { return new Response(null,{status:204}); }
}
export function handler(assets) {
  return {async fetch(request, env = {}, context) {
    const url = new URL(request.url);
    if (url.pathname === "/api/translate-text") {
      if (request.method !== "POST") return new Response(null,{status:405});
      let body;
      try { body = await request.json(); } catch { return new Response(null,{status:400}); }
      const texts = Array.isArray(body?.texts) ? body.texts.filter(text => typeof text === "string" && text.trim() && text.length <= 2000).slice(0,12) : [];
      if (!texts.length) return new Response(null,{status:400});
      return translateParagraphs(texts,env);
    }
    if (request.method !== "GET" && request.method !== "HEAD") return new Response(null,{status:405});
    if (url.pathname === "/api/speak") {
      const text = (url.searchParams.get("text") ?? "").trim();
      if (!/^[A-Za-z][A-Za-z0-9 ',.()\-]{0,119}$/.test(text)) return new Response(null,{status:400});
      return speakText(text,env);
    }
    if (url.pathname === "/api/guardian") return guardianList(env);
    if (url.pathname === "/api/guardian-article") {
      const id = url.searchParams.get("id") ?? "";
      if (!/^[a-z0-9][a-z0-9\-\/]{4,200}$/i.test(id)) return new Response(null,{status:400});
      return guardianArticle(id,env);
    }
    if (url.pathname === "/api/translate") {
      const term = (url.searchParams.get("term") ?? "").trim().toLowerCase();
      if (!/^[a-z' -]{1,60}$/.test(term)) return new Response(null,{status:400});
      return translateTerm(term,env);
    }
    if (url.pathname === "/api/quiz-options") {
      const terms = [...new Set((url.searchParams.get("terms") ?? "").split("|").map(term => term.trim().toLowerCase()).filter(term => /^[a-z' -]{1,40}$/.test(term)))].slice(0,10);
      if (!terms.length) return new Response(null,{status:400});
      return quizOptions(terms,env);
    }
    if (url.pathname === "/api/search") {
      const query = (url.searchParams.get("q") ?? "").trim();
      const wanted = (url.searchParams.get("topics") ?? "").split(",").map(topic => topic.trim()).filter(Boolean).slice(0,10);
      if ((query && (query.length < 2 || query.length > 60)) || (!query && !wanted.length)) return new Response(null,{status:400});
      try { return await search(query,wanted); }
      catch { return Response.json({error:"Could not load content."},{status:502}); }
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
