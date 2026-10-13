# Meme Wiki

한국어 밈 427건을 상황·감정·수신인별로 탐색하는 웹사이트입니다.
추천은 데이터셋의 키워드와 상황 설명을 비교하는 방식이며, 웹사이트 이용에는 API 키가 필요 없습니다.

## 폴더 구성

- `web/static`: 화면, 스타일, 브라우저 검색·추천
- `web/data/memes.json`: 통합 데이터베이스 (배포 시 기준 데이터)
- `dataset/images`: 기존 데이터셋 이미지
- `llm_run/llm collected`: 추가 수집 이미지

공개 저장소는 웹사이트에 필요한 코드·데이터·이미지만 포함합니다.
원본 엑셀, 수집 도구, 선택적 FastAPI 서버는 로컬에서 별도로 보관합니다.

## 로컬 미리보기

```sh
python3 web/build_static.py
python3 -m http.server 8000 --directory _site
```

브라우저에서 http://localhost:8000 을 엽니다.
빌드는 모든 이미지가 존재하는지 확인하고 `_site`에 배포 파일을 생성합니다.

## GitHub Pages 배포

1. GitHub에 빈 저장소를 생성합니다.
2. 이 폴더를 Git 저장소로 초기화하고 `main` 브랜치로 올립니다.
3. 저장소의 Settings → Pages → Build and deployment → Source를 **GitHub Actions**로 선택합니다.
4. Actions의 **Deploy GitHub Pages**를 실행하거나 `main`에 변경사항을 push합니다.
5. 배포 완료 후 Settings → Pages에서 공개 주소를 확인합니다.

일반적인 공개 주소는 `https://계정명.github.io/저장소명/`입니다.
이후 `main`에 push할 때마다 자동으로 재배포됩니다.

API 키와 `.env`, 수집 중간 상태, 로컬 임시 파일은 올리지 않습니다.
수집 키는 환경변수 `OPENAI_API_KEY`로만 설정합니다.
