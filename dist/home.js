import {homeItems,TOPICS} from "./media.js";
import {readLocal,writeLocal} from "./data.js";

// 홈 screen: a photo of four stacked analog TVs. The four black screens are real
// areas of the photo (found by flood-filling the dark regions), so each one is an
// anchor clipped to that shape, filled with a news/video thumbnail and CRT effects.
const SCREENS = [{"x":0.2943,"y":0.0865,"w":0.2648,"h":0.1738,"poly":[[0.0,3.0],[4.3,2.0],[6.9,1.5],[12.0,1.0],[25.8,0.0],[96.1,0.0],[98.3,0.5],[99.6,11.3],[99.6,63.1],[99.1,96.1],[94.8,96.6],[77.3,97.5],[42.9,99.0],[18.9,99.5],[0.0,99.5]]},{"x":0.4511,"y":0.3108,"w":0.2716,"h":0.1627,"poly":[[0.0,38.4],[0.4,23.7],[0.8,12.6],[1.3,10.0],[1.7,7.9],[2.9,6.3],[9.2,0.5],[55.6,0.0],[84.5,0.0],[89.5,0.5],[97.5,2.1],[99.6,32.1],[99.6,66.3],[98.3,82.6],[96.2,89.5],[94.6,92.6],[93.7,93.7],[90.4,95.3],[87.0,96.3],[77.0,98.4],[67.8,99.5],[41.8,99.5],[32.2,98.4],[15.1,95.8],[10.5,94.7],[8.8,94.2],[6.3,93.2],[4.6,92.1],[2.9,90.5],[0.4,66.3],[0.0,61.6]]},{"x":0.3568,"y":0.5257,"w":0.3091,"h":0.1695,"poly":[[0.0,8.1],[1.5,1.0],[4.4,0.5],[9.6,0.0],[98.5,0.0],[98.9,2.0],[99.6,16.2],[99.6,94.9],[98.5,96.5],[52.9,99.0],[40.4,99.5],[20.6,98.0],[0.4,95.5],[0.0,94.9]]},{"x":0.4216,"y":0.7457,"w":0.2682,"h":0.1627,"poly":[[0.0,16.8],[1.3,8.9],[3.8,6.8],[5.9,5.8],[17.8,2.6],[33.9,1.1],[44.9,0.0],[80.1,0.0],[98.7,0.5],[99.6,2.1],[99.6,71.6],[99.2,84.2],[93.2,90.5],[91.1,92.1],[90.3,92.6],[82.2,95.3],[78.0,96.3],[69.9,97.9],[55.9,99.5],[23.7,99.5],[11.9,98.4],[3.8,95.3],[3.0,94.2],[2.1,89.5],[1.7,84.7],[0.0,33.7]]}];
const ASPECT = 0.75342;
const escape = value => String(value ?? "").replace(/[&<>"']/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const byDate = (a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
let timer = 0;
let pool = [];
let lastCtx = null;
let prefsOpen = false;
const getPrefs = () => { const saved = readLocal("home-topics",[]); return Array.isArray(saved) ? saved.filter(topic => TOPICS.includes(topic)) : []; };
function prefsHtml() {
  const prefs = getPrefs();
  return `<button type="button" class="pp-gear" data-prefs-toggle aria-haspopup="dialog" aria-expanded="${prefsOpen}" aria-label="기사 설정${prefs.length ? ` (주제 ${prefs.length}개 선택됨)` : ""}" data-tip="기사 설정"><span class="ic gear" aria-hidden="true"></span></button>
  <div class="pp-prefs" role="dialog" aria-labelledby="prefs-title" ${prefsOpen ? "" : "hidden"}>
    <div class="dialog-head"><h2 id="prefs-title">내 관심 기사</h2><button type="button" data-prefs-toggle data-close aria-label="관심 기사 설정 닫기">✕</button></div>
    <p class="hint" aria-live="polite">${prefs.length ? `주제 ${prefs.length}개 선택됨 · 홈의 TV와 아래 띠에 먼저 나와요.` : "주제를 고르면 그 기사가 홈의 TV와 아래 띠에 먼저 나와요. 이 브라우저에만 저장돼요."}</p>
    <div class="pp-prefs-topics" role="group" aria-label="주제">${TOPICS.map(topic => `<button type="button" class="chip" data-pref-topic="${escape(topic)}" aria-pressed="${prefs.includes(topic)}">${escape(topic)}</button>`).join("")}</div>
    <div class="row"><button type="button" data-prefs-reset>초기화</button></div>
  </div>`;
}
const DAY = 86400000;
const compact = new Intl.NumberFormat("ko-KR",{notation:"compact"}).format;

function screenHtml(screen,index) {
  const clip = screen.poly.map(([x,y]) => `${x}% ${y}%`).join(",");
  return `<a class="pile-screen is-static" data-pile="${index}" href="#explore"
    style="left:${screen.x*100}%;top:${screen.y*100}%;width:${screen.w*100}%;height:${screen.h*100}%;clip-path:polygon(${clip})"
    aria-label="신호를 기다리는 TV"><span class="ps-img"></span><span class="ps-static" aria-hidden="true"></span></a>`;
}
function setNow(screen) {
  const line = screen.closest(".tv-pile")?.querySelector(".pile-now");
  const [kind = "",title = "",tag = ""] = (screen.dataset.cap || "").split("|");
  if (line) line.innerHTML = title ? `<small>${escape(kind)}</small>${escape(title)}${tag ? `<small class="pile-tag">#${escape(tag)}</small>` : ""}` : "";
}
function clearNow(screen) {
  const line = screen.closest(".tv-pile")?.querySelector(".pile-now");
  if (line) line.innerHTML = "";
}
function template() {
  return `<section class="home-scene" aria-labelledby="home-title">
    <div class="home-copy">
      <h1 id="home-title" lang="en">axciting</h1>
      <p>영어 기사와 영상을 보고,<br>기억하고 싶은 문장을 남겨요.</p>
      <div class="home-actions">
        <a class="home-primary" href="#explore">둘러보기<span class="ar r" aria-hidden="true"></span></a>
      </div>
      <nav class="home-links" aria-label="바로 가기"><a href="#feed">게시판</a><a href="#words">단어장</a><a href="#scraps">내 스크랩</a></nav>
    </div>
    <div class="tv-pile" style="--pile-aspect:${ASPECT}">
      <img class="tv-pile-img" src="./img/tv-pile.jpg" alt="낡은 아날로그 TV 네 대가 쌓여 있는 모습" width="880" height="1168" fetchpriority="high">
      ${SCREENS.map(screenHtml).join("")}
      <p class="pile-now" aria-live="polite"></p>
    </div>
  </section>`;
}
function interleave(news,videos) {
  const a = [...news].sort(byDate), b = [...videos].sort(byDate);
  const out = [];
  for (let i = 0; i < Math.max(a.length,b.length) && out.length < 16; i++) {
    if (a[i]) out.push(a[i]);
    if (b[i]) out.push(b[i]);
  }
  return out;
}
function preload(url) {
  return new Promise(resolve => {
    if (!url) return resolve("");
    const image = new Image();
    image.onload = () => resolve(url);
    image.onerror = () => resolve("");
    image.src = url;
  });
}
async function thumbnail(item) {
  if (item.type === "video") return (await preload((item.image || "").replace("hqdefault","mqdefault"))) || preload(item.image);
  return (await preload((item.image || "").replace("/standard/240/","/standard/624/"))) || preload(item.image);
}
async function show(screen,item) {
  screen.classList.add("is-static");
  const url = await thumbnail(item);
  screen.href = "#tv/" + encodeURIComponent(item.id);
  screen.setAttribute("aria-label",`${item.title} 열기`);
  screen.dataset.item = item.id;
  screen.dataset.kind = item.type;
  screen.title = item.title + (item.views ? ` · 조회 ${compact(item.views)}` : "");
  screen.querySelector(".ps-img").style.backgroundImage = url ? `url("${url}")` : "";
  screen.dataset.cap = `${item.type === "video" ? "영어 영상" : "BBC 뉴스"}${item.views ? ` · 조회 ${compact(item.views)}` : ""}|${item.title}|${item.topics?.[0] ?? ""}`;
  setTimeout(() => screen.classList.remove("is-static"),260);
}
// The four TVs: newest news, most-viewed recent video, second news, second video.
// "Recent" = uploaded within the last two days; YouTube only reports lifetime views.
function pickScreens(news,videos) {
  const byViews = (x,y) => (y.views ?? 0) - (x.views ?? 0);
  const newest = [...news].sort(byDate);
  const topVideos = videos.filter(video => Date.now() - Date.parse(video.date) <= 2 * DAY).sort(byViews);
  for (const video of [...videos].sort(byDate)) {
    if (topVideos.length < 2 && !topVideos.includes(video)) topVideos.push(video);
  }
  const order = [newest[0],topVideos[0],newest[1],topVideos[1]].filter(Boolean);
  for (const item of interleave(news,videos)) {
    if (order.length >= 4) break;
    if (!order.includes(item)) order.push(item);
  }
  return order;
}
function upgrade(url) {
  return (url || "").replace("/standard/240/","/standard/624/");
}
// Swiss-poster section under the TV room: asymmetric grid, tiny text columns, big
// dates and words, a vertical menu, and black-and-white thumbnails bleeding off the bottom.
function fillPoster(root,ctx) {
  const paper = root.querySelector(".home-paper");
  if (!paper || !ctx) return;
  lastCtx = ctx;
  const news = pool.filter(item => item.type === "news").slice(0,2);
  const picks = (pool.length > 9 ? pool.slice(4,9) : pool.slice(0,5));
  const link = item => `#tv/${encodeURIComponent(item.id)}`;
  const posts = ctx.loading ? '<p>불러오는 중이에요.</p>' : ctx.error ? `<p>${escape(ctx.error)}</p>` :
    ctx.posts.length ? ctx.posts.map(post => `<p><a href="#post/${escape(post.id)}">${escape(post.title)}</a><br>${escape(post.by)} · ${escape(post.date)}</p>`).join("") :
    '<p>아직 올라온 노트가 없어요.</p>';
  const newsHtml = news.length ? news.map(item => `<p><a href="${link(item)}">${escape(item.title)}</a></p>`).join("") : '<p>자료를 불러오는 중이에요.</p>';
  const words = ctx.loading ? '<div><span>…</span></div>' : ctx.words.length ?
    ctx.words.map(word => `<div><span lang="en">${escape(word.term)}</span><small>${escape(word.meaning)}</small></div>`).join("") :
    '<div><span>—</span><small>아직 단어가 없어요</small></div>';
  paper.innerHTML = `
    <div class="pp-rail">
      <div class="pp-rail-top">
        <p><span class="pp-k">이번 주 노트</span>조원 ${ctx.memberCount}명<br>노트 ${ctx.postCount}개<br>단어 ${ctx.wordCount}개</p>
        <p><span class="pp-k">출처</span>BBC News<br>BBC Learning English</p>
      </div>
      <div class="pp-dates">${escape(ctx.today.label)}<span>${ctx.today.year}</span></div>
      <div class="pp-rail-foot">${ctx.shared ? "" : '<p class="pp-note">체험 모드<br>예시 데이터예요.</p>'}</div>
    </div>
    <div class="pp-main">
      <div class="pp-main-head">
        <h2 id="paper-title" class="pp-title">이번 주<br>영어 공부</h2>
        <p class="pp-sub">기사와 영상을 보고, 기억하고 싶은 문장을 한 줄씩 남겨요.</p>
      </div>
      <div class="pp-cols">
        <div><h3>최근 노트</h3>${posts}<a class="pp-more" href="#feed">노트 더 보기<span class="ar ne" aria-hidden="true"></span></a></div>
        <div><h3>새로 올라온 뉴스</h3>${newsHtml}<a class="pp-more" href="#explore">뉴스 더 보기<span class="ar ne" aria-hidden="true"></span></a></div>
      </div>
      <div class="pp-words"><h3>이번 주 단어</h3>${words}<a class="pp-more" href="#words/list">단어 목록 열기<span class="ar ne" aria-hidden="true"></span></a></div>
    </div>
    <p class="strip-now" aria-hidden="true"></p>
    ${prefsHtml()}
    <div class="pp-strip" aria-label="이번 주 뉴스와 영상">${picks.map(item =>
      `<a href="${link(item)}" aria-label="${escape(item.title)}" data-title="${escape(item.title)}"${item.topics?.[0] ? ` data-tag="${escape(item.topics[0])}"` : ""}><img src="${escape(item.type === "video" ? (item.image || "").replace("hqdefault","mqdefault") : upgrade(item.image))}" data-fallback="${escape(item.image)}" alt="" loading="lazy"></a>`).join("")}</div>`;
}
export function leaveHome() {
  clearInterval(timer);
  timer = 0;
}
export function renderHome(root,ctx) {
  if (root.querySelector(".home-scene")) {
    fillPoster(root,ctx);
    return;
  }
  leaveHome();
  root.innerHTML = `<div class="home-page">${template()}<section class="home-paper" aria-labelledby="paper-title"></section></div>`;
  if (!root.dataset.homeBound) {
    root.dataset.homeBound = "1";
    root.addEventListener("error",event => {
      const image = event.target;
      if (image.matches?.(".pp-strip img") && image.dataset.fallback) { image.src = image.dataset.fallback; delete image.dataset.fallback; }
    },true);
    root.addEventListener("keydown",event => {
      if (event.key === "Escape" && prefsOpen) {
        prefsOpen = false;
        fillPoster(root,lastCtx);
        root.querySelector(".pp-gear")?.focus();
      }
    });
    const stripNow = (event,show) => {
      const link = event.target.closest?.(".pp-strip a");
      const line = root.querySelector(".strip-now");
      if (!link || !line) return;
      line.innerHTML = show ? `${escape(link.dataset.title)}${link.dataset.tag ? `<small>#${escape(link.dataset.tag)}</small>` : ""}` : "";
    };
    root.addEventListener("pointerover",event => stripNow(event,true));
    root.addEventListener("pointerout",event => stripNow(event,false));
    root.addEventListener("focusin",event => stripNow(event,true));
    root.addEventListener("focusout",event => stripNow(event,false));
    const redraw = focusSelector => {
      applyPicks(root).then(() => { if (focusSelector) root.querySelector(focusSelector)?.focus(); });
    };
    root.addEventListener("click",event => {
      if (event.target.closest("[data-prefs-toggle]")) {
        prefsOpen = !prefsOpen;
        fillPoster(root,lastCtx);
        root.querySelector(prefsOpen ? ".pp-prefs [data-pref-topic]" : ".pp-gear")?.focus();
        return;
      }
      const chip = event.target.closest("[data-pref-topic]");
      if (chip) {
        const prefs = new Set(getPrefs());
        if (prefs.has(chip.dataset.prefTopic)) prefs.delete(chip.dataset.prefTopic); else prefs.add(chip.dataset.prefTopic);
        writeLocal("home-topics",[...prefs]);
        redraw(`[data-pref-topic="${CSS.escape(chip.dataset.prefTopic)}"]`);
        return;
      }
      if (event.target.closest("[data-prefs-reset]")) {
        writeLocal("home-topics",[]);
        redraw("[data-prefs-reset]");
        return;
      }
      if (event.target.closest("[data-home-scroll]")) root.querySelector(".home-paper")?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    });
  }
  fillPoster(root,ctx);
  applyPicks(root);
}
// 관심 주제를 고르면 그 주제의 기사를 먼저 쓰고, 모자라면 최신 기사로 채운다.
function applyPicks(root) {
  return homeItems().then(({news,videos}) => {
    if (!root.isConnected || !root.querySelector(".home-scene")) return;
    const prefs = getPrefs();
    const match = item => !prefs.length || (item.topics ?? []).some(topic => prefs.includes(topic));
    const picks = pickScreens(news.filter(match),videos.filter(match));
    for (const item of interleave(news,videos)) {
      if (picks.length >= 4) break;
      if (!picks.includes(item)) picks.push(item);
    }
    const rest = list => list.filter(item => !picks.includes(item));
    pool = [...picks,...interleave(rest(news.filter(match)),rest(videos.filter(match))),
      ...(prefs.length ? interleave(rest(news.filter(item => !match(item))),rest(videos.filter(item => !match(item)))) : [])];
    fillPoster(root,lastCtx);
    root.querySelectorAll(".pile-screen").forEach((screen,index) => {
      if (picks[index]) show(screen,picks[index]);
      else screen.dataset.cap = "|신호 없음";
      if (screen.dataset.bound) return;
      screen.dataset.bound = "1";
      screen.addEventListener("pointerenter",() => setNow(screen));
      screen.addEventListener("focus",() => setNow(screen));
      screen.addEventListener("pointerleave",() => clearNow(screen));
      screen.addEventListener("blur",() => clearNow(screen));
    });
  });
}
