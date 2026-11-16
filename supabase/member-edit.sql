-- Members can edit and delete the posts that carry their own name, from any browser (no edit key needed).
-- Run this once in the Supabase SQL editor. Guest posts (author 0) still need their edit key.
begin;

create or replace function public.study_remove_as(post_key uuid, member_no integer)
returns boolean language plpgsql security definer set search_path = ''
as $$
begin
  if member_no is null or member_no <= 0 or not exists (select 1 from public.study_members where id = member_no) then
    raise exception 'Not allowed';
  end if;
  delete from public.study_posts where id = post_key and author = member_no;
  if not found then raise exception 'Not allowed'; end if;
  return true;
end;
$$;

create or replace function public.study_save_as(entry jsonb, post_key uuid, member_no integer)
returns uuid language plpgsql security definer set search_path = ''
as $$
declare
  words jsonb := entry->'words';
  word jsonb;
  saved_word uuid;
  keep_words uuid[] := array[]::uuid[];
begin
  if post_key is null or member_no is null or member_no <= 0
     or not exists (select 1 from public.study_posts where id = post_key and author = member_no)
     or (entry->>'author')::integer is distinct from member_no
     or jsonb_typeof(words) is distinct from 'array' or jsonb_array_length(words) > 20 then
    raise exception 'Not allowed';
  end if;

  update public.study_posts
    set title = entry->>'title', body = entry->>'body', tag = entry->>'tag', link = entry->>'link'
    where id = post_key;

  for word in select value from jsonb_array_elements(words) loop
    if coalesce(word->>'id', '') <> '' then
      update public.study_words set term = word->>'term', meaning = word->>'meaning', example = word->>'example'
        where id = (word->>'id')::uuid and post_id = post_key
        returning id into saved_word;
      if not found then raise exception 'Word belongs to another post'; end if;
    else
      insert into public.study_words(post_id, author, author_name, term, meaning, example)
        values(post_key, member_no, '', word->>'term', word->>'meaning', word->>'example')
        returning id into saved_word;
    end if;
    keep_words := array_append(keep_words, saved_word);
  end loop;

  delete from public.study_words where post_id = post_key and not (id = any(keep_words));
  return post_key;
end;
$$;

revoke all on function public.study_remove_as(uuid,integer), public.study_save_as(jsonb,uuid,integer) from public, anon, authenticated;
grant execute on function public.study_remove_as(uuid,integer), public.study_save_as(jsonb,uuid,integer) to anon;

commit;
