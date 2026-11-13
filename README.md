# 스터디 서클

다섯 조원의 글을 모아 보는 주간 게시판과 공유 단어장입니다. 기간은 한국 시간의 월요일부터 일요일까지입니다. 링크를 열면 누구나 읽고 등록할 수 있습니다.

## Supabase 연결

1. Supabase 프로젝트의 SQL Editor에서 `supabase/schema.sql` 전체를 실행합니다.
2. `dist/config.js`에 프로젝트 URL과 publishable key를 입력합니다. 이전 프로젝트에서는 anon key도 사용할 수 있습니다. secret/service_role 키는 입력하지 않습니다.
3. 같은 파일의 `members`에 조원 다섯 명의 이름을 등록 순서대로 입력합니다. 글은 배열 순서에 대응하는 숫자 ID를 저장하므로 실제 운영 이후에는 순서를 유지합니다.
4. 사이트를 다시 배포합니다. 홈의 BBC RSS와 YouTube 목록은 Sites Worker가 제공합니다.

공개 읽기와 등록은 Supabase 함수로 처리합니다. 게시글을 수정·삭제할 수 있는 편집 키는 글을 올린 브라우저에 저장되며, 연결된 단어도 글 수정 화면에서 편집할 수 있습니다. 단독 등록 단어는 운영자가 Supabase에서 관리합니다. 로그인 없이 조원 이름을 선택하므로 화면에 표시된 이름은 작성자가 선택한 이름입니다.

## 로컬 미리보기

Node.js 22 이상에서 `node build-media.mjs`를 실행한 뒤 `node dev.mjs`를 실행합니다. 브라우저에서 `http://localhost:8000`을 엽니다. Supabase 설정이 비어 있으면 예시 글과 브라우저 저장을 사용합니다.

## 영어 TV

- BBC World News의 RSS를 서버에서 읽습니다. 뉴스 카드에는 헤드라인을 표시하고 상세 화면에서 BBC 원문으로 연결합니다.
- 로컬에서는 `.env.example`을 `.env`로 복사하고 `YOUTUBE_API_KEY`에 YouTube Data API v3 키를 입력합니다. 배포 사이트에는 같은 이름의 서버 환경 변수를 설정합니다.
- 기본 영상 출처는 `@bbclearningenglish`입니다. 다른 공개 재생목록을 사용하려면 `YOUTUBE_PLAYLIST_ID`에 목록 ID를 입력합니다. 채널만 바꾸려면 `YOUTUBE_CHANNEL_HANDLE`을 설정합니다.
- 피드 아래로 스크롤하면 남은 BBC 기사와 YouTube의 다음 페이지를 불러옵니다. 출처에서 제공하는 목록을 모두 읽으면 끝을 표시합니다.
