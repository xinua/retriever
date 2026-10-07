# 🐕 Retriever

**Your loyal friend for downloading and archiving video.**

![Retriever](demo/mockup.webp)

---

## What is this?

Retriever is a self-hosted Web UI for `yt-dlp` 

Retriever also watches YouTube channels, fetches new uploads on its own and notifies your Smart Home.

Retriever does two jobs, and does them in one container:

**📥 Download anything, now.** Paste a video, playlist, or channel URL and it lands in your library — YouTube, TikTok, Instagram, or any of the thousand-odd sites `yt-dlp` supports. Pick the format, quality, and codec, trim a clip, split by chapters, cut sponsor segments.

**📡 Watch channels, forever.** Subscribe to a YouTube channel and Retriever polls its RSS feed on your schedule, downloading every new upload without you touching anything.

`yt-dlp` and `ffmpeg` ship **inside the image**, so downloads run in this container and land in the folder you mount at `/downloads`. Nothing else to install, no sidecar service to point at.

Perfect if you:

- Run a home server or NAS
- Archive channels before they disappear
- Want automation instead of a browser tab full of downloader sites
- Use Home Assistant

---



## Screenshots

![Demo 1](demo/1.webp)
![Demo 2](demo/2.webp)
![Demo 3](demo/3.webp)

📸 Expand more screenshots  
![Step 1](demo/theme/static.gif)![Step 2](demo/theme/animations/fire.gif)![Step 3](demo/theme/animations/rain.gif)![Step 4](demo/theme/animations/snow.gif)![Step 5](demo/theme/animations/stars.gif)![Step 6](demo/theme/animations/matrix.gif)

## ✨ Features



### Download now

- 🔗 **Paste anything** — single video, playlist, or a whole channel (expanded into one job per video)
- 🌍 **YouTube, TikTok, Instagram**, and everything else `yt-dlp` handles
- 🎬 **Video** — MP4, MKV or best available, up to 4K, codec-pinned to H.264 / H.265 / AV1 / VP9
- 🎵 **Audio** — MP3, M4A, OPUS, WAV, FLAC at 128 / 192 / 320 kbps or best available
- 🖼 **Thumbnail-only** downloads
- ✂️ **Clip** a time range without fetching the whole video
- 📑 **Split by chapters** — one file per chapter
- 🚫 **SponsorBlock** — cut sponsor segments automatically
- 📂 **Destination folder** with autocomplete over folders you already use, plus filename prefixes
- ⚙️ **Extra** `yt-dlp` **arguments** per download, per channel, or globally



### Watch channels

- 📡 **RSS-based tracking** — no API key, no quota
- ⏱ **Flexible polling** — every N minutes within an optional active time range, or at one or more fixed times each day
- 1️⃣ **Intermittent polling** — stop polling for the day once a new video has been downloaded
- 🎯 **Per-channel settings** — type, format, codec, folder, prefix, extra args, webhook, SponsorBlock, split by chapters
- 👯 **Same channel, many subscriptions** — e.g. grab a channel as video and as audio; each keeps its own history
- 🩳 **Shorts** included or skipped, your call



### The queue

- 📊 **Live progress** over WebSocket — percentage, real speed, honest ETA, size
- ⚡ **Parallel downloads**, configurable (default 2)
- 🔁 **Automatic retries** that know the difference between "try again" and "this video is gone"
- ⏹ **Retry, cancel, stop-all, delete, clear finished** — all one click
- 🔍 **Search and filter** by status and type (audio / video / thumbnail) across your whole history
- 🏷 **Real file info** — the actual quality and video codec of every finished file, probed after download
- 💾 **Save any finished file** straight to the browser
- 🖼 **Posters everywhere** — when a download arrives with no artwork, a frame is pulled out of the file itself
- ▶️ **Play downloaded** — watch downloaded video by click on poster
- 🛡 **Atomic writes** — in-progress files live in a hidden temp folder and only move into place when complete, so your media scanner never sees a half-downloaded episode



### Integrations & interface

- 🔔 **Webhooks** — global or per-channel, with a test-send button that shows you the exact payload
- ✈️ **Telegram bot** — new-video and failed-download notifications, and a download bot: send it a link, get the video or MP3 back
- 🖼️ **Widget page** — for Home Assistant iframe cards, with the latest video playable in place
- 📄 **Copy-ready Home Assistant YAML** — card and automation snippets, per subscription, one click each
- 🎨 **Seven theme colors** — ten section backgrounds, optional animations
- 📋 **Auto-paste** — the URL field grabs the link from your clipboard
- 🧲 **Drag to reorder** — the whole page layout
- 📱 **Responsive + PWA** — install like mobile app
- 🆙 **Update notification** — know when a new release is out and read its notes in the app

---



## 🚀 Quick start



### Docker

```bash
docker run -d \
  --name retriever \
  -p 31080:8000 \
  -v /your-directory/data:/data \
  -v /your-media/youtube:/downloads \
  ghcr.io/xinua/retriever:latest
```

Open **[http://localhost:31080](http://localhost:31080)** and paste a URL.

### Docker with POT

Two containers on a shared network, so Retriever can find the provider by name:

```bash
docker network create retriever-net

docker run -d \
  --name pot \
  --network retriever-net \
  --init \
  brainicism/bgutil-ytdlp-pot-provider:1.3.2

docker run -d \
  --name retriever \
  --network retriever-net \
  -p 31080:8000 \
  -e POT_BASE_URL=http://pot:4416 \
  -v /your-directory/data:/data \
  -v /your-media/youtube:/downloads \
  ghcr.io/xinua/retriever:latest
```

The network is the part people miss: containers only resolve each other by name
on a **user-defined** network, so without `docker network create` the
`http://pot:4416` above has nothing to point at. The provider needs no volumes
and no published port — only Retriever talks to it.

Open Settings (⚙️) after starting: a green **POT provider: connected** line
under the yt-dlp version means the two found each other.

### Docker Compose

Save as `docker-compose.yml` and run `docker compose up -d`:

```yaml
services:
  retriever:
    image: ghcr.io/xinua/retriever:latest
    container_name: retriever
    ports:
      - "31080:8000"
    volumes:
      - /mnt/tank/apps/retriever/data:/data
      - /mnt/tank/media/youtube:/downloads
    restart: unless-stopped
```



### Docker Compose with POT

```yaml
services:
  retriever:
    image: ghcr.io/xinua/retriever:latest
    container_name: retriever
    ports:
      - "31080:8000"
    volumes:
      - /mnt/tank/apps/retriever/data:/data
      - /mnt/tank/media/youtube:/downloads
    environment:
      POT_BASE_URL: http://pot:4416
    restart: unless-stopped

  pot:
    image: brainicism/bgutil-ytdlp-pot-provider:1.3.2
    container_name: retriever-pot
    init: true
    restart: unless-stopped
```

Already running a POT provider elsewhere on your network? Skip the second service and point at it directly — `POT_BASE_URL: http://192.168.1.50:4416`.

> **Versions.** The plugin ships inside the Retriever image and should match the provider server. If you pin the provider to a tag, pin it to the version this README documents (`1.3.2`); `latest` on both sides also stays in step. A mismatch logs a warning rather than breaking.

Two volumes matter:


| Mount        | What lives there                                                    |
| ------------ | ------------------------------------------------------------------- |
| `/data`      | Database, cached artwork, the download archive, the staged `yt-dlp` |
| `/downloads` | Your media                                                          |


---



## ⚙️ Configuration

Most settings live in the UI (⚙️ in the header). These environment variables are read at boot:


| Variable                | Default                    | What it does                                              |
| ----------------------- | -------------------------- | --------------------------------------------------------- |
| `PORT`                  | `8000`                     | Port inside the container                                 |
| `HOST`                  | `0.0.0.0`                  | Bind address                                              |
| `DATA_DIR`              | `/data`                    | Database, images, archive                                 |
| `DOWNLOADS_DIR`         | `/downloads`               | Default download root                                     |
| `YTDLP_BIN`             | `/usr/local/bin/yt-dlp`    | The bundled binary to stage from                          |
| `MAX_MANUAL_ITEMS`      | `500`                      | Cap on how many videos one pasted channel/playlist queues |
| `POT_BASE_URL`          | *(unset)*                  | POT provider server to use — see below. Unset = disabled  |
| `POT_PLUGIN_DIR`        | `/app/pot-plugin`          | Where the bundled POT plugin lives                        |
| `VERSION_CHECK_ENABLED` | `true`                     | Set to `false` to never look for a new release            |
| `VERSION_CHECK_WINDOW`  | `00:00-02:00`              | UTC window the daily check picks its random time from     |
| `VERSION_CHECK_URL`     | *(the manifest on GitHub)* | Where to read the published version from                  |




### Update check

Once a day Retriever reads its published `version.json` from GitHub to see whether a newer release exists, and serves the answer from `/api/version`. The check runs at a random moment inside `VERSION_CHECK_WINDOW` — a different one per install, so every Retriever in the world does not knock at the same second — and the result is cached in the database on your `/data` volume. Restarting the container replays that schedule rather than starting a new day, so restarts never cost a request; a failed check keeps yesterday's answer and retries in an hour. Nothing is sent: it is a plain GET of a public file. Set `VERSION_CHECK_ENABLED=false` to turn it off entirely.

In the **Settings** dialog you can set the downloads folder, a cookies file, global `yt-dlp` arguments, how many downloads run at once, your webhook URL and the Telegram bot — plus update `yt-dlp` itself with one click.

---



## 📁 How files are stored

Finished files are written to your `/downloads` mount, using the **Folder** and **Prefix** you chose:

```
/downloads/<folder>/<prefix><video title>.<ext>
```

Already-downloaded videos from watched channels are recorded in a per-subscription archive, `/data/archive/watcher-<id>.txt`, and are never fetched twice by that subscription. Deleting a subscription removes its archive too. (Manual downloads deliberately skip the archive — if you asked for a file explicitly, you get it.)

Download the same video into the same folder again and the new copy is numbered rather than overwriting the old one:

```
Never Gonna Give You Up.mp4
Never Gonna Give You Up (1).mp4
```

In-progress downloads live in `/downloads/.retriever-tmp/<id>/` and only move into place once complete. The directory is removed when the download settles, and abandoned ones are swept at boot.

Want the video id in the filename — useful when two videos in one folder share a title and would otherwise overwrite? Put your own template in **Extra yt-dlp arguments**; a later `-o` wins:

```
-o "%(title)s [%(id)s].%(ext)s"
```

---



## 📡 Adding a subscription

1. Click **+ Add Subscription**
2. Paste a YouTube channel or RSS URL
3. Choose a polling mode — every N minutes (optionally only within an active time range), or at one or more set times each day. Turn on **one-time polling** to stop for the day after the first new download
4. Set the format, folder, and prefix you want for that channel, and optionally remove sponsors or split by chapters
5. Save

That's it. New uploads arrive on their own.

> **Start from last** downloads the channel's most recent video immediately, so you can check your settings without waiting for the next poll.

---



## 🏠 Home Assistant

**Webhooks.** Set a webhook URL in Settings (or override it per channel), then press the webhook icon to send a test. The test posts the same shape a real notification does, and the payload also appears in the second notification, ready to copy into your automation:

```json
{
  "watcherId": 1,
  "channel": "Channel Name",
  "videoId": "4f35jL3Wd",
  "title": "Video Title",
  "type": "video",
  "date": "2026-09-05T12:00:00.000Z",
  "path": "Channel Name/Video Title.mp4",
  "fileUrl": "/api/downloads/1/file?inline=1"
}
```

The webhook is sent once the subscription's download has finished. `watcherId` is the watcher's own id — the same one the widget URL below takes — not the channel's YouTube id. `path` is the file's location inside the downloads folder, and `fileUrl` streams it from Retriever, the same URL the widget plays.

**Widget cards.** Each watcher has a compact page showing its latest video:

```
http://localhost:31080/widget/<watcherId>
```

![Widget example](demo/widget.gif)

Drop that into an iframe card. The card plays the file in place — press the poster and the video (or audio) starts right there, no jump to another tab.

```yaml
type: iframe
url: http://localhost:31080/widget/1
aspect_ratio: 50%
```

**Don't type any of this.** Expand a subscription and open its **⋯** menu under poster:

- **Open widget** — the page on its own, to check it
- **HA Card** — Copy the YAML above, with this watcher's id filled in
- **HA Automation** — Copy the automation YAML, with the id and your webhook already in place

---



## ⌯⌲ Telegram



### Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy its token
2. **Settings → Telegram bot**: switch it on, paste the token, **Save**. The status line should read *connected as @yourbot*
3. Send `/start` to the bot. The chat appears in Settings as **pending approval**. Until you approve it the bot ignores that chat completely, so a stranger who finds your bot gets no reply
4. Press ✓ to approve. The bot greets the chat, and it can now send links

Any number of chats can use the bot. You can rename each chat in the list, block it, or remove it.

### Notifications

Turn on **Notify** for every chat that should get them, then press **Test**. A chat doesn't have to be approved to receive notifications, because they only go out. To notify a group or channel where nobody can send `/start`, add the bot to it and use **Add chat** with its ID (for example `-1001234567890`).

- **New video**: sent for subscriptions with the **Telegram** flag turned on (under *Additional flags*). It's separate from the **Webhook** flag, so a subscription can notify Home Assistant, Telegram, both or neither.
- **Download failed**: a global toggle in Settings. Only downloads queued by subscriptions with the **Telegram** flag on are reported; manual and bot downloads never are.



### Downloading through the bot

Send a link to a single video (playlists and channels are refused). The bot replies with the title, the thumbnail, every resolution the video is actually available in with its estimated size, and an **MP3** button. Tap one, and the same message then shows the job's progress: *queued → downloading → uploading to Telegram*, or the error. When the file arrives, that message is removed.

- **Video** is always mp4 + H.264, sent as a playable video with its real size, duration and thumbnail. If a site has no H.264 stream at that size, the file is converted after the download (the reply marks those resolutions).
- **Audio** is always MP3.

Want other formats, codecs, clips or folders? Use the web UI. The bot is just another client of the same queue, so its jobs show up in **Downloads** like any other.

By default a file the bot downloaded is deleted once Telegram has it. Switch on **Keep downloaded files after sending** to leave it in `/downloads`, where Plex and similar apps will find it. A file is never deleted before it has been sent successfully.

### Size limit and the local Bot API server

`api.telegram.org` only accepts uploads of up to **50 MB**. The bot leaves out resolutions whose estimate is over the limit. If the finished file still turns out larger, the bot says so in the chat.

For files up to **2 GB**, run your own [telegram-bot-api](https://github.com/tdlib/telegram-bot-api) server next to Retriever. It is optional. It needs an `api_id` and `api_hash` from [my.telegram.org](https://my.telegram.org). You can use [this guide](https://my.telegram.org/apps). In local mode Retriever doesn't upload the file at all: it passes the server a path. So **the downloads folder must be mounted into both containers at the same path.**

```bash
docker network create retriever-net

docker run -d \
  --name pot \
  --network retriever-net \
  --init \
  brainicism/bgutil-ytdlp-pot-provider:1.3.2

docker run -d \
  --name tg-api \
  --network retriever-net \
  -e TELEGRAM_API_ID=123456 \
  -e TELEGRAM_API_HASH=0123456789abcdef0123456789abcdef \
  -v /your-directory/tg-api:/var/lib/telegram-bot-api \
  -v /your-media/youtube:/downloads:ro \
  --entrypoint telegram-bot-api \
  aiogram/telegram-bot-api:latest \
  --local --http-port=8081 \
  --dir=/var/lib/telegram-bot-api --temp-dir=/tmp/telegram-bot-api

docker run -d \
  --name retriever \
  --network retriever-net \
  -p 31080:8000 \
  -e POT_BASE_URL=http://pot:4416 \
  -v /your-directory/data:/data \
  -v /your-media/youtube:/downloads \
  ghcr.io/xinua/retriever:latest
```

The same with Compose:

```yaml
services:
  retriever:
    image: ghcr.io/xinua/retriever:latest
    container_name: retriever
    ports:
      - "31080:8000"
    volumes:
      - /mnt/tank/apps/retriever/data:/data
      - /mnt/tank/media/youtube:/downloads
    environment:
      POT_BASE_URL: http://pot:4416
    restart: unless-stopped

  pot:
    image: brainicism/bgutil-ytdlp-pot-provider:1.3.2
    container_name: retriever-pot
    init: true
    restart: unless-stopped

  tg-api:
    image: aiogram/telegram-bot-api:latest
    container_name: retriever-tg-api
    # Runs the server as root, so it can read the downloads whatever their
    # permissions. See the note below.
    entrypoint:
      - telegram-bot-api
      - --local
      - --http-port=8081
      - --dir=/var/lib/telegram-bot-api
      - --temp-dir=/tmp/telegram-bot-api
    environment:
      TELEGRAM_API_ID: "123456"
      TELEGRAM_API_HASH: 0123456789abcdef0123456789abcdef
    volumes:
      - /mnt/tank/apps/retriever/tg-api:/var/lib/telegram-bot-api
      # Same path as in the retriever service. Read-only is enough.
      - /mnt/tank/media/youtube:/downloads:ro
    restart: unless-stopped
```

> **File permissions.** The server has to be able to read every downloaded file. The image's default entrypoint drops to its own user, `telegram-bot-api` (uid 101). If your downloads folder isn't readable by that user, which is common on NAS datasets with `770` permissions or ACLs, every send fails with *can't get stat about the file*. The `entrypoint` above avoids that by running the server as root, and the `:ro` mount keeps it from changing anything. If you'd rather keep the default entrypoint, give uid 101 read and traverse access to the downloads folder and the files created in it.

The `pot` service is optional here too. Then, in **Settings → Telegram bot**, set **Bot API URL** to `http://tg-api:8081` and save. The status line should switch to *local server, 2000 MB limit*.

> **Already used the bot with api.telegram.org?** Before the same token works with a local server, the bot has to be logged out of the cloud API once. Use **Log out from cloud API** in Settings, then save the local URL. After a log-out, Telegram doesn't let the bot back onto the cloud API for about 10 minutes.

A few more things to know:

- The server's user has to be able to read your media files.
- Only one Retriever may poll a given bot token at a time. A second instance makes Telegram answer `409 Conflict`, which shows up in the status line.

---



## 🛠 Development

Angular 21 + Tailwind on the front, Fastify + SQLite (Drizzle) on the back.

```bash
pnpm setup    # install everything
pnpm dev      # frontend on :4200, backend on :8000
pnpm build    # production build of both
```

You'll want `yt-dlp` and `ffmpeg` on your `PATH` locally — the app falls back to them when the bundled binary isn't there.

---

**Looking for a feature or found a bug? [Open an issue or a PR!](https://github.com/xinua/retriever/issues)**

Licensed under the terms in [LICENSE.txt](LICENSE.txt).