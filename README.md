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

<details>
  <summary>📸 Expand more screenshots</summary>
  <br>
  <img src="demo/theme/static.gif" alt="Step 1" width="100%">
  <img src="demo/theme/animations/fire.gif" alt="Step 2" width="100%">
  <img src="demo/theme/animations/rain.gif" alt="Step 3" width="100%">
  <img src="demo/theme/animations/snow.gif" alt="Step 4" width="100%">
  <img src="demo/theme/animations/stars.gif" alt="Step 5" width="100%">
  <img src="demo/theme/animations/matrix.gif" alt="Step 6" width="100%">
</details>

## ✨ Features



### Download now

- 🔗 **Paste anything** — single video, playlist, or a whole channel (expanded into one job per video)
- 🌍 **YouTube, TikTok, Instagram**, and everything else `yt-dlp` handles
- 🎬 **Video** — MP4 or iOS-friendly, up to 4K, codec-pinned to H.264 / H.265 / AV1 / VP9
- 🎵 **Audio** — MP3, M4A, OPUS, WAV, FLAC at 128 / 192 / 320 kbps or best available
- 🖼 **Thumbnail-only** downloads
- ✂️ **Clip** a time range without fetching the whole video
- 📑 **Split by chapters** — one file per chapter
- 🚫 **SponsorBlock** — cut sponsor segments automatically
- 📂 **Destination folder** with autocomplete over folders you already use, plus filename prefixes
- ⚙️ **Extra** `yt-dlp` **arguments** per download, per channel, or globally



### Watch channels

- 📡 **RSS-based tracking** — no API key, no quota
- ⏱ **Flexible polling** — every N minutes, or at a fixed time each day
- 🎯 **Per-channel settings** — type, format, codec, folder, prefix, extra args, webhook
- 🩳 **Shorts** included or skipped, your call



### The queue

- 📊 **Live progress** over WebSocket — percentage, real speed, honest ETA, size
- ⚡ **Parallel downloads**, configurable (default 2)
- 🔁 **Automatic retries** that know the difference between "try again" and "this video is gone"
- ⏹ **Retry, cancel, stop-all, delete, clear finished** — all one click
- 🔍 **Search and filter** by status across your whole history
- 💾 **Save any finished file** straight to the browser
- 🖼 **Posters everywhere** — when a download arrives with no artwork, a frame is pulled out of the file itself
- ▶️ **Play downloaded** — watch downloaded video by click on poster
- 🛡 **Atomic writes** — in-progress files live in a hidden temp folder and only move into place when complete, so your media scanner never sees a half-downloaded episode



### Integrations & interface

- 🔔 **Webhooks** — global or per-channel, with a test-send button that shows you the exact payload
- 🖼️ **Widget page** — for Home Assistant iframe cards, with the latest video playable in place
- 📄 **Copy-ready Home Assistant YAML** — card and automation snippets, per subscription, one click each
- 🎨 **Seven theme colors** — ten section backgrounds, optional animations
- 📋 **Auto-paste** — the URL field grabs the link from your clipboard
- 🧲 **Drag to reorder** — the whole page layout
- 📱 **Responsive + PWA** — install like mobile app

---



## 🚀 Quick start



### Docker

```bash
docker run -d \
  --name retriever \
  -p 31080:8000 \
  -v /your-directory/data:/data \
  -v /your-media/youtube:/downloads \
  ghcr.io/aprilborn/retriever:latest
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
  ghcr.io/aprilborn/retriever:latest
```

The network is the part people miss: containers only resolve each other by name
on a **user-defined** network, so without `docker network create` the
`http://pot:4416` above has nothing to point at. The provider needs no volumes
and no published port — only Retriever talks to it.

Open Settings (⚙️) after starting: a green **POT provider: connected** line
under the yt-dlp version means the two found each other.

### Docker Compose

Save as `docker-compose.yml` and run `docker compose up -d`, or paste it
straight into a TrueNAS **Custom App** — it's the same file either way:

```yaml
services:
  retriever:
    image: ghcr.io/aprilborn/retriever:latest
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
    image: ghcr.io/aprilborn/retriever:latest
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


| Variable           | Default                 | What it does                                              |
| ------------------ | ----------------------- | --------------------------------------------------------- |
| `PORT`             | `8000`                  | Port inside the container                                 |
| `HOST`             | `0.0.0.0`               | Bind address                                              |
| `DATA_DIR`         | `/data`                 | Database, images, archive                                 |
| `DOWNLOADS_DIR`    | `/downloads`            | Default download root                                     |
| `YTDLP_BIN`        | `/usr/local/bin/yt-dlp` | The bundled binary to stage from                          |
| `MAX_MANUAL_ITEMS` | `500`                   | Cap on how many videos one pasted channel/playlist queues |
| `POT_BASE_URL`     | *(unset)*               | POT provider server to use — see below. Unset = disabled  |
| `POT_PLUGIN_DIR`   | `/app/pot-plugin`       | Where the bundled POT plugin lives                        |


In the **Settings** dialog you can set the downloads folder, a cookies file, global `yt-dlp` arguments, how many downloads run at once, and your webhook URL — plus update `yt-dlp` itself with one click.

---



## 📁 How files are stored

Finished files are written to your `/downloads` mount, using the **Folder** and **Prefix** you chose:

```
/downloads/<folder>/<prefix><video title>.<ext>
```

Already-downloaded videos from watched channels are recorded in `/data/ytdlp-archive.txt` and are never fetched twice. (Manual downloads deliberately skip the archive — if you asked for a file explicitly, you get it.)

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
3. Choose a polling mode — every N minutes, or at a set time each day
4. Set the format, folder, and prefix you want for that channel
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
  "date": "2026-09-05T12:00:00.000Z"
}
```

`watcherId` is the watcher's own id — the same one the widget URL below takes — not the channel's YouTube id.

**Widget cards.** Each watcher has a compact page showing its latest video:

```
http://localhost:31080/widget/<watcherId>
```

![Widget example](demo/widget.webp)

Drop that into an iframe card. The card plays the file in place — press the poster and the video (or audio) starts right there, no jump to another tab.

```yaml
type: iframe
url: http://localhost:31080/widget/1
aspect_ratio: 50%
```

**Don't type any of this.** Expand a subscription and open its **⋯** menu:

- **Open widget** — the page on its own, to check it
- **HA Card** — Copy the YAML above, with this watcher's id filled in
- **HA Automation** — Copy the automation YAML, with the id and your webhook already in place

To find a **watcher id** by hand, expand the subscription and hover over the channel name.

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

**Looking for a feature or found a bug? [Open an issue or a PR!](https://github.com/aprilborn/retriever/issues)**

Licensed under the terms in [LICENSE.txt](LICENSE.txt).