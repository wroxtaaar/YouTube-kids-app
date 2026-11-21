# YouTube Kids App (child feed)

A scrolling video feed for a child. The parent controls it by editing `content.txt` (commit -> Render redeploys).

- `keyword: tom and jerry` — pulls matching YouTube videos
- `youtube: <link>` — one specific video
- `home: <Drive/Mega/.mp4 link> | Title` — your own videos

Optional env vars: `YOUTUBE_API_KEY` (more reliable than scraping), `VIDEOS_PER_KEYWORD` (15), `CACHE_MINUTES` (30).
Run locally: `docker build -t kids . && docker run -p 3000:3000 kids`

## Editing the feed from your phone (admin page)

Open `https://<your-app>.onrender.com/admin`, sign in, add/remove keywords, YouTube/Shorts links and home videos, tap **Save changes**.
The feed updates within ~30 seconds, with no redeploy. The live feed is stored in `content.txt` on the **`content`** branch
(Render only auto-deploys `main`, so saves never rebuild the app).

Set these environment variables on the Render service:

| Variable | What |
|---|---|
| `ADMIN_PASSWORD` | Password for `/admin` (required, pick a long one) |
| `GITHUB_TOKEN` | Fine-grained GitHub token for this repo only, permission **Contents: Read and write** |

Optional: `GITHUB_REPO` (default `wroxtaaar/YouTube-kids-app`), `CONTENT_BRANCH` (default `content`).
If GitHub can't be reached the app falls back to the `content.txt` bundled in the image.
