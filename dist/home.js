import {homeItems} from "./media.js";

// 홈 screen: a photo of four stacked analog TVs. The four black screens are real
// areas of the photo (found by flood-filling the dark regions), so each one is an
// anchor clipped to that shape, filled with a news/video thumbnail and CRT effects.
const SCREENS = [{"x":0.2943,"y":0.0865,"w":0.2648,"h":0.1738,"poly":[[0.0,3.0],[4.3,2.0],[6.9,1.5],[12.0,1.0],[25.8,0.0],[96.1,0.0],[98.3,0.5],[99.6,11.3],[99.6,63.1],[99.1,96.1],[94.8,96.6],[77.3,97.5],[42.9,99.0],[18.9,99.5],[0.0,99.5]]},{"x":0.4511,"y":0.3108,"w":0.2716,"h":0.1627,"poly":[[0.0,38.4],[0.4,23.7],[0.8,12.6],[1.3,10.0],[1.7,7.9],[2.9,6.3],[9.2,0.5],[55.6,0.0],[84.5,0.0],[89.5,0.5],[97.5,2.1],[99.6,32.1],[99.6,66.3],[98.3,82.6],[96.2,89.5],[94.6,92.6],[93.7,93.7],[90.4,95.3],[87.0,96.3],[77.0,98.4],[67.8,99.5],[41.8,99.5],[32.2,98.4],[15.1,95.8],[10.5,94.7],[8.8,94.2],[6.3,93.2],[4.6,92.1],[2.9,90.5],[0.4,66.3],[0.0,61.6]]},{"x":0.3568,"y":0.5257,"w":0.3091,"h":0.1695,"poly":[[0.0,8.1],[1.5,1.0],[4.4,0.5],[9.6,0.0],[98.5,0.0],[98.9,2.0],[99.6,16.2],[99.6,94.9],[98.5,96.5],[52.9,99.0],[40.4,99.5],[20.6,98.0],[0.4,95.5],[0.0,94.9]]},{"x":0.4216,"y":0.7457,"w":0.2682,"h":0.1627,"poly":[[0.0,16.8],[1.3,8.9],[3.8,6.8],[5.9,5.8],[17.8,2.6],[33.9,1.1],[44.9,0.0],[80.1,0.0],[98.7,0.5],[99.6,2.1],[99.6,71.6],[99.2,84.2],[93.2,90.5],[91.1,92.1],[90.3,92.6],[82.2,95.3],[78.0,96.3],[69.9,97.9],[55.9,99.5],[23.7,99.5],[11.9,98.4],[3.8,95.3],[3.0,94.2],[2.1,89.5],[1.7,84.7],[0.0,33.7]]}];
const ASPECT = 0.75342;
const escape = value => String(value ?? "").replace(/[&<>"']/g,char => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[char]);
const byDate = (a,b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
let timer = 0;
let pool = [];
let cursor = 0;
let turn = 0;
let lastCtx = null;

function screenHtml(screen,index) {
  const clip = screen.poly.map(([x,y]) => `${x}% ${y}%`).join(",");
  return `<a class="pile-screen is-static" data-pile="${index}" href="#explore"
    style="left:${screen.x*100}%;top:${screen.y*100}%;width:${screen.w*100}%;height:${screen.h*100}%;clip-path:polygon(${clip})"
    aria-label="신호를 기다리는 TV"><span class="ps-img"></span><span class="ps-cap"></span><span class="ps-static" aria-hidden="true"></span></a>`;
}
function template() {
  return `<section class="home-scene" aria-labelledby="home-title">
    <div class="home-copy">
      <h1 id="home-title" lang="en">axciting</h1>
      <p>영어 기사와 영상을 보고,<br>기억하고 싶은 문장을 남겨요.</p>
      <div class="home-actions">
        <a class="home-primary" href="#explore">둘러보기 →</a>
        <button type="button" class="home-ghost" data-tv-write>＋ 공부 기록 쓰기</button>
      </div>
      <nav class="home-links" aria-label="바로 가기"><a href="#feed">게시판</a><a href="#words">단어장</a><a href="#scraps">내 스크랩</a></nav>
    </div>
    <div class="tv-pile" style="--pile-aspect:${ASPECT}">
      <img class="tv-pile-img" src="./img/tv-pile.jpg" alt="낡은 아날로그 TV 네 대가 쌓여 있는 모습" width="880" height="1168" fetchpriority="high">
      ${SCREENS.map(screenHtml).join("")}
    </div>
    <button type="button" class="home-scroll" data-home-scroll>스크롤 ↓</button>
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
  screen.title = item.title;
  screen.querySelector(".ps-img").style.backgroundImage = url ? `url("${url}")` : "";
  screen.querySelector(".ps-cap").innerHTML = `<small>${escape(item.type === "video" ? "영어 영상" : "BBC 뉴스")}</small>${escape(item.title)}`;
  setTimeout(() => screen.classList.remove("is-static"),260);
}
function nextItem(root) {
  const shown = new Set([...root.querySelectorAll(".pile-screen")].map(screen => screen.dataset.item));
  for (let i = 0; i < pool.length; i++) {
    const item = pool[cursor++ % pool.length];
    if (!shown.has(item.id)) return item;
  }
  return null;
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
    '<p>아직 올라온 글이 없어요.</p>';
  const newsHtml = news.length ? news.map(item => `<p><a href="${link(item)}">${escape(item.title)}</a></p>`).join("") : '<p>자료를 불러오는 중이에요.</p>';
  const words = ctx.loading ? '<div><span>…</span></div>' : ctx.words.length ?
    ctx.words.map(word => `<div><span lang="en">${escape(word.term)}</span><small>${escape(word.meaning)}</small></div>`).join("") :
    '<div><span>—</span><small>아직 단어가 없어요</small></div>';
  paper.innerHTML = `
    <div class="pp-rail">
      <p><span class="pp-k">이번 주 기록</span>조원 ${ctx.memberCount}명<br>글 ${ctx.postCount}개<br>단어 ${ctx.wordCount}개</p>
      <p><span class="pp-k">출처</span>BBC News<br>BBC Learning English</p>
      <div class="pp-dates">${escape(ctx.range.from)}<span>—</span>${escape(ctx.range.to)}<span>${ctx.range.year}</span></div>
      ${ctx.shared ? "" : '<p class="pp-note">미리보기<br>예시 데이터예요.</p>'}
    </div>
    <div class="pp-main">
      <h2 id="paper-title" class="pp-title">이번 주<br>영어 공부:<br>기록</h2>
      <p class="pp-sub">기사와 영상을 보고, 기억하고 싶은 문장을 한 줄씩 남겨요.</p>
      <div class="pp-cols">
        <div><h3>게시판</h3>${posts}<a class="pp-more" href="#feed">전체 보기 ↗</a></div>
        <div><h3>둘러보기</h3>${newsHtml}<a class="pp-more" href="#explore">전체 보기 ↗</a></div>
      </div>
      <div class="pp-words"><h3>이번 주 단어</h3>${words}<a class="pp-more" href="#words">단어장 ↗</a></div>
    </div>
    <nav class="pp-vert" aria-label="메뉴"><a href="#feed">게시판</a><a href="#words">단어장</a><a href="#explore">둘러보기</a><a href="#scraps">내 스크랩</a></nav>
    <div class="pp-strip" aria-label="이번 주 뉴스와 영상">${picks.map(item =>
      `<a href="${link(item)}" aria-label="${escape(item.title)}"><img src="${escape(item.type === "video" ? (item.image || "").replace("hqdefault","mqdefault") : upgrade(item.image))}" data-fallback="${escape(item.image)}" alt="" loading="lazy"></a>`).join("")}</div>`;
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
    root.addEventListener("click",event => {
      if (event.target.closest("[data-home-scroll]")) root.querySelector(".home-paper")?.scrollIntoView({behavior:matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth"});
    });
  }
  fillPoster(root,ctx);
  homeItems().then(({news,videos}) => {
    if (!root.isConnected || !root.querySelector(".home-scene")) return;
    pool = interleave(news,videos);
    cursor = 0;
    fillPoster(root,lastCtx);
    const screens = [...root.querySelectorAll(".pile-screen")];
    if (!pool.length) {
      screens.forEach(screen => { screen.querySelector(".ps-cap").textContent = "신호 없음"; });
      return;
    }
    screens.forEach((screen,index) => show(screen,pool[index % pool.length]));
    cursor = screens.length;
    if (matchMedia("(prefers-reduced-motion: reduce)").matches || pool.length <= screens.length) return;
    timer = setInterval(() => {
      if (!root.isConnected || !root.querySelector(".home-scene")) return leaveHome();
      if (document.hidden) return;
      const item = nextItem(root);
      if (item) show(screens[turn++ % screens.length],item);
    },5200);
  });
}
