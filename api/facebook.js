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

        // Step 1: Resolve redirect
        let fullUrl = url;
        try {
            const r = await fetch(url, {headers: {"User-Agent": ua}, redirect: 'follow'});
            fullUrl = r.url || url;
        } catch (_) {}

        // Step 2: Init session — ambil cookie
        const initRes = await fetch("https://snapsave.app/id", {
            headers: {
                "User-Agent": ua,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
            },
        });
        
        // Ambil cookie dari header set-cookie
        const setCookieArr = initRes.headers.getSetCookie ? initRes.headers.getSetCookie() : [];
        const cookieStr = setCookieArr.map(c => c.split(";")[0]).join("; ");
        
        console.log("[FB] Cookie:", cookieStr);
        
        // Step 3: Submit URL pake cookie
        const params = new URLSearchParams();
        params.append("url", fullUrl);

        const postRes = await fetch("https://snapsave.app/action.php?lang=id", {
            method: "POST",
            headers: {
                "User-Agent": ua,
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://snapsave.app",
                "Referer": "https://snapsave.app/id",
                "Cookie": cookieStr,
                "Accept": "application/json, text/plain, */*",
                "X-Requested-With": "XMLHttpRequest",
                "Accept-Language": "id-ID,id;q=0.9,en;q=0.8",
            },
            body: params.toString(),
        });

        let html = await postRes.text();
        console.log("[FB] Response length:", html.length);

        // Step 4: Decode eval
        if (html.includes("eval(function")) {
            html = decodeEval(html);
        }

        // Step 5: Extract URL download pake regex
        const downloads = [];
        const seen = new Set();

        // Regex cari URL video
        const patterns = [
            /href="(https?:\/\/[^"]*fbcdn[^"]*)"/gi,
            /href="(https?:\/\/[^"]*\.mp4[^"]*)"/gi,
            /href="(https?:\/\/[^"]*video[^"]*\.mp4[^"]*)"/gi,
            /(https?:\/\/[^"'\s]*fbcdn[^"'\s]*\.mp4[^"'\s]*)/gi,
            /href="(https?:\/\/scontent[^"]*)"/gi,
        ];

        for (const regex of patterns) {
            let match;
            while ((match = regex.exec(html)) !== null) {
                const u = match[1] || match[0];
                if (!seen.has(u) && u.startsWith('http') && !u.includes('snapsave.app')) {
                    seen.add(u);
                    downloads.push({
                        type: "video",
                        quality: downloads.length === 0 ? "HD" : "SD",
                        url: u,
                    });
                }
            }
        }

        if (downloads.length === 0) {
            return {
                status: false,
                message: 'Gak nemu link download. Coba link FB lain.',
            };
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


// Decode eval(function...)
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
