begin;

create table if not exists public.study_posts (
  id uuid primary key default gen_random_uuid(),
  author smallint not null check (author between 0 and 5),
  author_name text not null check (length(author_name) <= 40 and (author > 0 or length(trim(author_name)) > 0)),
  title text not null check (length(trim(title)) between 1 and 150),
  body text not null check (length(trim(body)) between 1 and 12000),
  tag text not null check (length(tag) <= 30),
  link text not null check (length(link) <= 2000 and (link = '' or link ~* '^https?://')),
  token_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists public.study_words (
  id uuid primary key default gen_random_uuid(),
  post_id uuid references public.study_posts(id) on delete cascade,
  author smallint not null check (author between 0 and 5),
  author_name text not null check (length(author_name) <= 40 and (author > 0 or length(trim(author_name)) > 0)),
  term text not null check (length(trim(term)) between 1 and 120),
  meaning text not null check (length(trim(meaning)) between 1 and 300),
  example text not null check (length(example) <= 600),
  created_at timestamptz not null default now()
);

create index if not exists study_words_post_id on public.study_words(post_id);
alter table public.study_posts enable row level security;
alter table public.study_words enable row level security;
revoke all on public.study_posts, public.study_words from public, anon, authenticated;

create or replace function public.study_board()
returns jsonb language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'posts', coalesce((select jsonb_agg(to_jsonb(p) - 'token_hash' order by p.created_at desc) from public.study_posts p), '[]'::jsonb),
    'words', coalesce((select jsonb_agg(to_jsonb(w) order by w.created_at desc) from public.study_words w), '[]'::jsonb)
  );
$$;

create or replace function public.study_save(entry jsonb, edit_token text, post_key uuid default null)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  post_id_to_save uuid := post_key;
  member_no smallint := (entry->>'author')::smallint;
  display_name text := case when member_no = 0 then trim(entry->>'author_name') else '' end;
  token_digest text := encode(sha256(convert_to(edit_token, 'UTF8')), 'hex');
  words jsonb := entry->'words';
  word jsonb;
  saved_word uuid;
  keep_words uuid[] := array[]::uuid[];
begin
  if member_no is null or member_no not between 0 and 5
     or (member_no = 0 and coalesce(length(display_name), 0) not between 1 and 40)
     or coalesce(length(edit_token), 0) not between 40 and 128
     or jsonb_typeof(words) is distinct from 'array' or jsonb_array_length(words) > 20 then
    raise exception 'Invalid input';
  end if;

  if post_key is not null then
    update public.study_posts
      set author = member_no, author_name = display_name, title = entry->>'title',
          body = entry->>'body', tag = entry->>'tag', link = entry->>'link'
      where id = post_key and token_hash = token_digest;
    if not found then raise exception 'Invalid edit token'; end if;
  elsif coalesce(entry->>'title', '') <> '' then
    insert into public.study_posts(author, author_name, title, body, tag, link, token_hash)
      values(member_no, display_name, entry->>'title', entry->>'body', entry->>'tag', entry->>'link', token_digest)
      returning id into post_id_to_save;
  elsif jsonb_array_length(words) <> 1 then
    raise exception 'Expected one standalone word';
  end if;

  for word in select value from jsonb_array_elements(words) loop
    if post_id_to_save is not null and coalesce(word->>'id', '') <> '' then
      update public.study_words set author = member_no, author_name = display_name, term = word->>'term',
        meaning = word->>'meaning', example = word->>'example'
        where id = (word->>'id')::uuid and post_id = post_id_to_save
        returning id into saved_word;
      if not found then raise exception 'Word belongs to another post'; end if;
    else
      insert into public.study_words(post_id, author, author_name, term, meaning, example)
        values(post_id_to_save, member_no, display_name, word->>'term', word->>'meaning', word->>'example')
        returning id into saved_word;
    end if;
    keep_words := array_append(keep_words, saved_word);
  end loop;

  if post_id_to_save is not null then
    delete from public.study_words where post_id = post_id_to_save and not (id = any(keep_words));
  end if;
  return post_id_to_save;
end;
$$;

create or replace function public.study_remove(post_key uuid, edit_token text)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  delete from public.study_posts
    where id = post_key and token_hash = encode(sha256(convert_to(edit_token, 'UTF8')), 'hex');
  if not found then raise exception 'Invalid edit token'; end if;
  return true;
end;
$$;

revoke all on function public.study_board(), public.study_save(jsonb,text,uuid), public.study_remove(uuid,text) from public, anon, authenticated;
grant execute on function public.study_board(), public.study_save(jsonb,text,uuid), public.study_remove(uuid,text) to anon;

commit;
