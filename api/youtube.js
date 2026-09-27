module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.body.url || req.query.url;
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const videoMatch = url.match(
            /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?|shorts|live)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i
        );
        if (!videoMatch) return res.json({status: false, message: 'Invalid YouTube URL'});

        const videoId = videoMatch[1];
        const headers = {
            Origin: "https://media.ytmp3.gg",
            Referer: "https://media.ytmp3.gg/",
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            Accept: "application/json, text/plain, */*",
            "Content-Type": "application/json",
        };

        let title = "YouTube Video";
        let thumbnail = `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`;

        try {
            const oembedRes = await fetch(
                `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`
            );
            if (oembedRes.ok) {
                const oData = await oembedRes.json();
                title = oData.title || title;
                thumbnail = oData.thumbnail_url || thumbnail;
            }
        } catch (_) {}

        // Convert1s API
        const convRes = await fetch("https://hub.convert1s.com/api/download", {
            method: "POST",
            headers,
            body: JSON.stringify({
                url: `https://www.youtube.com/watch?v=${videoId}`,
                os: "macos",
                output: {type: "video", format: "mp4", quality: "360p"},
                audio: {bitrate: "128k"},
            }),
        });
        const conv = await convRes.json();

        if (!conv || conv.error || !conv.statusUrl) {
            return res.json({status: false, message: 'Convert1s failed'});
        }

        // Poll
        let downloadUrl = null;
        for (let i = 0; i < 15; i++) {
            await new Promise(r => setTimeout(r, 1200));
            const pollRes = await fetch(conv.statusUrl, {headers});
            const poll = await pollRes.json();
            if (poll?.status === "completed" && poll?.downloadUrl) {
                downloadUrl = poll.downloadUrl;
                break;
            }
            if (poll?.status === "error" || poll?.status === "failed") break;
        }

        if (!downloadUrl) {
            return res.json({status: false, message: 'Could not get download link'});
        }

        return res.json({
            status: true,
            result: {
                title,
                thumbnail,
                type: "video",
                downloads: [{type: "video", quality: "360p", url: downloadUrl}],
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};
