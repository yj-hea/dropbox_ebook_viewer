# 전자책 뷰어

Dropbox 볼트의 `ebook/` 폴더에 있는 EPUB·PDF 파일을 브라우저에서 읽는 웹 앱입니다.

- 책 목록(목록 보기 / 서재 보기, 표지 포함)
- 읽던 위치 기억, 열고 닫은 기록, 하이라이트와 메모
- 기록은 Dropbox의 `ebook/.reading/<파일명>.json` 에 저장됩니다.

## 실행

```sh
cp .env.example .env   # DROPBOX_APP_KEY 채우기
npm install
npm run dev
```

Dropbox 앱의 Redirect URI 에 실행 주소(예: `https://localhost:5000/`)를 등록해야 합니다.
