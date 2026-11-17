# YouTube Kids App (child feed)

A scrolling video feed for a child. The parent controls it by editing `content.txt` (commit -> Render redeploys).

- `keyword: tom and jerry` — pulls matching YouTube videos
- `youtube: <link>` — one specific video
- `home: <Drive/Mega/.mp4 link> | Title` — your own videos

Optional env vars: `YOUTUBE_API_KEY` (more reliable than scraping), `VIDEOS_PER_KEYWORD` (15), `CACHE_MINUTES` (30).
Run locally: `docker build -t kids . && docker run -p 3000:3000 kids`
