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
let lastFocus = "";
let generation = 0;
let visible = [];
let section = "";
let landingFilter = "all";
let frame = 0;
const overlay = document.querySelector("#tv-overlay");

function bendWall() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!feed?.isConnected || section) return;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const cards = [...feed.querySelectorAll(".tv-card")];
    const positions = cards.map(card => ({
      card,x:card.offsetLeft + card.offsetWidth / 2,y:card.offsetTop + card.offsetHeight / 2
    }));
    for (const position of positions) {
      const {card} = position;
      const x = (position.x - width / 2) / (width / 2);
      const y = (position.y - window.scrollY - height / 2) / (height / 2);
      const tilt = Math.max(-1,Math.min(1,y));
      card.style.setProperty("--curve-x", tilt * -13 + "deg");
      card.style.setProperty("--curve-y", x * -25 + "deg");
      card.style.setProperty("--curve-scale", 1 - Math.abs(x) * .075);
    }
  });
}
window.addEventListener("scroll",bendWall,{passive:true});
window.addEventListener("resize",bendWall);

function items() {
  if (filter === "news") return news;
  if (filter === "video") return videos;
  return [...news,...videos].sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
function date(item) {
  const stamp = Date.parse(item.date);
  return Number.isFinite(stamp) ? dateFormat.format(stamp) : "";
}
function screen(item, detail = false) {
  if (item.type === "video") return `<div class="tv-screen video-screen"><img src="${escape(item.image)}" alt="" loading="lazy" decoding="async"><span class="tv-play" aria-hidden="true">▶</span></div>`;
  return `<div class="tv-screen news-screen" lang="en"><span>WORLD NEWS</span><strong>${escape(item.title)}</strong>
    ${item.image ? `<img class="news-thumbnail" src="${escape(item.image)}" alt="" loading="${detail ? "eager" : "lazy"}" decoding="async">` : ""}</div>`;
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
  if (!feed?.isConnected) return;
  const grid = feed.querySelector(".tv-grid");
  const count = grid.children.length;
  grid.insertAdjacentHTML("beforeend",visible.slice(count).map(card).join(""));
  paintFooter();
  bendWall();
}
function paintFooter() {
  if (!feed?.isConnected) return;
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
  if (!feed?.isConnected) return;
  if (!visible.length) visible = items().slice(0,LIMIT);
  const messages = [
    filter !== "video" && newsError ? "BBC 뉴스를 불러오지 못했어요." : "",
    filter !== "news" && videoError ? "영어 영상을 불러오지 못했어요." : "",
    ready && filter === "video" && !videoConfigured && !videoError ? "영어 영상 목록을 아직 불러올 수 없어요." : ""
  ].filter(Boolean);
  const controls = Object.entries(filters).map(([id,label]) => `<button data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("");
  feed.innerHTML = `<section class="tv-home"><div class="tv-intro"><h1>${section ? filters[section] : "영어 TV"}</h1></div>
    ${section ? "" : `<nav class="tv-dock" aria-label="영어 TV 메뉴">${controls}<a href="#feed">▤ 게시물</a><a href="#study">스터디 홈 ↗</a></nav>`}
    ${messages.length ? `<div class="tv-message">${messages.join(" ")} <button data-reload>다시 시도</button></div>` : ""}
    <div class="tv-grid">${visible.map(card).join("")}</div>
    ${ready && !visible.length && !messages.length ? '<p class="tv-message">표시할 콘텐츠가 없어요.</p>' : ""}
    <div class="tv-footer" role="status"></div></section>`;
  paintFooter();
  bendWall();
}
function detail(item) {
  return `<section class="tv-detail"><button type="button" class="tv-close" aria-label="닫기">✕</button>
    ${item.type === "video" ? `<iframe class="tv-player" title="${escape(item.title)}" src="https://www.youtube-nocookie.com/embed/${escape(item.id)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : screen(item,true)}
    <div class="tv-detail-copy"><p class="tv-label">${escape(item.source)} · ${date(item)}</p>
    <h1 lang="en">${escape(item.title)}</h1>
    <a class="tv-out" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "YouTube에서 열기" : "BBC 원문 읽기"} ↗</a></div></section>`;
}
function showDetail(item, origin) {
  overlay.innerHTML = detail(item);
  overlay.showModal();
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const target = overlay.getBoundingClientRect();
    const x = origin ? origin.x + origin.width / 2 - target.x - target.width / 2 : 0;
    const y = origin ? origin.y + origin.height / 2 - target.y - target.height / 2 : 0;
    const scale = origin ? Math.min(origin.width / target.width,.85) : .92;
    overlay.animate([{transform:`translate(${x}px,${y}px) scale(${scale})`,opacity:.7},
      {transform:"none",opacity:1}],{duration:460,easing:"cubic-bezier(.2,.8,.2,1)"});
  }
}
overlay.addEventListener("click",event => {
  if (event.target === overlay || event.target.closest(".tv-close")) overlay.close();
});
overlay.addEventListener("error",event => {
  if (event.target.matches?.(".news-thumbnail")) event.target.remove();
},true);
overlay.addEventListener("close",() => {
  overlay.replaceChildren();
  if (location.hash.startsWith("#tv/")) location.replace("#home");
  if (lastFocus) {
    [...(feed?.querySelectorAll("[data-media]") ?? [])].find(button => button.dataset.media === lastFocus)?.focus({preventScroll:true});
    lastFocus = "";
  }
});
export function renderMedia(root, key, view = "") {
  observer?.disconnect();
  if (feed !== root || section !== view) {
    section = view;
    filter = view || landingFilter;
    visible = [];
    notice = "";
    generation++;
  }
  feed = root;
  paint();
  if (!ready) loadFirst();
  if (key) {
    const item = [...news,...videos].find(item => item.id === key);
    if (item) {
      if (!overlay.open) showDetail(item);
      return;
    }
    if (!ready) loadFirst().then(() => {
      if (feed?.isConnected && location.hash.startsWith("#tv/")) renderMedia(feed,key,view);
    });
    else feed.querySelector(".tv-home").insertAdjacentHTML("afterbegin",'<p class="tv-message">이 콘텐츠를 찾을 수 없어요.</p>');
  }
}
export function leaveMedia() {
  observer?.disconnect();
  if (overlay.open) overlay.close();
  feed = null;
}
export function mediaClick(button) {
  const data = button.dataset;
  if (data.tvFilter) {
    filter = data.tvFilter;
    landingFilter = filter;
    visible = [];
    notice = "";
    generation++;
    paint();
    feed.querySelector(`[data-tv-filter="${filter}"]`)?.focus();
  }
  if (data.media) {
    lastFocus = data.media;
    const item = items().find(item => item.id === data.media);
    if (item) showDetail(item,button.querySelector(".tv-screen").getBoundingClientRect());
  }
  if ("more" in data) more();
  if ("reload" in data) {
    visible = [];
    loadFirst();
  }
}
