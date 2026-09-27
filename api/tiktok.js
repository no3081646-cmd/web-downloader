const crypto = require("crypto");

const salt = "sn4pt1k_v3r1fy2026";
const userAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
];

function sha256(text) {
  return crypto.createHash("sha256").update(text).digest();
}

function decryptAes(id, encryptedBase64) {
  const data = Buffer.from(encryptedBase64, "base64");
  const iv = data.subarray(0, 16);
  const encrypted = data.subarray(16);
  const keySource = salt + ":" + id;
  const key = sha256(keySource);
  const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);
  let decrypted = decipher.update(encrypted);
  decrypted = Buffer.concat([decrypted, decipher.final()]);
  return decrypted.toString("utf8");
}

function solveChallenge(challenge) {
  switch (challenge.t) {
    case "b": return ((challenge.a ^ challenge.b) >> challenge.s) & 255;
    case "r": return challenge.n.reduce((m, f) => m + f, 0) * 2 + 1;
    case "c": return challenge.w.charCodeAt(challenge.i) * challenge.m;
    case "m": return ((challenge.a + challenge.b) % 100) * challenge.c;
    case "n": return challenge.a * challenge.b + challenge.b * challenge.c + challenge.c * challenge.a - challenge.a;
    default: throw new Error("Unknown challenge: " + challenge.t);
  }
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const url = req.body.url || req.query.url;
        if (!url) return res.status(400).json({status: false, message: 'URL required'});

        const userAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        const baseHeaders = {
            "User-Agent": userAgent,
            "Referer": "https://snaptik.app/",
            "Origin": "https://snaptik.app",
        };

        // Step 1: Get token
        const tokenRes = await fetch("https://snaptik.app/api/token", {
            method: "POST",
            headers: {
                ...baseHeaders,
                "X-Requested-With": "XMLHttpRequest",
                "Content-Type": "application/json",
            },
            body: JSON.stringify({}),
        });
        const tokenData = await tokenRes.json();

        if (!tokenData?.id || !tokenData?.p) {
            return res.json({status: false, message: 'Failed to get token'});
        }

        const {id, p} = tokenData;
        const decryptedJson = decryptAes(id, p);
        const challenge = JSON.parse(decryptedJson);

        const _e = challenge._e;
        const _h = challenge._h;
        delete challenge._e;
        delete challenge._h;

        const challengeResult = solveChallenge(challenge);
        const xVerify = `${id}:${challengeResult}:${_e}:${_h}`;

        // Step 2: Extract
        const extractRes = await fetch(
            `https://snaptik.app/api/extract?url=${encodeURIComponent(url)}`,
            {
                method: "GET",
                headers: {
                    ...baseHeaders,
                    "X-Requested-With": "XMLHttpRequest",
                    "X-Verify": xVerify,
                },
            }
        );
        const extractData = await extractRes.json();

        if (!extractData?.success || !extractData?.data) {
            return res.json({status: false, message: extractData?.message || 'Failed to extract'});
        }

        const info = extractData.data;
        const downloads = [];

        if (info.downloadUrl) downloads.push({type: "mp4", quality: "Normal", url: info.downloadUrl});
        if (info.hdDownloadUrl) {
            const hdUrl = info.hdDownloadUrl.startsWith("http") ? info.hdDownloadUrl : "https://snaptik.app" + info.hdDownloadUrl;
            downloads.push({type: "mp4", quality: "HD", url: hdUrl});
        }

        return res.json({
            status: true,
            result: {
                title: info.title || "TikTok Video",
                thumbnail: info.thumbnail || "",
                type: "video",
                downloads,
            },
        });

    } catch (error) {
        return res.status(500).json({status: false, message: error.message});
    }
};
