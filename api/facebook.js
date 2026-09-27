module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = (req.body && req.body.url) || (req.query && req.query.url);
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        if (!url.includes('facebook.com') && !url.includes('fb.watch')) {
            return res.json({status: false, message: 'Bukan link Facebook'});
        }

        const result = await scrapeFacebook(url);
        return res.json(result);

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};


async function scrapeFacebook(url) {
    try {
        const ua = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

        // Step 1: Resolve redirect (fb.watch → full URL)
        let fullUrl = url;
        try {
            const r = await fetch(url, {headers: {"User-Agent": ua}, redirect: 'follow'});
            fullUrl = r.url || url;
        } catch (_) {}

        // Step 2: Coba snapsave.app
        let downloads = await trySnapSave(fullUrl, ua);

        // Step 3: Kalo gagal, coba getfvid.com
        if (downloads.length === 0) {
            downloads = await tryGetFvid(fullUrl, ua);
        }

        // Step 4: Kalo gagal, coba snapsave.app alternatif (mobile API)
        if (downloads.length === 0) {
            downloads = await trySnapSaveMobile(fullUrl, ua);
        }

        if (downloads.length === 0) {
            return {status: false, message: 'Gak nemu link download. Video mungkin private.'};
        }

        return {
            status: true,
            result: {
                title: "Facebook Video",
                thumbnail: "",
                type: "video",
                downloads: downloads,
            },
        };

    } catch (err) {
        return {status: false, message: err.message};
    }
}


// ===== OPSI 1: SnapSave =====
async function trySnapSave(url, ua) {
    try {
        // Init
        const initRes = await fetch("https://snapsave.app/id", {
            headers: {"User-Agent": ua},
        });
        const setCookie = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookieStr = setCookie.map(c => c.split(";")[0]).join("; ");

        // Post
        const params = new URLSearchParams();
        params.append("url", url);

        const postRes = await fetch("https://snapsave.app/action.php?lang=id", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://snapsave.app",
                "Referer": "https://snapsave.app/id",
                "Cookie": cookieStr,
            },
            body: params.toString(),
        });

        let html = await postRes.text();

        // Decode kalo ada eval(function...
        if (html.includes("eval(function")) {
            html = decodeEval(html);
        }

        // Extract link pake regex (gak pake cheerio — lebih fleksibel)
        const downloads = [];
        const seen = new Set();

        // Regex cari URL download
        const urlRegex = /href="(https?:\/\/[^"]*(?:rapidcdn|snapcdn|fbcdn|video)[^"]*)"/gi;
        let match;
        while ((match = urlRegex.exec(html)) !== null) {
            const u = match[1];
            if (!seen.has(u) && !u.includes('snapsave.app') && !u.includes('play.google.com')) {
                seen.add(u);
                downloads.push({
                    type: "video",
                    quality: downloads.length === 0 ? "HD" : "SD",
                    url: u,
                });
            }
        }

        // Kalo gak ada, cari yg pake https:// apapun
        if (downloads.length === 0) {
            const genericRegex = /href="(https?:\/\/[^"]+)"/gi;
            while ((match = genericRegex.exec(html)) !== null) {
                const u = match[1];
                if (!seen.has(u) && !u.includes('snapsave.app') && !u.includes('play.google.com') && !u.includes('facebook.com')) {
                    seen.add(u);
                    downloads.push({type: "video", quality: "HD", url: u});
                }
            }
        }

        return downloads;
    } catch (e) {
        return [];
    }
}


// ===== OPSI 2: GetFvid =====
async function tryGetFvid(url, ua) {
    try {
        const params = new URLSearchParams();
        params.append("url", url);

        const r = await fetch("https://www.getfvid.com/downloader", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.getfvid.com",
                "Referer": "https://www.getfvid.com/",
            },
            body: params.toString(),
        });

        const html = await r.text();

        const downloads = [];
        const seen = new Set();
        const urlRegex = /href="(https?:\/\/[^"]*(?:fbcdn|video|mp4)[^"]*)"/gi;
        let match;
        while ((match = urlRegex.exec(html)) !== null) {
            const u = match[1];
            if (!seen.has(u) && !u.includes('getfvid.com')) {
                seen.add(u);
                downloads.push({
                    type: "video",
                    quality: downloads.length === 0 ? "HD" : "SD",
                    url: u,
                });
            }
        }
        return downloads;
    } catch (e) {
        return [];
    }
}


// ===== OPSI 3: SnapSave Mobile API =====
async function trySnapSaveMobile(url, ua) {
    try {
        const params = new URLSearchParams();
        params.append("url", url);

        const r = await fetch("https://snapsave.app/action.php", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://snapsave.app",
                "Referer": "https://snapsave.app/",
                "X-Requested-With": "XMLHttpRequest",
            },
            body: params.toString(),
        });

        const text = await r.text();

        // SnapSave kadang balikin JSON
        try {
            const json = JSON.parse(text);
            if (json && json.data && Array.isArray(json.data)) {
                return json.data.map((d, i) => ({
                    type: "video",
                    quality: d.label || (i === 0 ? "HD" : "SD"),
                    url: d.url,
                }));
            }
        } catch (_) {}

        return [];
    } catch (e) {
        return [];
    }
}


// ===== Helper: Decode eval(function...) =====
function decodeEval(data) {
    try {
        const regex = /eval\(function\(h,u,n,t,e,r\)\{.*?\}\("(.*?)",(\d+),"(.*?)",(\d+),(\d+),(\d+)\)\)/;
        const match = data.match(regex);
        if (!match) return data;

        const h = match[1];
        const n = match[3];
        const t = parseInt(match[4]);
        const e = parseInt(match[5]);

        const delimiter = n[e];
        const parts = h.split(delimiter);
        let decoded = "";

        for (let s of parts) {
            if (s === "") continue;
            let val = 0;
            for (let j = 0; j < s.length; j++) {
                val += n.indexOf(s[j]) * Math.pow(e, s.length - 1 - j);
            }
            decoded += String.fromCharCode(val - t);
        }
        return decoded;
    } catch (e) {
        return data;
    }
}
