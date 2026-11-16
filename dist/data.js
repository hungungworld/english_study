import { supabaseUrl, supabaseKey } from "./config.js";

export const shared = Boolean(supabaseUrl && supabaseKey);
const prefix = "study-circle:";
export const readLocal = (key, fallback) => {
  try { return JSON.parse(localStorage.getItem(prefix + key)) ?? fallback; }
  catch { return fallback; }
};
export const writeLocal = (key, value) => {
  try { localStorage.setItem(prefix + key, JSON.stringify(value)); }
  catch { /* Browsing without local storage still allows shared reads and writes. */ }
};

const sampleDate = new Date().toISOString();
const samplePosts = [
  {id:"demo-1",author:1,author_name:"",title:"Three expressions from an English article",body:"I read an article about phone habits and wrote down expressions worth using every day.\n\nI tend to check my phone when I have a minute.",tag:"Article",link:"",created_at:sampleDate},
  {id:"demo-2",author:2,author_name:"",title:"The conjunction I missed in TOEIC Part 5",body:"Although takes a clause, while despite takes a noun or gerund. Next time I will check first whether a subject and verb follow the blank.",tag:"TOEIC",link:"",created_at:sampleDate},
  {id:"demo-3",author:3,author_name:"",title:"Phrases I want to use when giving an opinion",body:"I tried starting sentences with “From my perspective.” To ask for someone’s view, I tried “How do you see it?”",tag:"Speaking",link:"",created_at:sampleDate},
  {id:"demo-c1",author:4,author_name:"",title:"Great work this week, everyone!",body:"Great work this week, everyone! Even when you are busy, leaving a line each is impressive. Rest well this weekend and let’s do it again next week.",link:"",tag:"",board:"chat",created_at:sampleDate},
  {id:"demo-c2",author:5,author_name:"",title:"I finished an English article for the first time today",body:"Today I read a whole English article for the first time. There were many words I did not know, but I feel proud. Cheer me on!",link:"",tag:"",board:"chat",created_at:sampleDate}
];
const sampleWords = [
  {id:"demo-w1",post_id:"demo-1",term:"tend to",meaning:"~하는 경향이 있다",example:"I tend to check my phone when I have a minute.",author:1,created_at:sampleDate},
  {id:"demo-w2",post_id:"demo-1",term:"rely on",meaning:"~에 의존하다",example:"I rely on my phone for directions.",author:1,created_at:sampleDate},
  {id:"demo-w3",post_id:"demo-2",term:"despite",meaning:"~에도 불구하고",example:"Despite the rain, we went out.",author:2,created_at:sampleDate}
];
let demo = readLocal("demo", {posts:samplePosts, words:sampleWords});

async function rpc(name, payload = {}, token) {
  const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/rest/v1/rpc/" + name, {
    method:"POST",
    headers:{apikey:supabaseKey,"Content-Type":"application/json",...(token ? {Authorization:"Bearer " + token} : {})},
    body:JSON.stringify(payload)
  });
  if (!response.ok) throw new Error("Could not save. Check your connection and try again.");
  return response.json();
}
export async function addMember(email,password,name) {
  const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
    method:"POST",headers:{apikey:supabaseKey,"Content-Type":"application/json"},
    body:JSON.stringify({email,password})
  });
  if (!response.ok) throw new Error("Check the admin email and password.");
  const {access_token} = await response.json();
  return rpc("study_add_member",{member_name:name},access_token);
}
const isUuid = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id));
// Writes to the shared database run in the background; the screen uses the local copy right away.
const push = (name, payload) => {
  if (!shared) return;
  rpc(name, payload).catch(() => window.dispatchEvent(new CustomEvent("sync-failed")));
};
const union = (a = [], b = []) => [...new Set([...a, ...b])].sort().slice(-60);
function mergeStreaks(remote) {
  const local = readLocal("streak", {});
  for (const [member, theirs] of Object.entries(remote)) {
    const mine = local[member];
    if (!mine) { local[member] = {...blankStudy(), ...theirs}; continue; }
    const last = state => [...state.days, ...state.saved].sort().pop() ?? "";
    // Days are combined; hearts come from whichever side studied most recently.
    const newer = last(theirs) > last(mine) || (last(theirs) === last(mine) && theirs.days.length > mine.days.length) ? theirs : mine;
    local[member] = {days:union(mine.days, theirs.days), saved:union(mine.saved, theirs.saved), awarded:union(mine.awarded, theirs.awarded), hearts:newer.hearts ?? 0};
  }
  writeLocal("streak", local);
}
export async function loadBoard() {
  if (!shared) return demo;
  const board = await rpc("study_board");
  // Older databases do not return these yet; the local copies keep working.
  if (board.reactions) writeLocal("reactions", board.reactions);
  if (board.comments) writeLocal("comments", board.comments);
  if (board.streaks) mergeStreaks(board.streaks);
  return board;
}
// An edit key (token) proves a post is yours; without one, a member can still change a post that carries their own name (memberNo).
export async function saveEntry(entry, token, id, memberNo) {
  if (shared && id && !token && memberNo) return rpc("study_save_as", {entry, post_key:id, member_no:memberNo});
  if (shared) return rpc("study_save", {entry, edit_token:token, post_key:id ?? null});
  const created_at = new Date().toISOString();
  const previous = demo.posts.find(post => post.id === id);
  const postId = entry.title ? id ?? crypto.randomUUID() : null;
  const words = entry.words.map(word => ({
    ...word,id:word.id || crypto.randomUUID(),post_id:postId,author:entry.author,
    author_name:entry.author_name,created_at:demo.words.find(old => old.id === word.id)?.created_at ?? created_at
  }));
  if (postId) {
    const post = {...entry,id:postId,created_at:previous?.created_at ?? created_at};
    delete post.words;
    demo.posts = [post,...demo.posts.filter(item => item.id !== postId)];
    demo.words = demo.words.filter(word => word.post_id !== postId);
  }
  demo.words = [...words,...demo.words];
  writeLocal("demo", demo);
  return postId;
}
export async function removePost(id, token, memberNo) {
  if (shared && !token && memberNo) return rpc("study_remove_as", {post_key:id,member_no:memberNo});
  if (shared) return rpc("study_remove", {post_key:id,edit_token:token});
  demo.posts = demo.posts.filter(post => post.id !== id);
  demo.words = demo.words.filter(word => word.post_id !== id);
  writeLocal("demo", demo);
}

// ---- Cheer reactions, study streaks, hearts (saved to Supabase in shared mode) ----
const dayMs = 86400000;
export const dayKey = (ms = Date.now()) => new Date(ms + 9 * 3600000).toISOString().slice(0,10);
const shiftDay = (key, n) => new Date(Date.parse(key + "T00:00:00Z") + n * dayMs).toISOString().slice(0,10);
export const MAX_HEARTS = 5;
export const HEART_EVERY = 3;
const blankStudy = () => ({days:[],saved:[],hearts:0,awarded:[]});
export const studyState = member => readLocal("streak",{})[member] ?? blankStudy();
export function streakOf(state, today = dayKey()) {
  const has = new Set([...state.days,...state.saved]);
  let key = has.has(today) ? today : shiftDay(today,-1), count = 0;
  while (has.has(key)) { count++; key = shiftDay(key,-1); }
  return count;
}
// A study action (quiz answer, note, word) marks today. Every 3rd streak day earns a heart;
// one missed day is covered by spending a heart.
export function recordStudy(member) {
  const all = readLocal("streak",{});
  const state = all[member] ?? blankStudy();
  const today = dayKey();
  const result = {newDay:false,spent:false,earned:false};
  if (!state.days.includes(today)) {
    result.newDay = true;
    const last = [...state.days,...state.saved].filter(key => key < today).sort().pop();
    if (last === shiftDay(today,-2) && state.hearts > 0) { state.hearts--; state.saved.push(shiftDay(today,-1)); result.spent = true; }
    state.days.push(today);
    if (streakOf(state,today) % HEART_EVERY === 0 && !state.awarded.includes(today) && state.hearts < MAX_HEARTS) {
      state.hearts++; state.awarded.push(today); result.earned = true;
    }
    Object.assign(state,{days:state.days.slice(-60),saved:state.saved.slice(-60),awarded:state.awarded.slice(-60)});
    all[member] = state;
    writeLocal("streak",all);
    push("study_streak_save",{member_no:member,new_state:state});
  }
  return {...result,streak:streakOf(state,today),hearts:state.hearts};
}
export const readReactions = () => readLocal("reactions",{});
export function toggleReaction(postId, member) {
  const all = readReactions();
  const list = new Set(all[postId] ?? []);
  if (list.has(member)) list.delete(member); else list.add(member);
  all[postId] = [...list];
  writeLocal("reactions",all);
  if (isUuid(postId)) push("study_react",{post_key:postId,member_no:member});
  return all;
}

// ---- Comments (saved to Supabase in shared mode) ----
export const readComments = () => readLocal("comments",{});
export function addComment(postId, member, text) {
  const all = readComments();
  const comment = {id:crypto.randomUUID(),member,text,at:new Date().toISOString()};
  all[postId] = [...(all[postId] ?? []), comment];
  writeLocal("comments",all);
  if (isUuid(postId)) push("study_comment_add",{comment_id:comment.id,post_key:postId,member_no:member,comment_text:text});
}
export function removeComment(postId, commentId) {
  const all = readComments();
  const removed = (all[postId] ?? []).find(item => item.id === commentId);
  all[postId] = (all[postId] ?? []).filter(item => item.id !== commentId);
  writeLocal("comments",all);
  if (removed && isUuid(commentId)) push("study_comment_remove",{comment_id:commentId,member_no:removed.member});
}

// A member can change or remove a word that carries their own name.
export async function updateWord(id, word, memberNo) {
  if (shared) {
    await rpc("study_word_update", {word_key:id, member_no:memberNo, new_term:word.term, new_meaning:word.meaning, new_example:word.example});
    return id;
  }
  demo.words = demo.words.map(item => item.id === id ? {...item, term:word.term, meaning:word.meaning, example:word.example} : item);
  writeLocal("demo", demo);
  return id;
}
export async function removeWord(id, memberNo) {
  if (shared) return rpc("study_word_remove", {word_key:id, member_no:memberNo});
  demo.words = demo.words.filter(word => word.id !== id);
  writeLocal("demo", demo);
}
