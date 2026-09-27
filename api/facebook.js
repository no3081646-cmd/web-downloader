const cheerio = require("cheerio");

function decodeSnapSave(data) {
    try {
        const regex = /eval\(function\(h,u,n,t,e,r\)\{.*?\}\("(.*?)",(\d+),"(.*?)",(\d+),(\d+),(\d+)\)\)/;
        const match = data.match(regex);
        if (match) {
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
            return decodeURIComponent(escape(decoded));
        }
        return data;
    } catch (err) {
        return data;
    }
}

function extractFinalUrl(input) {
    if (!input) return null;
    let raw = input.trim().replace(/^["'\\]+|["'\\]+$/g, "");
    if (raw.includes("get_progressApi")) {
        const tokenMatch = raw.match(/token=([^&'"]+)/);
        if (tokenMatch) raw = tokenMatch[1];
    }
    if (raw.includes(".") && !raw.startsWith("http")) {
        try {
            const payloadPart = raw.split(".")[1];
            if (payloadPart) {
                const payload = JSON.parse(Buffer.from(payloadPart, "base64").toString());
                if (payload.video_url) return {url: payload.video_url};
                if (payload.url) return {url: payload.url};
            }
        } catch (e) {}
    }
    if (raw.startsWith("//")) return {url: "https:" + raw};
    if (raw.startsWith("/")) return {url: "https://snapsave.app" + raw};
    return {url: raw};
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.body.url || req.query.url;
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
            Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            Origin: "https://snapsave.app",
            Referer: "https://snapsave.app/id",
        };

        let finalUrl = url.trim();
        try {
            const redirectCheck = await fetch(finalUrl, {headers, redirect: "follow"});
            finalUrl = redirectCheck.url || finalUrl;
        } catch (e) {}

        const r1 = await fetch("https://snapsave.app/id", {headers});
        const cookies = r1.headers.get("set-cookie") || "";
        const cookieStr = cookies.split(",").map(c => c.split(";")[0]).join("; ");

        const response = await fetch("https://snapsave.app/action.php?lang=id", {
            method: "POST",
            headers: {
                ...headers,
                "Content-Type": "application/x-www-form-urlencoded",
                Cookie: cookieStr,
            },
            body: `url=${encodeURIComponent(finalUrl)}`,
        });
        const rawData = await response.text();
        const decodedHtml = decodeSnapSave(rawData);
        const $ = cheerio.load(decodedHtml);

        const downloads = [];
        $("table tbody tr").each((i, el) => {
            const quality = $(el).find("td.video-quality").length ? $(el).find("td.video-quality").text().trim() : $(el).find("td").eq(0).text().trim();
            const linkAttr = $(el).find("a.btn-download").attr("href") || $(el).find("button").attr("onclick") || $(el).find("a").attr("href");
            const extracted = extractFinalUrl(linkAttr);
            if (extracted && extracted.url && extracted.url.startsWith("http")) {
                downloads.push({quality: quality || "Normal", url: extracted.url, type: "video"});
            }
        });

        if (downloads.length === 0) {
            return res.json({status: false, message: 'No download links found'});
        }

        return res.json({
            status: true,
            result: {
                title: "Facebook Video",
                thumbnail: "",
                type: "video",
                downloads,
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};
