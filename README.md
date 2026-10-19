# devlog-content

`devlog`가 GitHub API로 읽는 공개 Markdown 글 저장소입니다. 사이트 애플리케이션 코드는 별도 저장소에 있습니다.

## 디렉터리 구조

```
posts/
  blog/             # 블로그 글
  wiki/             # 위키 글
assets/
  images/           # 글에서 사용하는 이미지
schemas/            # frontmatter JSON Schema
scripts/            # 저장소 검증기
tests/              # 검증기 테스트
```

글 파일은 `posts/blog/` 또는 `posts/wiki/` 바로 아래에만 둡니다. 하위 폴더는 만들지 않습니다.

## Frontmatter

모든 글은 파일 첫 줄부터 YAML frontmatter를 포함해야 합니다.

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `title` | 예 | 비어 있지 않은 글 제목 |
| `slug` | 예 | URL의 고유 식별자 |
| `date` | 예 | 발행일 (`YYYY-MM-DD`) |
| `type` | 예 | `blog` 또는 `wiki`이며, 파일의 폴더와 일치해야 함 |
| `description` | 아니오 | 글 요약 |
| `updatedAt` | 아니오 | 수정일 (`YYYY-MM-DD`) |
| `tags` | 아니오 | 문자열 태그 배열. 기본값은 `[]` |
| `series` | 아니오 | 시리즈 이름 또는 `null` |
| `featured` | 아니오 | 대표 글 여부. 기본값은 `false` |
| `cover` | 아니오 | 글 파일 기준의 저장소 상대 이미지 경로 |
| `redirectFrom` | 아니오 | 이전 slug 배열 |

```yaml
---
title: Xcode 초기 설정
slug: Xcode-inital-setting
date: 2026-10-19
type: blog
description: 새 개발 환경을 정리한 기록
tags: [xcode, setup]
cover: ../../assets/images/Xcode-inital-setting/cover.png
redirectFrom: [xcode-setup]
---

본문을 작성합니다.
```

저장소에 있는 파일은 곧 발행된 글입니다. `status` 같은 초안 필드는 사용하지 않습니다.

숫자로만 된 값은 따옴표로 감싸야 문자열로 읽힙니다. `slug: 2`는 숫자로 해석되어 검증에 실패하므로 `slug: "2"`로 씁니다. `title`, `series`, `tags` 항목도 같습니다.

## Slug와 리다이렉트

`slug`는 URL의 유일한 식별자이며 파일명과 독립적입니다. 파일명과 slug가 같을 필요는 없습니다.

- NFC로 정규화된 문자열이어야 합니다.
- 허용 형식은 `^[A-Za-z0-9가-힣]+(?:-[A-Za-z0-9가-힣]+)*$`입니다.
- 대소문자를 무시하고 저장소 전체에서 중복될 수 없습니다. 소문자를 강제하지는 않습니다.
- slug를 바꾸면 이전 slug를 `redirectFrom`에 기록합니다. devlog가 이를 308 리다이렉트로 처리할 예정이며, devlog 쪽 구현은 후속 작업입니다.

## 이미지

이미지는 `assets/images/<폴더>/` 아래에 저장하고, 글에서는 글 파일 기준 상대 경로로 참조합니다. devlog는 이 경로를 `raw.githubusercontent.com` URL로 변환합니다. `<폴더>` 이름은 처음 정한 slug를 쓰는 것을 관례로 하며, 이후에는 이동하지 않습니다.

## 발행 및 보안 정책

저장소에 있는 파일은 발행된 글입니다. 초안은 이 저장소에 두지 않으며, 사용자 승인 후에만 commit/push 합니다. **한 번 push한 내용은 파일을 지워도 Git 히스토리에 영구히 공개됩니다.**

다음 내용은 절대 넣지 않습니다.

- 키, 토큰, `.env` 파일
- 개인정보
- 회사 또는 비공개 코드
- 로컬 절대 경로 (`/Users/`, `/home/`, `C:\Users\`가 들어가면 검증에 실패합니다. 예시가 꼭 필요하면 `~/` 형태로 씁니다)
- 승인되지 않은 초안

글을 내리려면 해당 파일을 삭제합니다.

## 로컬 검증

```bash
pnpm install
pnpm test
pnpm validate
gitleaks detect
```

CI는 `main` 브랜치 push와 pull request에서 콘텐츠 테스트·검증을 수행하고, 전체 Git 이력에 대해 gitleaks로 비밀 정보를 검사합니다.

## devlog 토큰 정책

devlog는 fine-grained PAT를 사용합니다. 토큰은 이 저장소에만 한정하고 권한은 `Contents: Read-only`만 부여합니다. 서버 환경 변수 이름은 `GITHUB_CONTENT_TOKEN`이며, `NEXT_PUBLIC_` 접두사는 절대 사용하지 않습니다.

## 라이선스

[CC BY-NC-SA 4.0](LICENSE)입니다. `LICENSE` 파일을 참고하세요. 글에 포함된 코드 스니펫에도 동일한 조건이 적용됩니다.
