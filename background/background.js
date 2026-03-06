// chrome.runtime.onInstalled.addListener(async () => {
//   console.log('欢迎使用');
// });

// Helpers for Youdao OpenAPI v3
const truncate = (q) => {
  const len = q.length;
  if (len <= 20) return q;
  return q.substring(0, 10) + len + q.substring(len - 10, len);
};

const toHex = (buffer) => {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
};

const sha256Hex = async (str) => {
  const data = new TextEncoder().encode(str);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return toHex(hash);
};

// Fallback: scrape Youdao web dictionary page similar to api/yiudao.ts
const decodeEntities = (s) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"');

const stripTags = (s) => decodeEntities(String(s || '').replace(/<[^>]+>/g, ''));

const extractTransContainer = (html, id) => {
  try {
    const re = new RegExp(
      `<div[^>]*id=["']${id}["'][\\s\\S]*?<div[^>]*class=["']trans-container["'][^>]*>([\\s\\S]*?)<\\/div>`,
      'i'
    );
    const m = re.exec(html);
    return m ? m[1] : '';
  } catch (_) {
    return '';
  }
};

const extractTextList = (containerHtml) => {
  const out = [];
  if (!containerHtml) return out;
  let m;
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  while ((m = liRe.exec(containerHtml))) {
    const t = stripTags(m[1]).trim();
    if (t) out.push(t);
  }
  if (out.length === 0) {
    const pRe = /<p[^>]*>([\s\S]*?)<\/p>/gi;
    while ((m = pRe.exec(containerHtml))) {
      const t = stripTags(m[1]).trim();
      if (t) out.push(t);
    }
  }
  return out;
};

const fetchYoudaoWebDict = async (q) => {
  try {
    const url = 'https://dict.youdao.com/w/' + encodeURIComponent(q.replace(/\s+/g, ' '));
    const html = await fetch(url, { method: 'GET' }).then((r) => r.text());
    const basicHtml = extractTransContainer(html, 'phrsListTab');
    const transHtml = extractTransContainer(html, 'fanyiToggle');
    const explains = extractTextList(basicHtml);
    const translation = extractTextList(transHtml);

    if (explains.length === 0 && translation.length === 0) {
      return undefined;
    }
    return {
      errorCode: 0,
      query: q,
      returnPhrase: [q],
      basic: explains.length ? { explains } : undefined,
      translation: translation.length ? translation : undefined,
    };
  } catch (e) {
    console.warn('Youdao web fallback error:', e);
    return undefined;
  }
};

chrome.runtime.onMessage.addListener(
  ({ type, payload }, sender, sendResponse) => {
    if (type === 'tf') {
      (async () => {
        try {
          const materialList = await bluesea.getMaterials();
          const material = materialList.find((it) => it.text === payload);
          if (material && material.youdao) {
            sendResponse(material.youdao);
            return;
          }
          // 默认：先尝试有道网页词典
          const pageDict = await fetchYoudaoWebDict(payload);
          if (pageDict) {
            sendResponse(pageDict);
            return;
          }

          // 网页词典失败时，再尝试开放平台（若已配置）
          const config = await bluesea.getConfig();
          const appKey = config['有道智云appkey'] || '';
          const appSecret = config['有道智云key'] || '';
          if (appKey && appSecret) {
            const salt = String(Date.now());
            const curtime = String(Math.round(Date.now() / 1000));
            const signStr = appKey + truncate(payload) + salt + curtime + appSecret;
            const sign = await sha256Hex(signStr);

            const body = new URLSearchParams({
              q: payload,
              appKey,
              salt,
              from: 'auto',
              to: 'auto',
              sign,
              signType: 'v3',
              curtime,
            }).toString();

            const res = await fetch('https://openapi.youdao.com/api', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body,
            }).then((raw) => raw.json());

            if (res && (res.errorCode === '0' || res.errorCode === 0)) {
              sendResponse(res);
              return;
            }
            console.warn('Youdao API error:', res && res.errorCode, res);
          }

          // 两种方式都未得到结果，回空让前端显示提示
          sendResponse();
        } catch (e) {
          console.warn('TF fetch error:', e);
          sendResponse();
        }
      })();
    }

    if (type === 'calcEls') {
      const forLowerCase = (text) => {
        return text.toLowerCase();
      };
      const result = payload[0].reduce((pre, cur, index) => {
        const hasExist = payload[1].some((it) => {
          return forLowerCase(cur).includes(forLowerCase(it.text));
        });
        return hasExist ? [...pre, index] : pre;
      }, []);
      sendResponse(result);
    }

    return true;
  }
);
