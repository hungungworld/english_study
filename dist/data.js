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
  {id:"demo-1",author:1,author_name:"",title:"영어 기사에서 배운 표현 3개",body:"휴대폰 사용 습관에 관한 기사를 읽고, 일상에서 써볼 만한 표현을 정리했어요.\n\nI tend to check my phone when I have a minute.",tag:"기사",link:"",created_at:sampleDate},
  {id:"demo-2",author:2,author_name:"",title:"토익 Part 5에서 틀린 접속사",body:"Although 뒤에는 절이, despite 뒤에는 명사나 동명사가 와요. 다음에는 빈칸 뒤에 주어와 동사가 있는지 먼저 확인하려고 해요.",tag:"토익",link:"",created_at:sampleDate},
  {id:"demo-3",author:3,author_name:"",title:"의견을 말할 때 써보고 싶은 표현",body:"From my perspective로 문장을 시작해 봤어요. 상대에게 의견을 물을 땐 How do you see it?을 써봤어요.",tag:"회화",link:"",created_at:sampleDate},
  {id:"demo-c1",author:4,author_name:"",title:"이번 주도 다들 고생 많았어요!",body:"이번 주도 다들 고생 많았어요! 바빠도 한 줄씩 남겨 주는 거 정말 대단해요. 주말에 푹 쉬고 다음 주에 또 같이 해요.",link:"",tag:"",board:"chat",created_at:sampleDate},
  {id:"demo-c2",author:5,author_name:"",title:"오늘 처음으로 영어 기사 끝까지 읽었어요",body:"오늘 처음으로 영어 기사 한 편을 끝까지 읽었어요. 모르는 단어가 많았지만 뿌듯해요. 응원해 주세요!",link:"",tag:"",board:"chat",created_at:sampleDate}
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
  if (!response.ok) throw new Error("저장하지 못했어요. 인터넷 연결을 확인하고 다시 시도해 주세요.");
  return response.json();
}
export async function addMember(email,password,name) {
  const response = await fetch(supabaseUrl.replace(/\/$/, "") + "/auth/v1/token?grant_type=password", {
    method:"POST",headers:{apikey:supabaseKey,"Content-Type":"application/json"},
    body:JSON.stringify({email,password})
  });
  if (!response.ok) throw new Error("관리자 이메일과 비밀번호를 확인해 주세요.");
  const {access_token} = await response.json();
  return rpc("study_add_member",{member_name:name},access_token);
}
export async function loadBoard() {
  return shared ? rpc("study_board") : demo;
}
export async function saveEntry(entry, token, id) {
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
export async function removePost(id, token) {
  if (shared) return rpc("study_remove", {post_key:id,edit_token:token});
  demo.posts = demo.posts.filter(post => post.id !== id);
  demo.words = demo.words.filter(word => word.post_id !== id);
  writeLocal("demo", demo);
}
