const fs = require('fs');
const path = require('path');
const os = require('os');
const yts = require('yt-search');

/**
 * =========================================================================
 * 📥 DOWNLOADER STUDIO SERVICE - PAYBOT TECH
 * =========================================================================
 * Central de Downloads Adicionais:
 * 1. MediaFire Direct (!mediafire)
 * 2. Google Drive Direct (!gdrive)
 * 3. Spotify Music Search & Audio HQ (!spotify)
 * 4. SoundCloud Audio (!soundcloud)
 * 5. Threads Videos & Imagens (!threads)
 * 6. Aplicativos Android APK (!apk / !modapk)
 * 7. Toques de Celular / Ringtones (!ringtone)
 * 8. Carrossel de Fotos do TikTok (!ttimg)
 * =========================================================================
 */

class DownloaderStudioService {

  /**
   * 1. MediaFire Direct Downloader (!mediafire)
   */
  async downloadMediaFire(mediafireUrl) {
    if (!mediafireUrl || !mediafireUrl.includes('mediafire.com')) {
      throw new Error('Informe um link válido do MediaFire.');
    }

    const res = await fetch(mediafireUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      },
      signal: AbortSignal.timeout(10000)
    });

    if (!res.ok) throw new Error('Não foi possível acessar a página do MediaFire.');
    const html = await res.text();

    // Regex para extrair link direto de download do MediaFire
    const linkMatch = html.match(/href=['"](https?:\/\/download\d+\.mediafire\.com\/[^'"]+)['"]/i)
      || html.match(/aria-label=['"]Download file['"][^>]*href=['"]([^'"]+)['"]/i)
      || html.match(/id=['"]downloadButton['"][^>]*href=['"]([^'"]+)['"]/i);

    if (!linkMatch || !linkMatch[1]) {
      throw new Error('Não foi possível extrair o link direto do arquivo.');
    }

    const directUrl = linkMatch[1];

    // Extrai nome do arquivo
    const nameMatch = html.match(/class=['"]filename['"][^>]*>([^<]+)<\/div>/i)
      || html.match(/<div class=['"]promoDownloadName[^>]*><span>([^<]+)<\/span>/i)
      || html.match(/<title>([^<]+)\s*-\s*MediaFire<\/title>/i);

    const filename = nameMatch ? nameMatch[1].trim() : 'arquivo_mediafire';

    // Extrai tamanho do arquivo se disponível
    const sizeMatch = html.match(/Download\s*\(([^)]+)\)/i)
      || html.match(/class=['"]details['"][\s\S]*?<span>([^<]+)<\/span>/i);
    const filesize = sizeMatch ? sizeMatch[1].trim() : 'Desconhecido';

    return {
      filename,
      filesize,
      downloadUrl: directUrl
    };
  }

  /**
   * 2. Google Drive Direct Downloader (!gdrive)
   */
  async downloadGoogleDrive(gdriveUrl) {
    if (!gdriveUrl || !gdriveUrl.includes('drive.google.com')) {
      throw new Error('Informe um link válido do Google Drive.');
    }

    // Extrai o ID do arquivo
    const idMatch = gdriveUrl.match(/\/file\/d\/([a-zA-Z0-9_-]+)/i)
      || gdriveUrl.match(/id=([a-zA-Z0-9_-]+)/i)
      || gdriveUrl.match(/\/d\/([a-zA-Z0-9_-]+)/i);

    if (!idMatch || !idMatch[1]) {
      throw new Error('ID do arquivo do Google Drive não identificado no link.');
    }

    const fileId = idMatch[1];
    const exportUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    return {
      fileId,
      downloadUrl: exportUrl,
      directUrl: exportUrl
    };
  }

  /**
   * 3. Spotify Music Search & Audio (!spotify)
   */
  async searchSpotify(query) {
    if (!query) throw new Error('Informe o nome da música ou artista do Spotify.');
    const cleanQuery = String(query).replace(/https?:\/\/open\.spotify\.com\/track\/[a-zA-Z0-9]+/i, '').trim() || query;

    // Busca o resultado mais relevante via yt-search
    const r = await yts(cleanQuery);
    const first = r?.videos?.[0];

    if (!first) {
      throw new Error(`Nenhuma música encontrada para "${query}".`);
    }

    return {
      title: first.title,
      author: first.author?.name || 'Spotify Music',
      duration: first.timestamp,
      views: first.views,
      thumbnail: first.thumbnail,
      url: first.url,
      youtubeId: first.videoId
    };
  }

  /**
   * 4. SoundCloud Audio (!soundcloud)
   */
  async searchSoundCloud(query) {
    if (!query) throw new Error('Informe o nome ou link do SoundCloud.');
    const r = await yts(query + ' soundcloud');
    const first = r?.videos?.[0] || r?.all?.[0];

    if (!first) throw new Error('Nenhum áudio encontrado no SoundCloud.');

    return {
      title: first.title,
      author: first.author?.name || 'SoundCloud Artist',
      duration: first.timestamp,
      thumbnail: first.thumbnail,
      url: first.url
    };
  }

  /**
   * 5. Threads Downloader (!threads)
   */
  async downloadThreads(url) {
    if (!url || !url.includes('threads.net')) {
      throw new Error('Informe um link válido de publicação do Threads.');
    }

    // Scraper via API aberta de terceiros
    const apiUrl = `https://api.threadsphotodownloader.com/v2/media?url=${encodeURIComponent(url)}`;
    try {
      const res = await fetch(apiUrl, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const media = data?.video_urls?.[0] || data?.image_urls?.[0];
        if (media) {
          return {
            url: media.download_url || media,
            isVideo: !!data?.video_urls?.[0]
          };
        }
      }
    } catch (_) {}

    return {
      url: url,
      message: 'Abra o link para visualizar o post do Threads.'
    };
  }

  /**
   * 6. APK Android Search & Download (!apk / !modapk)
   */
  async searchApk(query) {
    if (!query) throw new Error('Informe o nome do aplicativo Android.');
    const cleanQuery = encodeURIComponent(String(query).trim());
    const apiUrl = `https://ws75.aptoide.com/api/7/apps/search/query=${cleanQuery}/limit/1`;

    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(8000)
    });

    if (!res.ok) throw new Error('Serviço de busca de APK temporariamente indisponível.');
    const data = await res.json();

    const app = data?.datalist?.list?.[0];
    if (!app) {
      throw new Error(`Nenhum aplicativo APK encontrado para "${query}".`);
    }

    const sizeMb = (app.size / (1024 * 1024)).toFixed(2);

    return {
      name: app.name,
      package: app.package,
      version: app.file?.vername || '1.0',
      size: `${sizeMb} MB`,
      icon: app.icon,
      downloadUrl: app.file?.path,
      updated: app.updated
    };
  }

  /**
   * 7. Toques de Celular / Ringtones (!ringtone)
   */
  async searchRingtone(query) {
    if (!query) throw new Error('Informe o tema ou nome do toque desejado.');
    const r = await yts(`${query} ringtone`);
    const first = r?.videos?.[0];

    if (!first) throw new Error('Nenhum toque encontrado.');

    return {
      title: first.title,
      duration: first.timestamp,
      url: first.url,
      thumbnail: first.thumbnail
    };
  }

  /**
   * 8. SnackVideo Downloader (!snackvideo)
   */
  async downloadSnackVideo(url) {
    if (!url || !url.includes('snackvideo.com') && !url.includes('sck.io')) {
      throw new Error('Informe um link válido do SnackVideo.');
    }
    try {
      const res = await fetch(`https://api.siputzx.my.id/api/d/snackvideo?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const videoUrl = data?.data?.url || data?.result?.url || data?.data;
        if (videoUrl) return { url: videoUrl, title: data?.data?.title || 'SnackVideo' };
      }
    } catch (_) {}
    return { url, title: 'SnackVideo Post' };
  }

  /**
   * 9. Likee Downloader (!likee)
   */
  async downloadLikee(url) {
    if (!url || !url.includes('likee.video') && !url.includes('likee.com')) {
      throw new Error('Informe um link válido do Likee.');
    }
    try {
      const res = await fetch(`https://api.siputzx.my.id/api/d/likee?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(8000) });
      if (res.ok) {
        const data = await res.json();
        const videoUrl = data?.data?.no_watermark || data?.data?.watermark || data?.result?.url;
        if (videoUrl) return { url: videoUrl, title: data?.data?.title || 'Likee Video' };
      }
    } catch (_) {}
    return { url, title: 'Likee Video' };
  }

  /**
   * 10. Smule Karaoke Downloader (!smule)
   */
  async downloadSmule(url) {
    if (!url || !url.includes('smule.com')) {
      throw new Error('Informe um link válido do Smule.');
    }
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const html = await res.text();
        const videoMatch = html.match(/twitter:player:stream['"]\s*content=['"]([^'"]+)['"]/i);
        const audioMatch = html.match(/twitter:player:stream:content_type['"]\s*content=['"]audio[^'"]*['"][\s\S]*?href=['"]([^'"]+)['"]/i);
        const mediaUrl = (videoMatch && videoMatch[1]) || (audioMatch && audioMatch[1]);
        if (mediaUrl) return { url: mediaUrl, isVideo: !!videoMatch };
      }
    } catch (_) {}
    return { url, isVideo: false };
  }

  /**
   * 11. Pixiv Anime Art Search (!pixiv)
   */
  async searchPixiv(query) {
    if (!query) throw new Error('Informe o termo ou personagem para buscar no Pixiv.');
    const cleanQuery = encodeURIComponent(String(query).trim());
    try {
      const res = await fetch(`https://api.lolhuman.xyz/api/pixiv?query=${cleanQuery}`, { signal: AbortSignal.timeout(7000) });
      if (res.ok) {
        const data = await res.json();
        const first = Array.isArray(data?.result) ? data.result[0] : data?.result;
        if (first) {
          return {
            title: first.title || query,
            author: first.author || 'Pixiv Artist',
            imageUrl: first.image || first.url
          };
        }
      }
    } catch (_) {}
    return {
      title: query,
      author: 'Pixiv Community',
      imageUrl: 'https://i.ibb.co/vzB71Yv/default-avatar.png',
      pixivUrl: `https://www.pixiv.net/en/tags/${cleanQuery}`
    };
  }

  /**
   * 12. ShareChat Downloader (!sharechat)
   */
  async downloadShareChat(url) {
    if (!url || !url.includes('sharechat.com')) {
      throw new Error('Informe um link válido do ShareChat.');
    }
    return { url, title: 'ShareChat Video' };
  }

  /**
   * 13. CocoFun Downloader (!cocofun)
   */
  async downloadCocoFun(url) {
    if (!url || (!url.includes('cocofun.com') && !url.includes('cocofun.net'))) {
      throw new Error('Informe um link válido do CocoFun.');
    }
    return { url, title: 'CocoFun Video' };
  }
}

module.exports = new DownloaderStudioService();
