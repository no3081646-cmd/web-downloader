module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = (req.body && req.body.url) || (req.query && req.query.url);
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        if (!url.includes('soundcloud.com')) {
            return res.json({status: false, message: 'Bukan link SoundCloud'});
        }

        const result = await scrapeSoundCloud(url);
        return res.json(result);

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};


async function scrapeSoundCloud(url) {
    try {
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";
        let cookies = [];

        const updateCookies = (headers) => {
            const setCookie = headers.getSetCookie ? headers.getSetCookie() : [];
            setCookie.forEach((c) => {
                const val = c.split(";")[0];
                if (val) cookies.push(val);
            });
        };

        const getCookieHeader = () => cookies.join("; ");

        // ===== STEP 1: Get CSRF token =====
        const tokenRes = await fetch("https://www.klickaud.org/csrf-token-endpoint.php", {
            headers: {
                "User-Agent": ua,
                "Referer": "https://www.klickaud.org/en17/",
                "Accept": "application/json",
            },
        });
        updateCookies(tokenRes.headers);

        const tokenData = await tokenRes.json();
        const csrfToken = tokenData?.csrf_token;

        if (!csrfToken) {
            return {status: false, message: "Gagal dapet CSRF token."};
        }

        // ===== STEP 2: Submit track URL =====
        const params = new URLSearchParams();
        params.append("value", url);
        params.append("csrf_token", csrfToken);

        const postRes = await fetch("https://www.klickaud.org/download.php", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Referer": "https://www.klickaud.org/en17/",
                "Origin": "https://www.klickaud.org",
                "Content-Type": "application/x-www-form-urlencoded",
                "Cookie": getCookieHeader(),
            },
            body: params.toString(),
        });
        updateCookies(postRes.headers);

        const html = await postRes.text();
        const downloadMode = (html.match(/const\s+downloadMode\s*=\s*["']([^"']+)["']/) || [])[1];
        const directUrl = (html.match(/const\s+directDownloadUrl\s*=\s*["']([^"']*)["']/) || [])[1];
        const defaultFileName = (html.match(/const\s+defaultFileName\s*=\s*["']([^"']+)["']/) || [])[1] || "SoundCloud Track";
        const sseGrant = (html.match(/const\s+sseGrant\s*=\s*["']([^"']+)["']/) || [])[1];

        const cleanTitle = (raw) =>
            raw
                .replace(/_KLICKAUD\.mp3$/i, "")
                .replace(/_forhub_soundcloud_to_mp3\.mp3$/i, "")
                .replace(/\.mp3$/i, "")
                .replace(/_/g, " ")
                .trim();

        // ===== MODE A: Direct download =====
        if (downloadMode === "direct" && directUrl) {
            return {
                status: true,
                result: {
                    title: cleanTitle(defaultFileName),
                    thumbnail: "",
                    type: "audio",
                    downloads: [{type: "audio", quality: "MP3 128kbps", url: directUrl}],
                },
            };
        }

        // ===== MODE B: Worker SSE processing =====
        if (!sseGrant) {
            return {status: false, message: "Gagal dapet session grant."};
        }

        const capRes = await fetch("https://www.klickaud.org/sse_capability.php", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Referer": "https://www.klickaud.org/download.php",
                "Origin": "https://www.klickaud.org",
                "Content-Type": "application/json",
                "Cookie": getCookieHeader(),
            },
            body: JSON.stringify({grant: sseGrant, url}),
        });
        updateCookies(capRes.headers);

        const capData = await capRes.json();
        const capability = capData?.capability;

        if (!capability) {
            return {status: false, message: "Gagal authorize capability."};
        }

        const sseUrl = `https://www.klickaud.org/worker_sse.php?url=${encodeURIComponent(url)}&cap=${encodeURIComponent(capability)}`;

        // ===== STEP 3: Poll SSE =====
        const sseRes = await fetch(sseUrl, {
            headers: {
                "User-Agent": ua,
                "Referer": "https://www.klickaud.org/download.php",
                "Cookie": getCookieHeader(),
                "Accept": "text/event-stream",
            },
        });

        if (!sseRes.ok) {
            return {status: false, message: "SSE connection failed"};
        }

        const reader = sseRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let found = false;
        let result = null;

        const startTime = Date.now();
        const timeout = 45000;

        while (!found && (Date.now() - startTime) < timeout) {
            const {done, value} = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, {stream: true});

            if (buffer.includes("event: ready")) {
                const lines = buffer.split("\n");
                for (let i = 0; i < lines.length; i++) {
                    if (lines[i].trim() === "event: ready" && lines[i + 1]?.startsWith("data:")) {
                        try {
                            const data = JSON.parse(lines[i + 1].replace("data:", "").trim());
                            if (data.download_url) {
                                found = true;
                                const title = data.file_name ? cleanTitle(data.file_name) : cleanTitle(defaultFileName);
                                result = {
                                    status: true,
                                    result: {
                                        title: title,
                                        thumbnail: "",
                                        type: "audio",
                                        downloads: [{type: "audio", quality: "MP3 128kbps", url: data.download_url}],
                                    },
                                };
                                break;
                            }
                        } catch (e) {}
                    }
                }
            }

            if (buffer.includes("event: failed")) {
                found = true;
                result = {status: false, message: "Worker gagal proses track ini."};
                break;
            }
        }

        if (result) return result;
        return {status: false, message: "Timeout atau gagal dapet download URL."};

    } catch (err) {
        return {status: false, message: err.message};
    }
}
