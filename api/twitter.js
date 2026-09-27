const cheerio = require("cheerio");

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.body.url || req.query.url;
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const cleanUrl = url.trim().split("?")[0];
        const twitterUrl = cleanUrl.replace(/https:\/\/(?:x|fixupx|fxtwitter|vxtwitter|nitter)\.com/g, "https://twitter.com");
        const ua = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36";

        const r1 = await fetch("https://savetwt.com/", {headers: {"User-Agent": ua}});
        const cookies1 = (r1.headers.get("set-cookie") || "").split(",").map(c => c.split(";")[0]).join("; ");
        const $1 = cheerio.load(await r1.text());
        const csrf = $1('input[name="_token"]').val();

        if (!csrf) return res.json({status: false, message: 'CSRF failed'});

        const postRes = await fetch("https://savetwt.com/download", {
            method: "POST",
            headers: {
                Cookie: cookies1,
                "Content-Type": "application/x-www-form-urlencoded",
                Accept: "application/json",
                "X-Requested-With": "XMLHttpRequest",
                "User-Agent": ua,
                Referer: "https://savetwt.com/",
                Origin: "https://savetwt.com",
            },
            body: new URLSearchParams({_token: csrf, return_locale: "en", url: twitterUrl}).toString(),
        });
        const postJson = await postRes.json();

        if (!postJson || !postJson.redirect) {
            return res.json({status: false, message: postJson?.message || 'SaveTWT failed'});
        }

        let redirectUrl = postJson.redirect;
        if (redirectUrl.startsWith("/")) redirectUrl = "https://savetwt.com" + redirectUrl;

        const r3 = await fetch(redirectUrl, {
            headers: {Cookie: cookies1, "User-Agent": ua, Referer: "https://savetwt.com/"},
        });
        const $3 = cheerio.load(await r3.text());
        const downloads = [];
        const seen = new Set();

        $3("a[href*='dl.savetwt.com'], a[href*='savetwt.com/d/']").each((_, a) => {
            const dlUrl = $3(a).attr("href");
            if (dlUrl && dlUrl.startsWith("http") && !seen.has(dlUrl)) {
                seen.add(dlUrl);
                downloads.push({quality: "720p", type: "video", url: dlUrl});
            }
        });

        if (downloads.length === 0) {
            return res.json({status: false, message: 'No download links found'});
        }

        return res.json({
            status: true,
            result: {
                title: "Twitter Media",
                thumbnail: "",
                type: "video",
                downloads,
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};
