import {readLocal,writeLocal} from "./data.js";
import {pagerHtml,pageCount,PER_PAGE} from "./pager.js";

const LIMIT = 12;
const filters = {all:"전체",news:"BBC 뉴스",video:"영어 영상",scraps:"내 스크랩"};
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
let homeFilter = "all";
let frame = 0;
let wallOffset = 0;
let drag;
let suppressClick = false;
const overlay = document.querySelector("#tv-overlay");
let selectedItem;
let scraps = readLocal("media-scraps",[]);
let scrapPage = 1;
function scrapSlice() {
  scrapPage = Math.min(Math.max(1,scrapPage),pageCount(scraps.length));
  const start = (scrapPage - 1) * PER_PAGE;
  return scraps.slice(start,start + PER_PAGE);
}

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
  if (remaining.length >= LIMIT || (remaining.length && (!next || filter === "news" || filter === "scraps"))) {
    visible.push(...remaining.slice(0,LIMIT));
    appendCards();
    return;
  }
  if (!next || filter === "news" || filter === "scraps") return;
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
    foot.innerHTML = pagerHtml("scrap",scrapPage,pageCount(scraps.length));
    return;
  }
  if (section === "home") {
    foot.innerHTML = pending ? "불러오는 중…" : '<a href="#videos">영상 더 보기 ↗</a><a href="#news">기사 더 보기 ↗</a>';
    return;
  }
  const moreAvailable = items().length > visible.length || (["all","video"].includes(filter) && next);
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
  if (section === "scraps") visible = scrapSlice();
  if (!visible.length) {
    visible = section === "home" && filter === "all"
      ? [...videos.slice(0,3),...news.slice(0,3)]
      : items().slice(0,section === "home" ? 6 : LIMIT);
  }
  const messages = section === "scraps" ? [] : [
    filter !== "video" && newsError ? "BBC 뉴스를 불러오지 못했어요." : "",
    filter !== "news" && videoError ? "영어 영상을 불러오지 못했어요." : "",
    ready && filter === "video" && !videoConfigured && !videoError ? "영어 영상 목록을 아직 불러올 수 없어요." : ""
  ].filter(Boolean);
  const controls = Object.entries(filters).filter(([id]) => id !== "scraps").map(([id,label]) => `<button data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("");
  const keepSearchFocus = document.activeElement?.id === "tv-q";
  const caret = keepSearchFocus ? document.activeElement.selectionStart : 0;
  feed.innerHTML = `<section class="tv-home"><div class="tv-intro"><h1>${section === "home" ? "영상·기사" : filters[section] ?? "둘러보기"}</h1></div>
    ${section === "home" ? `<nav class="tv-filters home-tv-tabs" aria-label="영상 및 기사">${controls}</nav>` : ""}
    ${!section ? `<div class="tv-summary" data-summary role="status" aria-live="polite">${summaryHtml()}</div>` : ""}
    ${section === "scraps" ? '<a class="back" href="#explore">← 둘러보기</a>' : ""}
    ${messages.length ? `<div class="tv-message">${messages.join(" ")} <button data-reload>다시 시도</button></div>` : ""}
    ${section ? `<div class="tv-grid">${visible.map(card).join("")}</div>` : `<div class="tv-view" data-view data-mode="${resultsActive() ? "results" : "globe"}">${viewInner()}</div>`}
    ${(ready || section === "scraps") && !visible.length && !messages.length && (section || !resultsActive()) ? '<p class="tv-message">표시할 콘텐츠가 없어요.</p>' : ""}
    ${!section ? sheetHtml() + dockHtml() : ""}
    <div class="tv-footer" role="status"></div></section>`;
  paintFooter();
  bendWall();
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
  return `<section class="tv-detail"><button type="button" class="tv-close" aria-label="닫기">✕</button>
    ${item.type === "video" ? `<iframe class="tv-player" title="${escape(item.title)}" src="https://www.youtube-nocookie.com/embed/${escape(item.id)}" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen referrerpolicy="strict-origin-when-cross-origin"></iframe>` : screen(item,true)}
    <div class="tv-detail-copy"><p class="tv-label">${escape(item.source)} · ${date(item)}</p>
    <h1 lang="en">${escape(item.title)}</h1>
    <div class="row"><a class="tv-out" href="${escape(item.url)}" target="_blank" rel="noopener noreferrer">${item.type === "video" ? "YouTube에서 열기" : "BBC 원문 읽기"} ↗</a>
    <button type="button" class="tv-action" data-write-source>＋ 글쓰기</button>
    <button type="button" class="tv-action" data-scrap aria-label="스크랩" aria-pressed="${saved}" title="${saved ? "스크랩 해제" : "스크랩"}"><span class="bookmark-icon" aria-hidden="true"></span></button></div></div></section>`;
}
function showDetail(item, origin) {
  selectedItem = item;
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
  if (selectedItem && event.target.closest("[data-write-source]")) {
    overlay.close();
    overlay.dispatchEvent(new CustomEvent("write-media",{detail:selectedItem}));
  }
  const scrapButton = event.target.closest("[data-scrap]");
  if (selectedItem && scrapButton) {
    const key = scrapKey(selectedItem);
    const saved = scraps.some(item => scrapKey(item) === key);
    scraps = saved ? scraps.filter(item => scrapKey(item) !== key) : [selectedItem,...scraps];
    writeLocal("media-scraps",scraps);
    scrapButton.setAttribute("aria-pressed",String(!saved));
    scrapButton.title = saved ? "스크랩" : "스크랩 해제";
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
const TOPICS = ["AI·테크","경제·금융","무역","에너지·기후","헬스·바이오","식품·뷰티","교육","엔터·문화","정치·국제","사회·생활"];
const selectedTopics = new Set();
let sheetOpen = false;
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
  return searchTerms().length > 0 || selectedTopics.size > 0;
}
function typeOk(item) {
  return filter === "news" ? item.type === "news" : filter === "video" ? item.type === "video" : true;
}
function currentKey() {
  const q = searchQuery.trim();
  return JSON.stringify([q.length >= 2 ? norm(q) : "",[...selectedTopics].sort()]);
}
// A: items already loaded, matched by title. B: BBC section feeds via /api/search,
// used only while they belong to the filters that are on screen right now.
function baseResults() {
  const terms = searchTerms();
  const local = [...news,...videos].filter(item => terms.every(term => norm(item.title).includes(term)));
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
  return resultsActive() ? `결과 ${landingResults().length}개 보기` : "닫기";
}
function typeControls() {
  return Object.entries(filters).filter(([id]) => id !== "scraps")
    .map(([id,label]) => `<button type="button" data-tv-filter="${id}" aria-pressed="${id === filter}">${label}</button>`).join("");
}
function dockHtml() {
  const count = filterCount();
  return `<nav class="tv-dock" aria-label="둘러보기 메뉴"><button type="button" class="tv-explore" data-sheet-toggle aria-expanded="${sheetOpen}" aria-controls="tv-sheet">탐색${count ? `<span class="badge" aria-label="적용된 필터 ${count}개">${count}</span>` : ""}</button><a href="#home">홈</a><a href="#scraps">내 스크랩</a><a href="#feed">게시판</a><a href="#words">단어장</a><button type="button" data-tv-write>＋ 글쓰기</button></nav>`;
}
function sheetHtml() {
  const counts = topicCounts();
  return `<div class="tv-sheet" id="tv-sheet" role="dialog" aria-label="탐색 필터" ${sheetOpen ? "" : "hidden"}>
    <form role="search" data-tv-search><input id="tv-q" type="search" name="q" placeholder="뉴스·영상 검색  ( / )" autocomplete="off" enterkeyhint="search" aria-label="뉴스와 영상 검색" maxlength="60"></form>
    <div class="tv-sheet-row"><div class="tv-seg" role="group" aria-label="유형">${typeControls()}</div><button type="button" class="tv-link" data-reset-filters>초기화</button></div>
    <div class="tv-topics" role="group" aria-label="주제">${TOPICS.map(topic =>
      `<button type="button" class="tv-chip${counts[topic] ? "" : " is-zero"}" data-topic="${topic}" aria-pressed="${selectedTopics.has(topic)}">${topic}<small>${counts[topic]}</small></button>`).join("")}</div>
    <button type="button" class="tv-apply" data-sheet-apply>${applyLabel()}</button>
  </div>`;
}
function summaryHtml() {
  if (!resultsActive() && filter === "all") return "";
  const pills = [];
  if (searchTerms().length) pills.push(`<span class="tv-pill">“${escape(searchQuery.trim())}” <button type="button" data-remove-query aria-label="검색어 해제">✕</button></span>`);
  for (const topic of selectedTopics) pills.push(`<span class="tv-pill">${escape(topic)} <button type="button" data-remove-topic="${escape(topic)}" aria-label="${escape(topic)} 해제">✕</button></span>`);
  if (filter !== "all") pills.push(`<span class="tv-pill">${filters[filter]} <button type="button" data-remove-type aria-label="유형 해제">✕</button></span>`);
  const total = resultsActive() ? landingResults().length : items().length;
  pills.push(`<span class="tv-pill">결과 ${total}개${searchState === "loading" ? " · BBC 기사 찾는 중…" : searchState === "error" ? " · BBC 검색 실패, 불러온 자료만" : ""}</span>`);
  pills.push('<span class="tv-pill"><button type="button" data-reset-filters>초기화</button></span>');
  return pills.join("");
}
function viewInner() {
  if (!resultsActive()) return '<div class="globe-stage" aria-label="학습 자료 지구본"><div class="globe-world"></div></div>';
  const list = landingResults();
  if (!list.length) {
    return `<div class="tv-results"><div class="tv-empty"><p>${searchState === "loading" ? "BBC 기사까지 찾는 중이에요…" : "결과가 없어요."}</p>${searchState === "loading" ? "" :
      '<p>다른 키워드를 쓰거나 필터를 초기화해 보세요.</p><button type="button" data-reset-filters>필터 초기화</button>'}</div></div>`;
  }
  return `<div class="tv-results">${list.slice(0,60).map(card).join("")}</div>`;
}
// Updates everything except the search input, so typing never loses focus or caret.
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
    badge.setAttribute("aria-label",`적용된 필터 ${count}개`);
  } else badge?.remove();
  const view = home.querySelector("[data-view]");
  const mode = resultsActive() ? "results" : "globe";
  if (mode === "results" || view.dataset.mode !== mode) {
    view.dataset.mode = mode;
    view.innerHTML = viewInner();
    if (mode === "globe") mountGlobe();
  } else refreshGlobe();
}
function setSheet(open) {
  sheetOpen = open;
  const home = feed?.querySelector(".tv-home");
  if (!home) return;
  home.querySelector("#tv-sheet").hidden = !open;
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
  if (pending || !next || globePages >= 4 || filter === "news") return;
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
    const item = [...news,...videos,...globe.list].find(item => item.id === key);
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
