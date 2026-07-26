const axios = require('axios');

class BaseScraper {
    constructor(name, baseUrl) {
        this.name = name;
        this.baseUrl = baseUrl;
        this.timeout = 15000;
        this.userAgents = [
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
            'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
        ];
    }

    getRandomUserAgent() {
        return this.userAgents[Math.floor(Math.random() * this.userAgents.length)];
    }

    getHeaders(extra = {}) {
        return {
            'User-Agent': this.getRandomUserAgent(),
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Connection': 'keep-alive',
            ...extra
        };
    }

    async fetch(url, options = {}) {
        try {
            const response = await axios({
                url,
                method: options.method || 'GET',
                headers: this.getHeaders(options.headers || {}),
                timeout: this.timeout,
                maxRedirects: 5,
                validateStatus: (status) => status < 500,
                ...options
            });
            return response;
        } catch (error) {
            throw error;
        }
    }

    async getSource(id, type, season, episode) {
        throw new Error('getSource() not implemented');
    }

    extractVideoUrls(html) {
        const urls = [];
        const patterns = [
            /https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*/gi,
            /https?:\/\/[^\s"'<>]+\.mp4[^\s"'<>]*/gi
        ];
        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                const url = match[0];
                if (url && !urls.includes(url)) urls.push(url);
            }
        }
        return urls;
    }
}

module.exports = BaseScraper;
