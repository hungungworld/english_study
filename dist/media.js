import {readLocal,writeLocal} from "./data.js";
import {pagerHtml,pageCount,PER_PAGE} from "./pager.js";

const LIMIT = 12;
const filters = {all:"All",news:"News",video:"Video",read:"With translation",scraps:"Saved"};
const dateFormat = new Intl.DateTimeFormat("en-US",{month:"short",day:"numeric",timeZone:"Asia/Seoul"});
const escape = value => String(value ?? "").replace(/[&<>"']/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
let feed;
let observer;
let filter = "all";
let next = null;
let pending;
let notice = "";
let news = [];
let videos = [];
let reads = [];
let readError = false;
let ready = false;
let loadedAt = 0;
let videoConfigured = false;
let newsError = false;
let videoError = false;
let lastFocus = "";
let generation = 0;
let visible = [];
let section = "";
let landingFilter = "all";
let homeFilter = "all";
let frame = 0;
let wallOffset = 0;
let drag;
let suppressClick = false;
const overlay = document.querySelector("#tv-overlay");
let selectedItem;
let scraps = readLocal("media-scraps",[]);
let scrapPage = 1;
let scrapQuery = "";
let scrapType = "all";
const scrapTopics = new Set();
function scrapFiltered() {
  const terms = String(scrapQuery).toLowerCase().split(/\s+/).filter(Boolean);
  return scraps.filter(item => (scrapType === "all" || item.type === scrapType) &&
    terms.every(term => String(item.title).toLowerCase().includes(term)) &&
    (!scrapTopics.size || (item.topics ?? []).some(topic => scrapTopics.has(topic))));
}
function scrapSlice() {
  const list = scrapFiltered();
  scrapPage = Math.min(Math.max(1,scrapPage),pageCount(list.length));
  const start = (scrapPage - 1) * PER_PAGE;
  return list.slice(start,start + PER_PAGE);
}
function scrapFilterHtml() {
  const counts = TOPICS.map(topic => [topic,scraps.filter(item => (item.topics ?? []).includes(topic)).length]).filter(([,count]) => count);
  return `<div class="scrap-filters"><div class="scrap-row"><input id="scrap-q" type="search" placeholder="Search saved" aria-label="Search saved" autocomplete="off" maxlength="60">
    <div class="tabs" aria-label="Type">${[["all","All"],["news","News"],["video","Video"],["read","With translation"]].map(([id,label]) =>
      `<button type="button" data-scrap-type="${id}" aria-pressed="${scrapType === id}">${label}</button>`).join("")}</div>
    <span class="count" data-scrap-count>${scrapFiltered().length}</span><button type="button" data-scrap-reset>Reset</button></div>
    ${counts.length ? `<div class="scrap-topics" role="group" aria-label="Topics">${counts.map(([topic,count]) =>
      `<button type="button" class="chip" data-scrap-topic="${topic}" aria-pressed="${scrapTopics.has(topic)}">${topic}<small>${count}</small></button>`).join("")}</div>` : ""}</div>`;
}
// Re-draws the cards, pager and counts only, so typing in the search box keeps its focus.
function refreshScraps() {
  const home = feed?.querySelector(".tv-home");
  if (!home || section !== "scraps") return;
  visible = scrapSlice();
  const total = scrapFiltered().length;
  home.querySelector(".tv-grid").innerHTML = visible.map(card).join("");
  home.querySelectorAll(".tv-message").forEach(note => note.remove());
  if (!visible.length) home.querySelector(".tv-grid").insertAdjacentHTML("afterend",
    `<p class="tv-message">${scraps.length ? "No saved items match." : "Nothing saved yet. Use the bookmark button in Explore to save items."}</p>`);
  const countEl = home.querySelector("[data-scrap-count]");
  if (countEl) countEl.textContent = String(total);
  home.querySelectorAll("[data-scrap-type]").forEach(button => button.setAttribute("aria-pressed",button.dataset.scrapType === scrapType));
  home.querySelectorAll("[data-scrap-topic]").forEach(button => button.setAttribute("aria-pressed",scrapTopics.has(button.dataset.scrapTopic)));
  home.querySelector(".tv-footer").innerHTML = pagerHtml("scrap",scrapPage,pageCount(total));
}
document.addEventListener("input",event => {
  if (event.target.id !== "scrap-q") return;
  scrapQuery = event.target.value;
  scrapPage = 1;
  refreshScraps();
});

function scrapKey(item) {
  if (item.type === "video") return item.id;
  const url = new URL(item.url);
  url.search = "";
  url.hash = "";
  return url.href;
}

// Project each card's four corners through the same radial lens. Applying the
// resulting homography to the button also moves its browser hit target.
function lensTransform(left,top,width,height,project) {
  const [a,b,c,d] = [
    project(left,top),project(left+width,top),
    project(left+width,top+height),project(left,top+height)
  ].map(([x,y]) => [x-left,y-top]);
  const [dx1,dx2,dx3] = [b[0]-c[0],d[0]-c[0],a[0]-b[0]+c[0]-d[0]];
  const [dy1,dy2,dy3] = [b[1]-c[1],d[1]-c[1],a[1]-b[1]+c[1]-d[1]];
  const determinant = dx1*dy2-dx2*dy1;
  if (Math.abs(determinant) < 1e-6) return "none";
  const g = (dx3*dy2-dx2*dy3)/determinant;
  const h = (dx1*dy3-dx3*dy1)/determinant;
  return `matrix3d(${[
    (b[0]*(1+g)-a[0])/width,(b[1]*(1+g)-a[1])/width,0,g/width,
    (d[0]*(1+h)-a[0])/height,(d[1]*(1+h)-a[1])/height,0,h/height,
    0,0,1,0,a[0],a[1],0,1
  ].join(",")})`;
}

function wallCycle(grid) {
  return grid.clientWidth + (parseFloat(getComputedStyle(grid).columnGap) || 0);
}

function bendWall() {
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (!feed?.isConnected || section) return;
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;
    const grid = feed.querySelector(".tv-grid");
    if (!grid) return;
    const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const cycle = wallCycle(grid);
    if (!cycle) return;
    const radius = Math.hypot(width,height)/2;
    const project = (x,y) => {
      const dx = x - width/2;
      const dy = y - height/2;
      const r2 = (dx*dx + dy*dy)/(radius*radius);
      // Bounded radial compression keeps the mapping monotonic off-screen.
      const scale = 1.12 / Math.sqrt(1 + .60*r2 + .08*r2*r2/(1+r2));
      return [width/2 + dx*scale,height/2 + dy*scale];
    };
    const cards = [...grid.querySelectorAll(".tv-card")];
    const positions = cards.map(card => ({
      card,left:card.offsetLeft,top:card.offsetTop - window.scrollY,
      width:card.offsetWidth,height:card.offsetHeight
    }));
    for (const position of positions) {
      const {card,top,width:cardWidth,height:cardHeight} = position;
      if (top > height + cardHeight || top + cardHeight < -cardHeight) continue;
      const center = position.left + cardWidth/2 + wallOffset;
      const shift = wallOffset - Math.floor((center - width/2 + cycle/2)/cycle)*cycle;
      const left = position.left + shift;
      card.style.translate = shift + "px";
      if (reducedMotion) continue;
      card.style.setProperty("--wall-lens",lensTransform(left,top,cardWidth,cardHeight,project));
      const distance = Math.hypot(left+cardWidth/2-width/2,top+cardHeight/2-height/2)/radius;
      card.style.setProperty("--lens-shade",Math.min(.42,distance**2*.32));
    }
  });
}
window.addEventListener("scroll",bendWall,{passive:true});
window.addEventListener("resize",bendWall);

document.addEventListener("pointerdown",event => {
  if (event.pointerType !== "mouse" || event.button !== 0 || section || overlay.open) return;
  const grid = event.target.closest(".media-mode .tv-grid");
  if (!grid) return;
  suppressClick = false;
  drag = {id:event.pointerId,grid,x:event.clientX,y:event.clientY,offset:wallOffset,scroll:window.scrollY,active:false};
});
document.addEventListener("pointermove",event => {
  if (!drag || event.pointerId !== drag.id) return;
  const dx = event.clientX - drag.x;
  const dy = event.clientY - drag.y;
  if (!drag.active && Math.hypot(dx,dy) < 6) return;
  if (!drag.active) {
    drag.active = true;
    drag.grid.setPointerCapture(event.pointerId);
    drag.grid.classList.add("is-dragging");
  }
  const cycle = wallCycle(drag.grid);
  wallOffset = cycle ? (drag.offset + dx) % cycle : 0;
  window.scrollTo(0,drag.scroll - dy);
  bendWall();
});
function finishDrag(event) {
  if (!drag || event.pointerId !== drag.id) return;
  suppressClick = drag.active;
  drag.grid.classList.remove("is-dragging");
  drag = undefined;
}
document.addEventListener("pointerup",finishDrag);
document.addEventListener("pointercancel",finishDrag);
document.addEventListener("dragstart",event => {
  if (event.target.closest(".media-mode :is(.tv-grid,.globe-stage)")) event.preventDefault();
});
document.addEventListener("click",event => {
  if (!suppressClick) return;
  suppressClick = false;
  if (event.detail && event.target.closest(".media-mode :is(.tv-grid,.globe-stage)")) event.stopPropagation();
},true);

function items() {
  if (filter === "scraps") return scraps;
  if (filter === "news") return news;
  if (filter === "video") return videos;
  if (filter === "read") return reads;
  return [...news,...videos,...reads].sort((a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0));
}
function date(item) {
  const stamp = Date.parse(item.date);
  return Number.isFinite(stamp) ? dateFormat.format(stamp) : "";
}
function screen(item, detail = false) {
  if (item.type === "video") return `<div class="tv-screen video-screen"><img src="${escape(item.image)}" alt="" loading="lazy" decoding="async"><span class="tv-play" aria-hidden="true">▶</span></div>`;
  return `<div class="tv-screen news-screen" lang="en"><span>${item.type === "read" ? "THE GUARDIAN" : "WORLD NEWS"}</span><strong>${escape(item.title)}</strong>
    ${item.image ? `<img class="news-thumbnail" src="${escape(item.image)}" alt="" loading="${detail ? "eager" : "lazy"}" decoding="async">` : ""}</div>`;
}
function card(item) {
  return `<button type="button" class="tv-card" lang="en" data-media="${escape(item.id)}" aria-label="${escape(item.title)}">
    ${screen(item)}<span class="tv-label" lang="en"><span>${escape(item.source)}</span><span>${date(item)}</span></span>
    <strong class="tv-title" lang="en">${escape(item.title)}</strong></button>`;
}
// 외부 자료(뉴스·영상) 제목 앞뒤의 이모지는 잉크·종이 두 색 디자인과 맞지 않아 화면에서만 지운다.
export const cleanTitle = (title = "") => String(title).replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\u20e3\u200d\ufe0f\u{1F3FB}-\u{1F3FF}]+/gu,"").replace(/\s{2,}/g," ").trim();
async function get(path) {
  const response = await fetch(path);
  if (!response.ok) throw new Error("Could not load items.");
  const data = await response.json();
  if (Array.isArray(data.items)) data.items = data.items.map(item => ({...item,title:cleanTitle(item.title)}));
  return data;
}
function merge(current, incoming) {
  return [...new Map([...current,...incoming].map(item => [item.id,item])).values()];
}
async function loadFirst() {
  if (pending) return pending;
  pending = Promise.allSettled([get("/api/news"),get("/api/videos"),get("/api/guardian")]).then(([n,v,g]) => {
    readError = g.status === "rejected";
    if (!readError) reads = merge([],g.value.items);
    newsError = n.status === "rejected";
    videoError = v.status === "rejected";
    if (!newsError) news = merge([],n.value.items);
    if (!videoError) {
      videos = merge([],v.value.items);
      next = v.value.next;
      videoConfigured = v.value.configured;
    }
    ready = true;
    loadedAt = Date.now();
  }).finally(() => { pending = undefined; paint(); });
  paint();
  return pending;
}
async function more() {
  if (pending) return;
  const remaining = items().filter(item => !visible.some(shown => shown.id === item.id));
  if (remaining.length >= LIMIT || (remaining.length && (!next || filter === "news" || filter === "read" || filter === "scraps"))) {
    visible.push(...remaining.slice(0,LIMIT));
    appendCards();
    return;
  }
  if (!next || filter === "news" || filter === "read" || filter === "scraps") return;
  const current = generation;
  const token = next;
  notice = "";
  pending = get("/api/videos?cursor=" + encodeURIComponent(token)).then(result => {
    videos = merge(videos,result.items);
    next = result.next === token ? null : result.next;
    if (current !== generation) return;
    const shown = new Set(visible.map(item => item.id));
    visible.push(...items().filter(item => !shown.has(item.id)).slice(0,LIMIT));
  }).catch(() => { notice = "Could not load the next videos."; }).finally(() => {
    pending = undefined;
    if (current === generation) appendCards();
    else paint();
  });
  paintFooter();
}
function appendCards() {
  if (!feed?.isConnected) return;
  const grid = feed.querySelector(".tv-grid");
  if (!grid) return;
  const count = grid.children.length;
  grid.insertAdjacentHTML("beforeend",visible.slice(count).map(card).join(""));
  paintFooter();
  bendWall();
}
function paintFooter() {
  if (!feed?.isConnected) return;
  observer?.disconnect();
  if (!section) return;
  const foot = feed.querySelector(".tv-footer");
  if (section === "scraps") {
    foot.innerHTML = pagerHtml("scrap",scrapPage,pageCount(scrapFiltered().length));
    return;
  }
  if (section === "home") {
    foot.innerHTML = pending ? "Loading…" : '<a href="#videos">More videos<span class="ar ne" aria-hidden="true"></span></a><a href="#news">More articles<span class="ar ne" aria-hidden="true"></span></a>';
    return;
  }
  const moreAvailable = items().length > visible.length || (["all","video"].includes(filter) && next);
  foot.innerHTML = pending ? "Loading…" : notice ? `${notice} <button data-more>Try again</button>` :
    moreAvailable ? '<button data-more>Load more</button>' : visible.length ? "You have seen everything available." : "";
  if (!pending && !notice && moreAvailable && "IntersectionObserver" in window) {
    observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) more();
    },{rootMargin:"350px"});
    observer.observe(foot);
  }
}
const MONTHS_EN = ["Jan.","Feb.","Mar.","Apr.","May","Jun.","Jul.","Aug.","Sep.","Oct.","Nov.","Dec."];
// 내 스크랩: 게시판·단어장과 같은 포스터 페이지(왼쪽 정보·필터 칸 + 큰 제목 + 카드 목록). 필터는 스크랩이 6개 이상일 때만.
function scrapsPage() {
  const now = new Date(Date.now() + 9 * 3600000);
  const many = scraps.length >= 6;
  const counts = TOPICS.map(topic => [topic,scraps.filter(item => (item.topics ?? []).includes(topic)).length]).filter(([,count]) => count);
  const kinds = [["all","All"],["news","News"],["video","Video"],["read","With translation"]].map(([id,label]) => `<button type="button" data-scrap-type="${id}" aria-pressed="${scrapType === id}">${label}</button>`).join("");
  const topics = counts.map(([topic,count]) => `<button type="button" data-scrap-topic="${topic}" aria-pressed="${scrapTopics.has(topic)}">${topic} ${count}</button>`).join("");
  const empty = !visible.length ? `<p class="tv-message">${scraps.length ? "No saved items match." : "Nothing saved yet. Use the bookmark button in Explore to save items."}</p>` : "";
  return `<section class="tv-home"><div class="poster-page">
    <header class="pr-head"><div><h1>Saved</h1><p>Articles and videos you saved</p></div></header>
    <aside class="pr-rail" aria-label="Saved info and filters">
      <div class="pr-rail-top"><div class="pr-date" aria-hidden="true">${MONTHS_EN[now.getUTCMonth()]} ${now.getUTCDate()}<span>${now.getUTCFullYear()}</span></div></div>
      <div class="pr-rail-bottom">
        <div class="pr-group"><b>Saved</b><span data-scrap-count>${scrapFiltered().length}</span></div>
        ${many ? `<div class="pr-group" role="group" aria-label="Kind"><b>Kind</b>${kinds}</div>
        ${topics ? `<div class="pr-group" role="group" aria-label="Topics"><b>Topics</b>${topics}</div>` : ""}
        <div class="pr-group"><button type="button" data-scrap-reset>Reset</button></div>` : ""}
      </div>
    </aside>
    <div class="pr-body">
      ${many ? '<input id="scrap-q" type="search" placeholder="Search saved" aria-label="Search saved" autocomplete="off" maxlength="60">' : ""}
      <div class="tv-grid">${visible.map(card).join("")}</div>
      ${empty}
      <div class="tv-footer" role="status"></div>
    </div>
  </div></section>`;
}
function paint() {
  if (!feed?.isConnected) return;
  if (section === "scraps") {
    visible = scrapSlice();
    feed.innerHTML = scrapsPage();
    paintFooter();
    const search = feed.querySelector("#scrap-q");
    if (search) search.value = scrapQuery;
    return;
  }
  if (!visible.length) {
    visible = section === "home" && filter === "all"
      ? [...videos.slice(0,3),...news.slice(0,3)]
      : items().slice(0,section === "home" ? 6 : LIMIT);
  }
  const messages = section === "scraps" ? [] : [
    filter !== "video" && filter !== "read" && newsError ? "Could not load BBC News." : "",
    filter !== "news" && filter !== "read" && videoError ? "Could not load videos." : "",
    (filter === "read" || filter === "all") && readError ? "Could not load articles." : "",
    ready && filter === "video" && !videoConfigured && !videoError ? "Videos are not available yet." : ""
  ].filter(Boolean);
  const controls = Object.entries(filters).filter(([id]) => id !== "scraps").map(([id,label]) => `<button data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("");
  const keepSearchFocus = document.activeElement?.id === "tv-q";
  const caret = keepSearchFocus ? document.activeElement.selectionStart : 0;
  feed.innerHTML = `<section class="tv-home"><div class="tv-intro"><h1>${!section ? `<button type="button" class="tv-about-btn" data-about-toggle aria-expanded="${aboutOpen}" aria-controls="tv-about"><span>Explore</span><span class="sr-only"> · about this list</span><span class="ic info" aria-hidden="true"></span></button>` : section === "home" ? "Videos & articles" : filters[section] ?? "Explore"}</h1></div>
    ${!section ? aboutHtml() : ""}
    ${section === "home" ? `<nav class="tv-filters home-tv-tabs" aria-label="Videos and articles">${controls}</nav>` : ""}
    ${!section ? `<div class="tv-summary" data-summary>${summaryHtml()}</div>` : ""}
    ${!section ? sheetHtml() + dockHtml() + '<div class="sr-only" role="status" aria-live="polite" data-results-live></div>' : ""}
    ${section === "scraps" ? `<a class="back" href="#explore"><span class="ar l" aria-hidden="true"></span>Explore</a>${scraps.length >= 6 ? scrapFilterHtml() : ""}` : ""}
    ${messages.length ? `<div class="tv-message">${messages.join(" ")} <button data-reload>Try again</button></div>` : ""}
    ${section ? `<div class="tv-grid">${visible.map(card).join("")}</div>` : `<div class="tv-view" data-view data-mode="${resultsActive() ? "results" : "globe"}">${viewInner()}</div>`}
    ${(ready || section === "scraps") && !visible.length && !messages.length && (section || !resultsActive()) ? `<p class="tv-message">${section === "scraps" ? "Nothing saved yet. Use the bookmark button in Explore to save items." : "No items to show."}</p>` : ""}
    <div class="tv-footer" role="status"></div></section>`;
  paintFooter();
  bendWall();
  if (section === "scraps") {
    const search = feed.querySelector("#scrap-q");
    if (search) search.value = scrapQuery;
  }
  if (!section) {
    mountGlobe();
    const input = feed.querySelector("#tv-q");
    if (input) {
      input.value = searchQuery;
      if (keepSearchFocus) { input.focus(); input.setSelectionRange(caret,caret); }
    }
  }
}
function detail(item) {
  const saved = scraps.some(entry => scrapKey(entry) === scrapKey(item));
  const reader = item.type === "read";
  return `<button type="button" class="tv-close" aria-label="Close">✕</button><div class="tv-stage"><section class="tv-detail${reader ? " is-reader" : ""}">
    ${reader ? '<div class="tv-scroll">' : ""}${item.type === "video" ? `<iframe class="tv-player" title="${escape(item.title)}" src="https://www.youtube-nocookie.com/embed/${escape(item.id)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : screen(item,true)}
    <div class="tv-detail-copy"><p class="tv-label">${escape(item.source)} · ${date(item)}</p>
    <h1 lang="en">${escape(item.title)}</h1>
    ${item.summary ? `<p class="tv-summary" lang="en">${escape(item.summary)}</p>` : ""}
    ${item.type === "read" ? '<div class="tv-article" data-article aria-live="polite"><p class="hint">Loading the article…</p></div>' : ""}
    <div class="row"><a class="tv-out" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "Open on YouTube" : item.type === "read" ? "Read on The Guardian" : "Read on BBC"}<span class="ar ne" aria-hidden="true"></span></a>
    <button type="button" class="tv-action" data-write-source><span class="ic plus" aria-hidden="true"></span>Write</button>
    <button type="button" class="tv-action" data-scrap aria-label="Save" aria-pressed="${saved}" title="${saved ? "Remove from saved" : "Save"}"><span class="bookmark-icon" aria-hidden="true"></span></button></div></div>${reader ? "</div>" : ""}</section><aside class="tv-writer" aria-label="Write a note" hidden></aside></div>`;
}
function showDetail(item, origin) {
  selectedItem = item;
  overlay.classList.remove("is-writing");
  overlay.innerHTML = detail(item);
  overlay.showModal();
  placeClose();
  if (item.type === "read") loadArticle(item);
  if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const target = overlay.getBoundingClientRect();
    const x = origin ? origin.x + origin.width / 2 - target.x - target.width / 2 : 0;
    const y = origin ? origin.y + origin.height / 2 - target.y - target.height / 2 : 0;
    const scale = origin ? Math.min(origin.width / target.width,.85) : .92;
    overlay.animate([{transform:`translate(${x}px,${y}px) scale(${scale})`,opacity:.7},
      {transform:"none",opacity:1}],{duration:460,easing:"cubic-bezier(.2,.8,.2,1)"}).finished.then(placeClose).catch(() => {});
  }
}
// The close button floats just above the window's top-right corner, outside the picture and the video; while a note is being written the window fills the screen and the note panel has its own close.
function placeClose() {
  const close = overlay.querySelector(":scope > .tv-close");
  if (!close || !overlay.open) return;
  const box = overlay.getBoundingClientRect();
  close.hidden = overlay.classList.contains("is-writing");
  close.style.top = Math.max(0,box.top - 48) + "px";
  close.style.left = Math.max(0,box.right - 44) + "px";
}
new MutationObserver(placeClose).observe(overlay,{attributes:true,attributeFilter:["class","open"]});
addEventListener("resize",placeClose);
// BBC forbids embedding its pages, so while writing the article opens in its own window,
// placed over the left part of the screen and leaving the writing panel visible.
function openSideWindow(url) {
  const panel = Math.min(480,Math.max(340,innerWidth * .34));
  const width = Math.max(480,screen.availWidth - panel - 24);
  const features = `popup=yes,noopener,noreferrer,width=${Math.round(width)},height=${Math.round(screen.availHeight)},left=${screen.availLeft ?? 0},top=${screen.availTop ?? 0}`;
  window.open(url,"article-window",features);
}
// ---- Guardian article: full text, with a Korean translation that opens under each paragraph ----
async function loadArticle(item) {
  const host = overlay.querySelector("[data-article]");
  try {
    const response = await fetch("/api/guardian-article?id=" + encodeURIComponent(item.apiId));
    const article = await response.json();
    if (!response.ok || !article.paragraphs) throw new Error("article");
    if (selectedItem !== item || !host.isConnected) return;
    host.innerHTML = `${article.byline ? `<p class="tv-byline" lang="en">${escape(article.byline)}</p>` : ""}
      <div class="row"><button type="button" class="tv-action" data-translate-all>Translate all</button></div>
      ${article.paragraphs.map((text,index) => `<div class="tv-para" data-para="${index}"><p lang="en">${escape(text)}</p>
        <button type="button" class="tv-link" data-translate aria-expanded="false">Translate</button><p class="tv-ko" lang="ko" hidden></p></div>`).join("")}
      <div class="tv-highlights" data-highlights hidden></div>
      <p class="hint">Powered by <a href="${escape(article.url)}" target="_blank" rel="noopener noreferrer">The Guardian</a>. Korean translation by Microsoft Translator.</p>`;
    host.paragraphs = article.paragraphs;
    host.itemId = item.id;
    host.savedTerms = [];
    host.renderMarks = () => renderMarks(host);
    host.highlightSeed = highlightSeed;
    penOn = false;
    const scroll = overlay.querySelector(".tv-scroll");
    if (scroll && !scroll.querySelector("[data-pen]")) {
      scroll.insertAdjacentHTML("beforeend",PEN_BUTTON);
      scroll.addEventListener("scroll",() => syncJump(scroll),{passive:true});
      setTimeout(() => syncJump(scroll),400);
    }
    renderMarks(host);
    overlay.dispatchEvent(new CustomEvent("article-ready",{detail:{host}}));
    if (!readLocal("reader-hint",false)) showReaderHint(host);
  } catch {
    if (host.isConnected) host.innerHTML = '<p class="hint">Could not load the article. Use the link below to read it on The Guardian.</p>';
  }
}
// ---- Highlighter: yellow marks stored as positions only (paragraph, start, end) in this browser; the article text itself is never saved ----
const ICON_ATTRS = 'viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="square" aria-hidden="true"';
const PEN_BUTTON = `<div class="tv-fabs"><button type="button" class="tv-jump" data-jump data-dir="down" aria-label="Jump to the end of the article" title="Jump to the end"><svg ${ICON_ATTRS}><path d="M12 5v14"/><path d="M6 13l6 6 6-6"/></svg></button><button type="button" class="tv-pen" data-pen aria-pressed="false" aria-label="Highlighter" title="Highlighter"><svg ${ICON_ATTRS}><path d="M4 20l1-5L16 4l4 4L9 19z"/><path d="M13 7l4 4"/></svg></button></div>`;
// One arrow: it points down (jump to the end) all the way through the article and flips up only near the end (back to the top).
function syncJump(scroll) {
  const jump = scroll.querySelector("[data-jump]");
  if (!jump) return;
  const long = scroll.scrollHeight > scroll.clientHeight * 1.6;
  jump.hidden = !long;
  const down = scroll.scrollTop < scroll.scrollHeight - scroll.clientHeight - scroll.clientHeight * .5;
  if ((jump.dataset.dir === "down") !== down) {
    jump.dataset.dir = down ? "down" : "up";
    jump.setAttribute("aria-label",down ? "Jump to the end of the article" : "Back to the top");
    jump.title = down ? "Jump to the end" : "Back to the top";
    jump.querySelector("svg").innerHTML = down ? '<path d="M12 5v14"/><path d="M6 13l6 6 6-6"/>' : '<path d="M12 19V5"/><path d="M6 11l6-6 6 6"/>';
  }
}
let penOn = false;
const readMarks = id => readLocal("reader-marks",{})[id] ?? [];
function writeMarks(id, list) {
  const all = readLocal("reader-marks",{});
  if (list.length) all[id] = list; else delete all[id];
  writeLocal("reader-marks",all);
}
function mergeMarks(list) {
  const sorted = list.map(mark => [...mark]).sort((a,b) => a[0] - b[0] || a[1] - b[1]);
  const out = [];
  for (const mark of sorted) {
    const last = out[out.length - 1];
    if (last && last[0] === mark[0] && mark[1] <= last[2]) last[2] = Math.max(last[2],mark[2]);
    else out.push(mark);
  }
  return out;
}
const isSentence = text => text.trim().split(/\s+/).length >= 4 || text.length >= 30;
function renderMarks(host) {
  const marks = readMarks(host.itemId);
  const saved = (host.savedTerms ?? []).filter(Boolean);
  host.paragraphs.forEach((text,index) => {
    const para = host.querySelector(`[data-para="${index}"] > p[lang=en]`);
    if (!para) return;
    const lit = marks.filter(mark => mark[0] === index).map(mark => [mark[1],mark[2]]);
    const known = [];
    for (const term of saved) {
      const pattern = new RegExp("(^|[^A-Za-z])(" + term.replace(/[.*+?^${}()|[\]\\]/g,"\\$&") + ")(?![A-Za-z])","gi");
      for (const match of text.matchAll(pattern)) known.push([match.index + match[1].length,match.index + match[1].length + match[2].length]);
    }
    if (!lit.length && !known.length) { if (para.querySelector("mark.hl,.word-saved")) para.textContent = text; return; }
    const cuts = [...new Set([0,text.length,...lit.flat(),...known.flat()])].sort((a,b) => a - b);
    let html = "";
    for (let i = 0; i < cuts.length - 1; i++) {
      const [from,to] = [cuts[i],cuts[i + 1]];
      let piece = escape(text.slice(from,to));
      if (known.some(([s,e]) => s <= from && e >= to)) piece = `<span class="word-saved" title="Already in your words">${piece}</span>`;
      if (lit.some(([s,e]) => s <= from && e >= to)) piece = `<mark class="hl">${piece}</mark>`;
      html += piece;
    }
    para.innerHTML = html;
  });
  const box = host.querySelector("[data-highlights]");
  if (!box) return;
  const pieces = marks.slice().sort((a,b) => a[0] - b[0] || a[1] - b[1]).map(([p,s,e]) => host.paragraphs[p]?.slice(s,e).trim()).filter(Boolean);
  const sentences = pieces.filter(isSentence);
  const words = [...new Set(pieces.filter(piece => !isSentence(piece)).map(piece => piece.toLowerCase()))];
  box.hidden = !pieces.length;
  box.innerHTML = pieces.length ? `<h2>Highlights</h2>
    ${sentences.length ? `<ul class="tv-hl-list" lang="en">${sentences.map(text => `<li>${escape(text)}</li>`).join("")}</ul>` : ""}
    ${words.length ? `<p lang="en"><strong>Words</strong> · ${words.map(escape).join(" · ")}</p>` : ""}
    <div class="row"><button type="button" class="tv-action" data-note-from-highlights>Write a note with these</button>${words.length ? '<button type="button" class="tv-action" data-add-highlighted>Add words to my list</button>' : ""}</div>` : "";
}
const paraOffset = (para, node, offset) => {
  const range = document.createRange();
  range.selectNodeContents(para);
  range.setEnd(node,offset);
  return range.toString().length;
};
function paintFromSelection(para, event, click = false) {
  const host = para.closest("[data-article]");
  const index = Number(para.closest("[data-para]")?.dataset.para);
  if (!host?.paragraphs || Number.isNaN(index)) return;
  const text = host.paragraphs[index];
  const selection = getSelection();
  let start, end;
  if (!click && selection.rangeCount && !selection.isCollapsed && para.contains(selection.getRangeAt(0).commonAncestorContainer)) {
    const range = selection.getRangeAt(0);
    start = paraOffset(para,range.startContainer,range.startOffset);
    end = paraOffset(para,range.endContainer,range.endOffset);
    while (start < end && /\s/.test(text[start])) start++;
    while (end > start && /\s/.test(text[end - 1])) end--;
    while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1]) && /[A-Za-z'’-]/.test(text[start])) start--;
    while (end < text.length && /[A-Za-z'’-]/.test(text[end]) && /[A-Za-z'’-]/.test(text[end - 1])) end++;
  } else if (event?.clientX !== undefined) {
    const at = document.caretPositionFromPoint?.(event.clientX,event.clientY);
    const hit = at?.offsetNode ? [at.offsetNode,at.offset] : (() => { const r = document.caretRangeFromPoint?.(event.clientX,event.clientY); return r ? [r.startContainer,r.startOffset] : null; })();
    if (!hit || hit[0].nodeType !== 3 || !para.contains(hit[0])) return;
    const at0 = paraOffset(para,hit[0],hit[1]);
    const marks = readMarks(host.itemId);
    const over = marks.filter(mark => mark[0] === index && mark[1] <= at0 && at0 < mark[2]);
    if (over.length) { writeMarks(host.itemId,marks.filter(mark => !over.includes(mark))); renderMarks(host); return; }
    start = at0; end = at0;
    while (start > 0 && /[A-Za-z'’-]/.test(text[start - 1])) start--;
    while (end < text.length && /[A-Za-z'’-]/.test(text[end])) end++;
  } else return;
  if (end - start < 2) return;
  writeMarks(host.itemId,mergeMarks([...readMarks(host.itemId),[index,start,end]]));
  selection.removeAllRanges();
  renderMarks(host);
}
let pressedAt = null;
overlay.addEventListener("pointerdown",event => { pressedAt = {x:event.clientX,y:event.clientY}; });
overlay.addEventListener("pointerup",event => {
  if (!penOn) return;
  const para = event.target.closest?.(".tv-article .tv-para > p[lang=en]");
  // A plain single click toggles the word under it; a drag or double-click paints what was selected.
  const click = Boolean(pressedAt) && Math.hypot(event.clientX - pressedAt.x,event.clientY - pressedAt.y) < 5 && event.detail === 1;
  if (para) setTimeout(() => paintFromSelection(para,event,click),80);
});
// Touch screens: a long-press selection has no pointer-up at its end, so the selection is painted once it settles.
if (matchMedia("(pointer: coarse)").matches) {
  let settle;
  document.addEventListener("selectionchange",() => {
    clearTimeout(settle);
    settle = setTimeout(() => {
      if (!penOn || !overlay.open) return;
      const selection = getSelection();
      const para = selection.anchorNode?.parentElement?.closest(".tv-article .tv-para > p[lang=en]");
      if (para && !selection.isCollapsed) paintFromSelection(para);
    },600);
  });
}
function highlightSeed() {
  const host = overlay.querySelector("[data-article]");
  const pieces = readMarks(host.itemId).slice().sort((a,b) => a[0] - b[0] || a[1] - b[1]).map(([p,s,e]) => host.paragraphs[p]?.slice(s,e).trim()).filter(Boolean);
  return {sentences:pieces.filter(isSentence),words:[...new Set(pieces.filter(piece => !isSentence(piece)).map(piece => piece.toLowerCase()))]};
}
// First time in an article: one line says words can be tapped, and one word in the first paragraph blinks its outline once and keeps a dotted underline.
function showReaderHint(host) {
  host.insertAdjacentHTML("afterbegin",'<div class="tv-hint" data-hint><p>Tap any word to see its meaning and save it.</p><button type="button" class="tv-hint-close" data-hint-close aria-label="Close hint">✕</button></div>');
  const para = host.querySelector(".tv-para > p[lang=en]");
  const node = [...(para?.childNodes ?? [])].find(item => item.nodeType === 3);
  const found = node?.textContent.match(/\b[a-z]{8,}\b/);
  if (!found) return;
  const word = node.splitText(found.index);
  word.splitText(found[0].length);
  const mark = document.createElement("span");
  mark.className = "word-nudge";
  mark.textContent = word.textContent;
  word.replaceWith(mark);
}
function dismissReaderHint() {
  writeLocal("reader-hint",true);
  overlay.querySelector("[data-hint]")?.remove();
  for (const mark of overlay.querySelectorAll(".word-nudge")) mark.replaceWith(...mark.childNodes);
}
overlay.addEventListener("pointerup",event => {
  if (event.target.closest?.(".tv-article .tv-para > p[lang=en]") && overlay.querySelector("[data-hint]")) setTimeout(dismissReaderHint,60);
});
async function translateParas(host, indexes) {
  const todo = indexes.filter(index => !host.querySelector(`[data-para="${index}"] .tv-ko`).textContent);
  for (let i = 0; i < todo.length; i += 10) {
    const chunk = todo.slice(i,i + 10);
    const response = await fetch("/api/translate-text",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({texts:chunk.map(index => host.paragraphs[index])})});
    const data = await response.json();
    if (!data.configured) throw new Error("translate");
    chunk.forEach((index,at) => { host.querySelector(`[data-para="${index}"] .tv-ko`).textContent = data.translations[at] || ""; });
  }
  for (const index of indexes) {
    const box = host.querySelector(`[data-para="${index}"]`);
    box.querySelector(".tv-ko").hidden = false;
    const button = box.querySelector("[data-translate]");
    button.textContent = "Hide translation";
    button.setAttribute("aria-expanded","true");
  }
}
overlay.addEventListener("click",async event => {
  const host = overlay.querySelector("[data-article]");
  if (event.target.closest("[data-hint-close]")) dismissReaderHint();
  const jump = event.target.closest("[data-jump]");
  if (jump) {
    const scroll = overlay.querySelector(".tv-scroll");
    const smooth = matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
    scroll.scrollTo({top:jump.dataset.dir === "down" ? scroll.scrollHeight : 0,behavior:smooth});
  }
  const pen = event.target.closest("[data-pen]");
  if (pen) {
    penOn = !penOn;
    pen.setAttribute("aria-pressed",String(penOn));
    overlay.querySelector(".tv-article")?.classList.toggle("pen-on",penOn);
  }
  if (selectedItem && event.target.closest("[data-note-from-highlights]")) {
    const writer = overlay.querySelector(".tv-writer");
    overlay.classList.add("is-writing");
    writer.hidden = false;
    overlay.dispatchEvent(new CustomEvent("write-media",{detail:{item:selectedItem,host:writer,seed:highlightSeed()}}));
  }
  const toggle = event.target.closest("[data-translate]");
  if (toggle && host?.paragraphs) {
    const box = toggle.closest("[data-para]");
    if (toggle.getAttribute("aria-expanded") === "true") {
      box.querySelector(".tv-ko").hidden = true;
      toggle.textContent = "Translate";
      toggle.setAttribute("aria-expanded","false");
    } else {
      toggle.disabled = true;
      try { await translateParas(host,[Number(box.dataset.para)]); }
      catch { toggle.textContent = "Translation unavailable. Try again"; }
      toggle.disabled = false;
    }
  }
  const all = event.target.closest("[data-translate-all]");
  if (all && host?.paragraphs) {
    all.disabled = true;
    try { await translateParas(host,host.paragraphs.map((_,index) => index)); all.remove(); }
    catch { all.textContent = "Translation unavailable. Try again"; all.disabled = false; }
  }
  if (selectedItem && event.target.closest("[data-write-source]")) {
    // Keep the detail window (and the playing video) open and show the form beside it.
    const host = overlay.querySelector(".tv-writer");
    overlay.classList.add("is-writing");
    host.hidden = false;
    overlay.dispatchEvent(new CustomEvent("write-media",{detail:{item:selectedItem,host}}));
  }
  const articleLink = event.target.closest(".tv-out");
  if (articleLink && (selectedItem?.type === "news" || selectedItem?.type === "read") && overlay.classList.contains("is-writing")) {
    event.preventDefault();
    openSideWindow(articleLink.href);
  }
  const scrapButton = event.target.closest("[data-scrap]");
  if (selectedItem && scrapButton) {
    const key = scrapKey(selectedItem);
    const saved = scraps.some(item => scrapKey(item) === key);
    scraps = saved ? scraps.filter(item => scrapKey(item) !== key) : [selectedItem,...scraps];
    writeLocal("media-scraps",scraps);
    scrapButton.setAttribute("aria-pressed",String(!saved));
    scrapButton.title = saved ? "Save" : "Remove from saved";
    if (section === "scraps") {
      visible = scraps.slice(0,Math.max(visible.length,LIMIT));
      paint();
    }
  }
  if (event.target === overlay || event.target.closest(".tv-close")) overlay.close();
});
overlay.addEventListener("error",event => {
  if (event.target.matches?.(".news-thumbnail")) event.target.remove();
},true);
overlay.addEventListener("close",() => {
  selectedItem = undefined;
  overlay.classList.remove("is-writing");
  overlay.replaceChildren();
  if (location.hash.startsWith("#tv/")) location.replace("#explore");
  if (lastFocus) {
    [...(feed?.querySelectorAll("[data-media]") ?? [])].find(button => button.dataset.media === lastFocus)?.focus({preventScroll:true});
    lastFocus = "";
  }
});
// ---- Landing filters ---------------------------------------------------------
// Rest state: only the dock is visible. "탐색" opens a sheet (search, type, topics);
// applying it closes the sheet and leaves a one-line summary of what is active.
// Keyword or topic filters switch the globe to a result list; type alone keeps the globe.
export const TOPICS = ["AI & Tech","Economy & Finance","Trade","Energy & Climate","Health & Bio","Food & Beauty","Education","Culture & Entertainment","Politics & World","Society & Life"];
const selectedTopics = new Set();
let sheetOpen = false;
let aboutOpen = false;
const spanOf = list => {
  const times = list.map(item => Date.parse(item.date)).filter(Number.isFinite).sort((a,b) => a - b);
  return times.length ? `${dateFormat.format(new Date(times[0]))} – ${dateFormat.format(new Date(times.at(-1)))}` : "";
};
// Where the list comes from, how far back it goes, and how long it is kept.
function aboutHtml() {
  const loaded = (list,word) => list.length ? `${list.length} ${word}${list.length === 1 ? "" : "s"} loaded, ${spanOf(list)}. ` : "";
  return `<div class="tv-about" id="tv-about" role="region" aria-label="About this list" ${aboutOpen ? "" : "hidden"}><h2>About this list</h2><dl>
    <dt>Articles</dt><dd>${loaded(news,"article")}BBC World News feed, newest first. BBC keeps only about the last 2 days, so older articles drop off.</dd>
    <dt>Videos</dt><dd>${loaded(videos,"video")}BBC Learning English on YouTube, newest first. Older videos load as you scroll in Video.</dd>
    <dt>Search</dt><dd>Looks through BBC’s section feeds, about 280 recent articles going back a couple of months.</dd>
    <dt>Updated</dt><dd>About every 5 minutes. We don’t store articles. Items you save stay in this browser.</dd></dl></div>`;
}
function setAbout(open) {
  aboutOpen = open;
  const home = feed?.querySelector(".tv-home");
  if (!home) return;
  const panel = home.querySelector("#tv-about");
  if (panel) panel.hidden = !open;
  home.querySelector("[data-about-toggle]")?.setAttribute("aria-expanded",open);
}
let listView = false;
let searchQuery = "";
let searchNews = [];
let searchKey = "";
let searchState = "";
let searchTimer = 0;
let searchSeq = 0;
let idleTimer = 0;
const norm = value => String(value ?? "").toLowerCase();
const byDate = (a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
const topicsOf = item => item.topics ?? [];
function searchTerms() {
  return norm(searchQuery).split(/\s+/).filter(Boolean);
}
function resultsActive() {
  return searchTerms().length > 0 || selectedTopics.size > 0 || listView;
}
function typeOk(item) {
  return filter === "news" ? item.type === "news" : filter === "video" ? item.type === "video" : filter === "read" ? item.type === "read" : true;
}
function currentKey() {
  const q = searchQuery.trim();
  return JSON.stringify([q.length >= 2 ? norm(q) : "",[...selectedTopics].sort()]);
}
// A: items already loaded, matched by title. B: BBC section feeds via /api/search,
// used only while they belong to the filters that are on screen right now.
function baseResults() {
  const terms = searchTerms();
  const local = [...news,...videos,...reads].filter(item => terms.every(term => norm(item.title).includes(term)));
  return merge(local,searchKey === currentKey() ? searchNews : []).filter(typeOk);
}
function landingResults() {
  return baseResults().filter(item => !selectedTopics.size || topicsOf(item).some(topic => selectedTopics.has(topic))).sort(byDate);
}
function topicCounts() {
  const base = baseResults();
  return Object.fromEntries(TOPICS.map(topic => [topic,base.filter(item => topicsOf(item).includes(topic)).length]));
}
function filterCount() {
  return (searchTerms().length ? 1 : 0) + selectedTopics.size + (filter !== "all" ? 1 : 0);
}
function applyLabel() {
  return resultsActive() ? `Show ${landingResults().length} results` : `Show ${items().length} items`;
}
function typeControls() {
  return Object.entries(filters).filter(([id]) => id !== "scraps")
    .map(([id,label]) => `<button type="button" data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("");
}
function dockHtml() {
  const count = filterCount();
  return `<nav class="tv-dock" aria-label="Explore menu"><button type="button" class="tv-explore" data-sheet-toggle aria-expanded="${sheetOpen}" aria-controls="tv-sheet">Search${count ? `<span class="badge" aria-label="${count} filters applied">${count}</span>` : ""}</button><a href="#home">Home</a><a href="#scraps">Saved</a></nav>`;
}
// "Loaded from BBC · updated 3 min ago": says the list really came from the feeds, and how fresh it is. Hidden while loading or after an error.
function freshText() {
  if (!ready || !loadedAt || newsError || videoError) return "";
  const minutes = Math.floor((Date.now() - loadedAt) / 60000);
  const ago = minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : `${Math.floor(minutes / 60)} hr ago`;
  return `<span class="ic check" aria-hidden="true"></span>Loaded from BBC · updated ${ago}`;
}
function sheetHtml() {
  const counts = topicCounts();
  return `<div class="tv-sheet" id="tv-sheet" role="dialog" aria-label="Search" ${sheetOpen ? "" : "hidden"}>
    <div class="dialog-head"><div class="dialog-title"><h2>Search</h2><p class="tv-fresh" data-fresh>${freshText()}</p></div><button type="button" data-sheet-toggle data-close aria-label="Close search">✕</button></div>
    <form role="search" data-tv-search><input id="tv-q" type="search" name="q" placeholder="e.g. climate, AI" aria-keyshortcuts="/" autocomplete="off" enterkeyhint="search" aria-label="Search news and videos" maxlength="60"></form>
    <div class="tv-sheet-row"><div class="tv-seg" role="group" aria-label="Type">${typeControls()}</div><button type="button" class="tv-link" data-reset-filters>Reset</button></div>
    <div class="tv-topics" role="group" aria-label="Topics">${TOPICS.map(topic =>
      `<button type="button" class="tv-chip${counts[topic] ? "" : " is-zero"}" data-topic="${topic}" aria-pressed="${selectedTopics.has(topic)}">${topic}<small>${counts[topic]}</small></button>`).join("")}</div>
    <button type="button" class="tv-apply" data-sheet-apply>${applyLabel()}</button>
  </div>`;
}
function summaryHtml() {
  if (!searchTerms().length && !selectedTopics.size && filter === "all") return "";
  const pills = [];
  if (searchTerms().length) pills.push(`<span class="tv-pill">“${escape(searchQuery.trim())}” <button type="button" data-remove-query aria-label="Clear search">✕</button></span>`);
  for (const topic of selectedTopics) pills.push(`<span class="tv-pill">${escape(topic)} <button type="button" data-remove-topic="${escape(topic)}" aria-label="Remove ${escape(topic)}">✕</button></span>`);
  if (filter !== "all") pills.push(`<span class="tv-pill">${filters[filter]} <button type="button" data-remove-type aria-label="Clear type">✕</button></span>`);
  const total = resultsActive() ? landingResults().length : items().length;
  pills.push(`<span class="tv-pill">${total} ${total === 1 ? "result" : "results"}${searchState === "loading" ? " · Searching BBC…" : searchState === "error" ? " · BBC search failed. Showing loaded items only." : ""}</span>`);
  pills.push('<span class="tv-pill"><button type="button" data-reset-filters>Reset</button></span>');
  return pills.join("");
}
function viewInner() {
  if (!resultsActive()) return '<div class="globe-stage" role="group" tabindex="0" aria-label="Explore globe. Rotate it with the arrow keys"><div class="globe-world"></div></div>';
  const list = landingResults();
  if (!list.length) {
    return `<div class="tv-results"><div class="tv-empty"><p>${searchState === "loading" ? "Searching BBC too…" : "No results."}</p>${searchState === "loading" ? "" :
      '<p>Try another keyword or reset the filters.</p><button type="button" data-reset-filters>Reset filters</button>'}</div></div>`;
  }
  return `<div class="tv-results">${list.slice(0,60).map(card).join("")}</div>`;
}
// Updates everything except the search input, so typing never loses focus or caret.
let announceTimer = 0;
// Results are announced once typing settles, not on every keystroke.
function announceResults() {
  clearTimeout(announceTimer);
  announceTimer = setTimeout(() => {
    const live = feed?.querySelector("[data-results-live]");
    if (!live || searchState === "loading") return;
    live.textContent = resultsActive() ? `${landingResults().length} results` : "";
  },700);
}
function refreshLanding() {
  const home = feed?.querySelector(".tv-home");
  if (!home || section) return;
  home.querySelector("[data-summary]").innerHTML = summaryHtml();
  const counts = topicCounts();
  home.querySelectorAll("[data-topic]").forEach(chip => {
    const topic = chip.dataset.topic;
    chip.setAttribute("aria-pressed",selectedTopics.has(topic));
    chip.classList.toggle("is-zero",!counts[topic]);
    chip.querySelector("small").textContent = counts[topic];
  });
  home.querySelector("[data-sheet-apply]").textContent = applyLabel();
  const explore = home.querySelector(".tv-explore");
  const count = filterCount();
  let badge = explore.querySelector(".badge");
  if (count) {
    if (!badge) { badge = document.createElement("span"); badge.className = "badge"; explore.append(badge); }
    badge.textContent = count;
    badge.setAttribute("aria-label",`${count} filters applied`);
  } else badge?.remove();
  const view = home.querySelector("[data-view]");
  const mode = resultsActive() ? "results" : "globe";
  if (mode === "results" || view.dataset.mode !== mode) {
    view.dataset.mode = mode;
    view.innerHTML = viewInner();
    if (mode === "globe") mountGlobe();
  } else refreshGlobe();
  announceResults();
}
function setSheet(open) {
  sheetOpen = open;
  if (open && aboutOpen) setAbout(false);
  const home = feed?.querySelector(".tv-home");
  if (!home) return;
  home.querySelector("#tv-sheet").hidden = !open;
  if (open) home.querySelector("[data-fresh]").innerHTML = freshText();
  home.querySelector(".tv-explore").setAttribute("aria-expanded",open);
  if (open) home.querySelector("#tv-q").focus();
  else document.body.classList.remove("ui-idle");
}
function scheduleSearch() {
  clearTimeout(searchTimer);
  searchSeq++;
  const needsServer = searchQuery.trim().length >= 2 || selectedTopics.size > 0;
  searchState = needsServer ? "loading" : "";
  if (needsServer) searchTimer = setTimeout(runSearch,350);
}
async function runSearch() {
  const params = new URLSearchParams();
  const q = searchQuery.trim();
  if (q.length >= 2) params.set("q",q);
  if (selectedTopics.size) params.set("topics",[...selectedTopics].join(","));
  const key = currentKey();
  const seq = ++searchSeq;
  try {
    const result = await get("/api/search?" + params);
    if (seq !== searchSeq) return;
    searchNews = result.items;
    searchKey = key;
    searchState = "";
  } catch {
    if (seq !== searchSeq) return;
    searchNews = [];
    searchKey = "";
    searchState = "error";
  }
  if (feed?.isConnected && !section) refreshLanding();
}
function filtersChanged() {
  scheduleSearch();
  refreshLanding();
}
function resetFilters() {
  clearTimeout(searchTimer);
  searchSeq++;
  searchQuery = "";
  searchNews = [];
  searchKey = "";
  searchState = "";
  selectedTopics.clear();
  filter = "all";
  landingFilter = "all";
  visible = [];
  generation++;
  paint();
}
function landingClick(data) {
  if (data.viewMode) {
    listView = data.viewMode === "list";
    paint();
  }
  if ("aboutToggle" in data) {
    if (!aboutOpen && sheetOpen) setSheet(false);
    setAbout(!aboutOpen);
  }
  if ("sheetToggle" in data) setSheet(!sheetOpen);
  if ("sheetApply" in data) setSheet(false);
  if (data.topic) {
    if (selectedTopics.has(data.topic)) selectedTopics.delete(data.topic);
    else selectedTopics.add(data.topic);
    filtersChanged();
  }
  if ("removeTopic" in data) { selectedTopics.delete(data.removeTopic); filtersChanged(); }
  if ("removeQuery" in data) {
    searchQuery = "";
    const input = feed.querySelector("#tv-q");
    if (input) input.value = "";
    filtersChanged();
  }
  if ("removeType" in data) {
    filter = "all";
    landingFilter = "all";
    visible = [];
    generation++;
    paint();
  }
  if ("resetFilters" in data) resetFilters();
}
document.addEventListener("input",event => {
  if (event.target.id !== "tv-q") return;
  searchQuery = event.target.value;
  filtersChanged();
});
document.addEventListener("submit",event => {
  if (!event.target.matches?.("[data-tv-search]")) return;
  event.preventDefault();
  setSheet(false);
});
document.addEventListener("keydown",event => {
  if (!feed?.isConnected || section) return;
  if (event.key === "Escape") {
    if (event.target.id === "tv-q" && event.target.value) {
      event.target.value = "";
      searchQuery = "";
      filtersChanged();
    } else if (aboutOpen && !overlay.open) {
      setAbout(false);
      feed.querySelector("[data-about-toggle]")?.focus();
    } else if (sheetOpen && !overlay.open) {
      setSheet(false);
      feed.querySelector(".tv-explore")?.focus();
    }
    return;
  }
  const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target.tagName);
  if (event.key === "/" && !typing && !overlay.open && !document.querySelector("dialog[open]")) {
    event.preventDefault();
    setSheet(true);
  }
});
document.addEventListener("pointerdown",event => {
  if (aboutOpen && feed?.isConnected && !section && !event.target.closest(".tv-about,.tv-about-btn")) setAbout(false);
  if (sheetOpen && feed?.isConnected && !section && !event.target.closest(".tv-sheet,.tv-dock")) setSheet(false);
},true);
// Dim the dock and summary while the pointer is idle so the globe stays the main thing.
function wake() {
  document.body.classList.remove("ui-idle");
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => { if (!sheetOpen) document.body.classList.add("ui-idle"); },3500);
}
for (const type of ["pointermove","pointerdown","keydown","touchstart"]) document.addEventListener(type,wake,{passive:true});
wake();

// ---- Landing globe -------------------------------------------------------
// Cards sit on a huge sphere seen from outside, so the front keeps the convex
// "bulging screen" look. Both axes wrap around 360 degrees: horizontally the
// columns close into a ring, vertically the rows are shifted modulo a period
// that is larger than the visible cap, so the seam is never on screen and
// scrolling never reaches an end. Items repeat when there are fewer than slots.
const DEG = Math.PI/180;
const CAP = Math.cos(66*DEG);
const NEAR = Math.cos(38*DEG);
const DRIFT = 0; // idle rotation is off; the globe only moves when dragged, scrolled or flicked
const globe = {stage:null,world:null,slots:[],live:new Map(),list:[],offLon:0,offLat:0,velLon:0,velLat:0,
  last:0,raf:0,hover:false,drag:null,speed:1,R:0,w:0,h:0,stepC:1,stepR:1,latPeriod:360,dirty:false};
let globePages = 0;

function coprime(n,seed) {
  const gcd = (a,b) => b ? gcd(b,a%b) : a;
  let step = Math.max(1,Math.round(n*seed));
  while (gcd(step,n) !== 1) step++;
  return step;
}
function wrap(value,period) {
  return ((value + period/2) % period + period) % period - period/2;
}
function pickItem(slot) {
  const n = globe.list.length;
  return n ? globe.list[(slot.col*globe.stepC + slot.row*globe.stepR) % n] : null;
}
function buildGlobe() {
  const {stage,world} = globe;
  if (!stage?.isConnected) return;
  const width = stage.clientWidth || innerWidth;
  const narrow = width < 700;
  const w = Math.round(width*(narrow ? .46 : .27));
  const h = Math.round(w/1.62);
  const gap = Math.round(w*.06);
  const R = Math.round(width);
  Object.assign(globe,{w,h,R});
  stage.style.perspective = Math.round(R*1.2) + "px";
  world.style.transform = `translateZ(${-R}px)`;
  world.replaceChildren();
  globe.live.clear();
  const rowStep = (h+gap)/R/DEG;
  const rows = Math.max(8,Math.round(150/rowStep/2)*2);
  const cols = Math.max(6,Math.floor(2*Math.PI*R/(w+gap)));
  globe.latPeriod = rows*rowStep;
  const slots = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      slots.push({id:slots.length,col:c,row:r,
        lat:(r - rows/2)*rowStep,lon:c/cols*360});
    }
  }
  globe.slots = slots;
  globe.dirty = true;
}
function setGlobeList() {
  globe.list = items();
  globe.stepC = coprime(globe.list.length || 1,.618);
  globe.stepR = coprime(globe.list.length || 1,.382);
}
function mountGlobe() {
  const stage = feed?.querySelector(".globe-stage");
  if (!stage) return;
  globe.stage = stage;
  globe.world = stage.querySelector(".globe-world");
  setGlobeList();
  buildGlobe();
  bindGlobe(stage);
  if (!globe.raf) globe.raf = requestAnimationFrame(tickGlobe);
  if (ready) globeMore();
}
function refreshGlobe() {
  setGlobeList();
  globe.dirty = true;
}
// Keep pulling later video pages in the background so the sphere has more to show.
function globeMore() {
  if (pending || !next || globePages >= 4 || filter === "news" || filter === "read") return;
  globePages++;
  const token = next;
  pending = get("/api/videos?cursor=" + encodeURIComponent(token)).then(result => {
    videos = merge(videos,result.items);
    next = result.next === token ? null : result.next;
  }).catch(() => {}).finally(() => {
    pending = undefined;
    if (feed?.isConnected && !section) { refreshGlobe(); globeMore(); }
  });
}
function bindGlobe(stage) {
  stage.addEventListener("pointerdown",event => {
    if (event.button !== 0 || overlay.open) return;
    suppressClick = false;
    globe.drag = {id:event.pointerId,x:event.clientX,y:event.clientY,lx:event.clientX,ly:event.clientY,t:performance.now(),active:false};
  });
  stage.addEventListener("pointermove",event => {
    const d = globe.drag;
    if (!d) { globe.hover = event.pointerType === "mouse" && !!event.target.closest(".tv-card"); return; }
    if (event.pointerId !== d.id) return;
    if (!d.active) {
      if (Math.hypot(event.clientX-d.x,event.clientY-d.y) < 6) return;
      d.active = true;
      stage.setPointerCapture(event.pointerId);
      stage.classList.add("is-dragging");
    }
    const now = performance.now();
    const dt = Math.max(.001,(now-d.t)/1000);
    const dx = (event.clientX-d.lx)/globe.R/DEG, dy = (event.clientY-d.ly)/globe.R/DEG;
    globe.offLon += dx;
    globe.offLat -= dy;
    globe.velLon = dx/dt;
    globe.velLat = -dy/dt;
    Object.assign(d,{lx:event.clientX,ly:event.clientY,t:now});
  });
  const end = event => {
    const d = globe.drag;
    if (!d || event.pointerId !== d.id) return;
    suppressClick = d.active;
    if (performance.now()-d.t > 90) globe.velLon = globe.velLat = 0;
    globe.drag = null;
    stage.classList.remove("is-dragging");
  };
  stage.addEventListener("pointerup",end);
  stage.addEventListener("pointercancel",end);
  stage.addEventListener("pointerleave",() => { globe.hover = false; });
  stage.addEventListener("keydown",event => {
    if (event.key === "Home") { event.preventDefault(); globe.offLon = 0; globe.offLat = 0; return; }
    const step = event.shiftKey ? 24 : 8;
    const move = {ArrowLeft:[step,0],ArrowRight:[-step,0],ArrowUp:[0,-step],ArrowDown:[0,step]}[event.key];
    if (!move || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    if (document.activeElement !== stage) stage.focus({preventScroll:true});
    globe.offLon += move[0];
    globe.offLat += move[1];
  });
  stage.addEventListener("wheel",event => {
    event.preventDefault();
    globe.velLon -= event.deltaX/globe.R/DEG*4;
    globe.velLat += event.deltaY/globe.R/DEG*4;
  },{passive:false});
}
function tickGlobe(now) {
  globe.raf = 0;
  const {stage,world} = globe;
  if (!stage?.isConnected || !feed?.isConnected || section) return;
  globe.raf = requestAnimationFrame(tickGlobe);
  const dt = Math.min(.05,(now-globe.last)/1000 || .016);
  globe.last = now;
  const still = matchMedia("(prefers-reduced-motion: reduce)").matches || document.hidden;
  if (!globe.drag) {
    const target = globe.hover || still || overlay.open ? 0 : 1;
    globe.speed += (target-globe.speed)*Math.min(1,dt*3);
    globe.offLon += globe.velLon*dt - DRIFT*dt*globe.speed;
    globe.offLat += globe.velLat*dt;
    const damp = Math.exp(-2.6*dt);
    globe.velLon *= damp;
    globe.velLat *= damp;
  }
  globe.offLon = wrap(globe.offLon,360);
  globe.offLat = wrap(globe.offLat,globe.latPeriod);
  if (globe.dirty) { world.replaceChildren(); globe.live.clear(); globe.dirty = false; }
  const fragment = document.createDocumentFragment();
  for (const slot of globe.slots) {
    const lon = wrap(slot.lon + globe.offLon,360);
    const lat = wrap(slot.lat + globe.offLat,globe.latPeriod);
    const front = Math.cos(lon*DEG)*Math.cos(lat*DEG) > CAP;
    let el = globe.live.get(slot.id);
    if (front && globe.list.length) {
      if (!el) {
        const holder = document.createElement("template");
        holder.innerHTML = card(pickItem(slot));
        el = holder.content.firstElementChild;
        el.classList.add("globe-card");
        el.style.cssText = `width:${globe.w}px;height:${globe.h}px;left:${-globe.w/2}px;top:${-globe.h/2}px`;
        globe.live.set(slot.id,el);
        fragment.append(el);
      }
      el.style.transform = `rotateY(${lon}deg) rotateX(${lat}deg) translateZ(${globe.R}px) scale(${Math.max(.6,Math.cos(lat*DEG))})`;
      const near = Math.cos(lon*DEG)*Math.cos(lat*DEG) > NEAR;
      if (el.dataset.near !== String(near)) { el.dataset.near = String(near); el.tabIndex = near ? 0 : -1; }
    } else if (el) {
      el.remove();
      globe.live.delete(slot.id);
    }
  }
  if (fragment.childNodes.length) world.append(fragment);
}
window.addEventListener("resize",() => { if (globe.stage?.isConnected) buildGlobe(); });

export function renderMedia(root, key, view = "") {
  observer?.disconnect();
  if (feed !== root || section !== view) {
    wallOffset = 0;
    scrapPage = 1;
    scrapQuery = "";
    scrapType = "all";
    scrapTopics.clear();
    section = view;
    filter = view === "home" ? homeFilter : view || landingFilter;
    visible = [];
    notice = "";
    generation++;
  }
  feed = root;
  paint();
  if (!ready && section !== "scraps") loadFirst();
  if (key) {
    const item = [...news,...videos,...reads,...globe.list].find(item => item.id === key);
    if (item) {
      if (!overlay.open) showDetail(item);
      return;
    }
    if (!ready) loadFirst().then(() => {
      if (feed?.isConnected && location.hash.startsWith("#tv/")) renderMedia(feed,key,view);
    });
    else feed.querySelector(".tv-home").insertAdjacentHTML("afterbegin",'<p class="tv-message">This item could not be found.</p>');
  }
}
export function setLandingFilter(value) {
  landingFilter = value;
}
export async function homeItems() {
  if (!ready) await loadFirst();
  return {news,videos};
}
export function leaveMedia() {
  observer?.disconnect();
  if (overlay.open) overlay.close();
  feed = null;
}
export function mediaClick(button) {
  const data = button.dataset;
  if (!section) landingClick(data);
  if (data.pageKey === "scrap") {
    scrapPage = Number(data.page);
    paint();
    window.scrollTo({top:0});
    return;
  }
  if (data.scrapType) {
    scrapType = data.scrapType;
    scrapPage = 1;
    refreshScraps();
  }
  if (data.scrapTopic) {
    if (scrapTopics.has(data.scrapTopic)) scrapTopics.delete(data.scrapTopic);
    else scrapTopics.add(data.scrapTopic);
    scrapPage = 1;
    refreshScraps();
  }
  if ("scrapReset" in data) {
    scrapQuery = "";
    scrapType = "all";
    scrapTopics.clear();
    scrapPage = 1;
    paint();
  }
  if (data.tvFilter) {
    filter = data.tvFilter;
    if (section === "home") homeFilter = filter;
    else landingFilter = filter;
    visible = [];
    notice = "";
    generation++;
    paint();
    feed.querySelector(`[data-tv-filter="${filter}"]`)?.focus();
  }
  if (data.media) {
    lastFocus = data.media;
    const item = [...items(),...globe.list].find(item => item.id === data.media);
    if (item) showDetail(item,button.querySelector(".tv-screen").getBoundingClientRect());
  }
  if ("more" in data) more();
  if ("reload" in data) {
    visible = [];
    loadFirst();
  }
}
// A mouse wheel over a chip row scrolls it sideways (the row has no scrollbar).
document.addEventListener("wheel",event => {
  const row = event.target.closest?.(".tv-topics,.scrap-topics");
  if (!row || row.scrollWidth <= row.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  row.scrollLeft += event.deltaY;
  event.preventDefault();
},{passive:false});
// Chip rows can also be dragged with the mouse (the thin scrollbar is hard to grab). A drag never counts as a click on a chip.
let dragRow = null, dragX = 0, dragLeft = 0, dragMoved = false;
document.addEventListener("pointerdown",event => {
  if (event.pointerType !== "mouse" || event.button !== 0) return;
  const row = event.target.closest?.(".tv-topics,.scrap-topics");
  if (!row || row.scrollWidth <= row.clientWidth) return;
  dragRow = row; dragX = event.clientX; dragLeft = row.scrollLeft; dragMoved = false;
});
document.addEventListener("pointermove",event => {
  if (!dragRow) return;
  const dx = event.clientX - dragX;
  if (!dragMoved && Math.abs(dx) > 5) { dragMoved = true; dragRow.classList.add("is-dragging"); }
  if (dragMoved) dragRow.scrollLeft = dragLeft - dx;
});
const endDrag = () => {
  if (!dragRow) return;
  const row = dragRow;
  dragRow = null;
  row.classList.remove("is-dragging");
  if (!dragMoved) return;
  const stop = event => event.stopPropagation();
  row.addEventListener("click",stop,{capture:true,once:true});
  setTimeout(() => row.removeEventListener("click",stop,true),0);
};
document.addEventListener("pointerup",endDrag);
document.addEventListener("pointercancel",endDrag);
