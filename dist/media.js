const LIMIT = 12;
const filters = {all:"전체",news:"BBC 뉴스",video:"영어 영상"};
const dateFormat = new Intl.DateTimeFormat("ko-KR",{month:"short",day:"numeric",timeZone:"Asia/Seoul"});
const escape = value => String(value ?? "").replace(/[&<>"']/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
let feed;
let observer;
let filter = "all";
let next = null;
let pending;
let notice = "";
let news = [];
let videos = [];
let ready = false;
let videoConfigured = false;
let newsError = false;
let videoError = false;
let lastScroll = 0;
let lastFocus = "";
let generation = 0;
let visible = [];
let openKey = "";

function items() {
  if (filter === "news") return news;
  if (filter === "video") return videos;
  return [...news,...videos].sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
function date(item) {
  const stamp = Date.parse(item.date);
  return Number.isFinite(stamp) ? dateFormat.format(stamp) : "";
}
function screen(item) {
  if (item.type === "video") return `<div class="tv-screen video-screen"><img src="${escape(item.image)}" alt="" loading="lazy" decoding="async"><span class="tv-play" aria-hidden="true">▶</span></div>`;
  return `<div class="tv-screen news-screen" lang="en"><span>WORLD NEWS</span><strong>${escape(item.title)}</strong></div>`;
}
function card(item) {
  return `<button type="button" class="tv-card" data-media="${escape(item.id)}" aria-label="${escape(item.title)}">
    ${screen(item)}<span class="tv-label"><span>${escape(item.source)}</span><span>${date(item)}</span></span>
    <strong class="tv-title" lang="en">${escape(item.title)}</strong></button>`;
}
async function get(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("콘텐츠를 불러오지 못했어요.");
  return response.json();
}
function merge(current, incoming) {
  return [...new Map([...current,...incoming].map(item => [item.id,item])).values()];
}
async function loadFirst() {
  if (pending) return pending;
  pending = Promise.allSettled([get("/api/news"),get("/api/videos")]).then(([n,v]) => {
    newsError = n.status === "rejected";
    videoError = v.status === "rejected";
    if (!newsError) news = merge([],n.value.items);
    if (!videoError) {
      videos = merge([],v.value.items);
      next = v.value.next;
      videoConfigured = v.value.configured;
    }
    ready = true;
  }).finally(() => { pending = undefined; paint(); });
  paint();
  return pending;
}
async function more() {
  if (pending) return;
  const remaining = items().filter(item => !visible.some(shown => shown.id === item.id));
  if (remaining.length >= LIMIT || (remaining.length && (!next || filter === "news"))) {
    visible.push(...remaining.slice(0,LIMIT));
    appendCards();
    return;
  }
  if (!next || filter === "news") return;
  const current = generation;
  const token = next;
  notice = "";
  pending = get("/api/videos?cursor=" + encodeURIComponent(token)).then(result => {
    videos = merge(videos,result.items);
    next = result.next === token ? null : result.next;
    if (current !== generation) return;
    const shown = new Set(visible.map(item => item.id));
    visible.push(...items().filter(item => !shown.has(item.id)).slice(0,LIMIT));
  }).catch(() => { notice = "다음 영상을 불러오지 못했어요."; }).finally(() => {
    pending = undefined;
    if (current === generation) appendCards();
    else paint();
  });
  paintFooter();
}
function appendCards() {
  if (!feed?.isConnected || openKey) return;
  const grid = feed.querySelector(".tv-grid");
  const count = grid.children.length;
  grid.insertAdjacentHTML("beforeend",visible.slice(count).map(card).join(""));
  paintFooter();
}
function paintFooter() {
  if (!feed?.isConnected || openKey) return;
  observer?.disconnect();
  const foot = feed.querySelector(".tv-footer");
  const moreAvailable = items().length > visible.length || (filter !== "news" && next);
  foot.innerHTML = pending ? "불러오는 중…" : notice ? `${notice} <button data-more>다시 시도</button>` :
    moreAvailable ? '<button data-more>더 보기</button>' : visible.length ? "현재 가져올 수 있는 콘텐츠를 모두 봤어요." : "";
  if (!pending && !notice && moreAvailable && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) more();
    },{rootMargin:"350px"});
    observer.observe(foot);
  }
}
function paint() {
  if (!feed?.isConnected || openKey) return;
  if (!visible.length) visible = items().slice(0,LIMIT);
  const messages = [
    filter !== "video" && newsError ? "BBC 뉴스를 불러오지 못했어요." : "",
    filter !== "news" && videoError ? "영어 영상을 불러오지 못했어요." : "",
    ready && filter !== "news" && !videoConfigured && !videoError ? "영어 영상은 YouTube 키를 연결하면 표시돼요." : ""
  ].filter(Boolean);
  feed.innerHTML = `<section class="tv-home"><div class="tv-intro"><h1>영어 TV</h1><p>보고 싶은 뉴스나 영상을 골라 보세요.</p></div>
    <div class="tv-filters" aria-label="콘텐츠 유형">${Object.entries(filters).map(([id,label]) => `<button data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("")}</div>
    ${messages.length ? `<div class="tv-message">${messages.join(" ")} ${newsError || videoError ? '<button data-reload>다시 시도</button>' : ""}</div>` : ""}
    <div class="tv-grid">${visible.map(card).join("")}</div>
    ${ready && !visible.length && !messages.length ? '<p class="tv-message">표시할 콘텐츠가 없어요.</p>' : ""}
    <div class="tv-footer" role="status"></div></section>`;
  paintFooter();
}
function detail(item) {
  return `<section class="tv-detail"><a class="back" href="#home">← 영어 TV</a>
    ${item.type === "video" ? `<iframe class="tv-player" title="${escape(item.title)}" src="https://www.youtube-nocookie.com/embed/${escape(item.id)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : screen(item)}
    <div class="tv-detail-copy"><p class="tv-label">${escape(item.source)} · ${date(item)}</p>
    <h1 lang="en">${escape(item.title)}</h1>
    <a class="tv-out" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "YouTube에서 열기" : "BBC 원문 읽기"} ↗</a></div></section>`;
}
export function renderMedia(root, key) {
  observer?.disconnect();
  feed = root;
  openKey = key || "";
  if (key) {
    const item = [...news,...videos].find(item => item.id === key);
    if (item) {
      feed.innerHTML = detail(item);
      return;
    }
    feed.innerHTML = '<a class="back" href="#home">← 영어 TV</a><p class="tv-message">콘텐츠를 확인하는 중이에요.</p>';
    if (!ready) loadFirst().then(() => {
      if (openKey === key && feed?.isConnected) renderMedia(feed,key);
    });
    else feed.querySelector(".tv-message").textContent = "이 콘텐츠를 찾을 수 없어요. 영어 TV에서 다시 선택해 주세요.";
    return;
  }
  paint();
  if (!ready) loadFirst();
  if (lastFocus) requestAnimationFrame(() => {
    if (openKey || !feed?.isConnected) return;
    const target = [...feed.querySelectorAll("[data-media]")].find(button => button.dataset.media === lastFocus);
    target?.focus({preventScroll:true});
    window.scrollTo(0,lastScroll);
    lastFocus = "";
  });
}
export function leaveMedia() {
  observer?.disconnect();
  feed = null;
}
export function mediaClick(button) {
  const data = button.dataset;
  if (data.tvFilter) {
    filter = data.tvFilter;
    visible = [];
    notice = "";
    generation++;
    paint();
    feed.querySelector(`[data-tv-filter="${filter}"]`)?.focus();
  }
  if (data.media) {
    lastFocus = data.media;
    lastScroll = window.scrollY;
    location.hash = "tv/" + encodeURIComponent(data.media);
  }
  if ("more" in data) more();
  if ("reload" in data) {
    visible = [];
    loadFirst();
  }
}
