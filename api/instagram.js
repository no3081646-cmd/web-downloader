const cheerio = require("cheerio");

function extractHtmlFromScript(str) {
    if (typeof str !== "string") return "";
    let matched = "";
    const idxDouble = str.indexOf('innerHTML = "');
    if (idxDouble !== -1) {
        const start = idxDouble + 'innerHTML = "'.length;
        const lastQuote = str.lastIndexOf('";');
        const end = lastQuote !== -1 ? lastQuote : str.lastIndexOf('"');
        if (end > start) {
            const rawString = str.slice(start, end);
            try { matched = eval('"' + rawString + '"'); }
            catch (_) { matched = rawString.replace(/\\"/g, '"').replace(/\\\\/g, "\\"); }
        }
    }
    return matched;
}

function cleanUrlString(input) {
    if (!input) return null;
    let raw = input.trim().replace(/^["'\\]+|["'\\]+$/g, "");
    if (raw.startsWith("//")) raw = "https:" + raw;
    return raw.startsWith("http") ? raw : null;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.body.url || req.query.url;
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const cleanUrl = url.trim().split("?")[0];
        const headers = {
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36",
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            "X-Requested-With": "XMLHttpRequest",
            Origin: "https://snapsave.app",
            Referer: "https://snapsave.app/",
        };

        const r = await fetch("https://snapsave.app/action.php", {
            method: "POST",
            headers,
            body: `url=${encodeURIComponent(cleanUrl)}`,
        });
        const rawData = await r.text();

        let htmlContent = "";
        if (typeof rawData === "string" && rawData.trim().startsWith("<")) {
            htmlContent = rawData;
        } else {
            try {
                const codeToRun = rawData.replace(/\beval\s*\(\s*function/g, "(function");
                const unpacked = eval(codeToRun);
                htmlContent = extractHtmlFromScript(unpacked) || extractHtmlFromScript(rawData);
            } catch (_) {
                htmlContent = extractHtmlFromScript(rawData);
            }
        }

        if (!htmlContent) {
            return res.json({status: false, message: 'Empty response'});
        }

        const $ = cheerio.load(htmlContent);
        const downloads = [];
        const seen = new Set();

        $("a[href^='http'], a[href*='rapidcdn'], a[href*='snapcdn']").each((_, a) => {
            const href = cleanUrlString($(a).attr("href"));
            if (href && !href.includes("snapsave.app") && !href.includes("play.google.com") && !seen.has(href)) {
                seen.add(href);
                downloads.push({quality: "HD", type: "video", url: href});
            }
        });

        if (downloads.length === 0) {
            return res.json({status: false, message: 'No download links found'});
        }

        return res.json({
            status: true,
            result: {
                title: "Instagram Media",
                thumbnail: "",
                type: "video",
                downloads,
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};
