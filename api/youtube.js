module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = (req.body && req.body.url) || (req.query && req.query.url);
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const videoMatch = url.match(
            /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
        );
        if (!videoMatch) return res.json({status: false, message: 'Invalid YouTube URL'});

        const videoId = videoMatch[1];

        // ===== METADATA =====
        let title = "YouTube Video";
        let thumbnail = "https://i.ytimg.com/vi/" + videoId + "/hqdefault.jpg";

        try {
            const oembedRes = await fetch(
                "https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=" + videoId + "&format=json"
            );
            if (oembedRes.ok) {
                const oData = await oembedRes.json();
                title = oData.title || title;
                thumbnail = oData.thumbnail_url || thumbnail;
            }
        } catch (_) {}

        console.log("[YT] Coba API 1: Convert1s...");
        let downloadUrl = await tryConvert1s(videoId);

        if (!downloadUrl) {
            console.log("[YT] API 1 gagal, coba API 2: YTMP3.mobi...");
            downloadUrl = await tryYtmp3(videoId);
        }

        if (!downloadUrl) {
            console.log("[YT] API 2 gagal, coba API 3: ytdl...");
            downloadUrl = await tryYtdl(videoId);
        }

        if (!downloadUrl) {
            return res.json({
                status: false,
                message: 'Semua API gagal. Video mungkin kena copyright atau gak available.'
            });
        }

        console.log("[YT] BERHASIL!");
        return res.json({
            status: true,
            result: {
                title: title,
                thumbnail: thumbnail,
                type: "video",
                downloads: [{type: "video", quality: "360p", url: downloadUrl}],
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};


// ===== API 1: CONVERT1S =====
async function tryConvert1s(videoId) {
    try {
        const headers = {
            "Origin": "https://media.ytmp3.gg",
            "Referer": "https://media.ytmp3.gg/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
        };

        const convRes = await fetch("https://hub.convert1s.com/api/download", {
            method: "POST",
            headers: headers,
            body: JSON.stringify({
                url: "https://www.youtube.com/watch?v=" + videoId,
                os: "macos",
                output: {type: "video", format: "mp4", quality: "360p"},
                audio: {bitrate: "128k"},
            }),
        });
        const conv = await convRes.json();

        if (!conv || conv.error || !conv.statusUrl) return null;

        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1200));
            try {
                const pollRes = await fetch(conv.statusUrl, {headers: headers});
                const poll = await pollRes.json();
                if (poll && poll.status === "completed" && poll.downloadUrl) {
                    return poll.downloadUrl;
                }
                if (poll && (poll.status === "error" || poll.status === "failed")) return null;
            } catch (_) {}
        }
        return null;
    } catch (e) {
        return null;
    }
}


// ===== API 2: YTMP3.MOBI =====
async function tryYtmp3(videoId) {
    try {
        const headers = {
            "Origin": "https://ytmp3.mobi",
            "Referer": "https://ytmp3.mobi/",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        };

        const initRes = await fetch("https://a.ymcdn.org/api/v1/init?p=y&23=1llum1n471", {headers});
        const initData = await initRes.json();
        if (!initData || !initData.convertURL) return null;

        const convRes = await fetch(initData.convertURL + "&v=" + videoId + "&f=mp4", {headers});
        const convData = await convRes.json();
        if (!convData || convData.error) return null;

        let finalUrl = convData.downloadURL;
        let progress = 0;

        for (let i = 0; i < 10; i++) {
            await new Promise(r => setTimeout(r, 2000));
            try {
                const progRes = await fetch(convData.progressURL, {headers});
                const progData = await progRes.json();
                progress = progData.progress || 0;
                if (progData.downloadURL) finalUrl = progData.downloadURL;
                if (progress === 4) break;
            } catch (_) {}
        }

        if (finalUrl && progress >= 3) {
            if (finalUrl.startsWith("//")) finalUrl = "https:" + finalUrl;
            return finalUrl;
        }
        return null;
    } catch (e) {
        return null;
    }
}


// ===== API 3: ytdl (fallback terakhir) =====
async function tryYtdl(videoId) {
    try {
        // Coba pake API publik lain (contoh: y2mate-like API)
        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            "Content-Type": "application/json",
        };

        // API publik 1: ytmp3.cc
        try {
            const r1 = await fetch("https://ytmp3.cc/api/v1/convert", {
                method: "POST",
                headers: headers,
                body: JSON.stringify({
                    url: "https://www.youtube.com/watch?v=" + videoId,
                    format: "mp4",
                    quality: "360p",
                }),
            });
            const d1 = await r1.json();
            if (d1 && d1.url) return d1.url;
        } catch (_) {}

        // API publik 2: loader.to
        try {
            const r2 = await fetch("https://loader.to/api/ajax/search", {
                method: "POST",
                headers: {
                    ...headers,
                    "Content-Type": "application/x-www-form-urlencoded",
                },
                body: "video_id=" + videoId + "&format=mp4",
            });
            const d2 = await r2.json();
            if (d2 && d2.id) {
                // Poll loader.to
                for (let i = 0; i < 10; i++) {
                    await new Promise(r => setTimeout(r, 2000));
                    const poll = await fetch(
                        "https://loader.to/api/progress/?callback=&id=" + d2.id,
                        {headers}
                    );
                    const pd = await poll.text();
                    const match = pd.match(/"download_url":"([^"]+)"/);
                    if (match && match[1]) return match[1].replace(/\\\//g, "/");
                }
            }
        } catch (_) {}

        return null;
    } catch (e) {
        return null;
    }
}
