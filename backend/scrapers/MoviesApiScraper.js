const BaseScraper = require('./BaseScraper');

class MoviesApiScraper extends BaseScraper {
    constructor() {
        super('moviesapi', 'https://moviesapi.club');
    }

    async getSource(tmdbId, type, season, episode) {
        try {
            let url;
            if (type === 'tv' && season && episode) {
                url = `${this.baseUrl}/tv/${tmdbId}-${season}-${episode}`;
            } else {
                url = `${this.baseUrl}/movie/${tmdbId}`;
            }

            const response = await this.fetch(url, {
                headers: { 'Referer': this.baseUrl }
            });

            if (response.status === 200 && response.data.length > 100) {
                const videoUrls = this.extractVideoUrls(response.data);
                if (videoUrls.length > 0) {
                    return {
                        source: this.name,
                        type: videoUrls[0].includes('.m3u8') ? 'hls' : 'direct',
                        url: videoUrls[0],
                        quality: 'Auto'
                    };
                }
                return {
                    source: this.name,
                    type: 'embed',
                    url: url,
                    quality: 'Auto',
                    embedUrl: url
                };
            }
            return null;
        } catch (error) {
            throw error;
        }
    }
}

module.exports = MoviesApiScraper;
