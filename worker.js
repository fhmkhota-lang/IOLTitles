/**
 * IOL Titles — Social Card Studio — Cloudflare Worker
 * GET  /<pub>            → that publication's IOL RSS feed as JSON
 *                          (<pub> is a key in PUBS below; tries slug variants)
 * GET  /image?url=       → CORS image proxy (upscales IOL CDN images)
 * GET  /fullimage?url=   → scrape article og:image (full-res)
 * GET  /shorten?url=     → is.gd / v.gd shortener (no key); falls back to real URL
 * POST /claude           → Anthropic API proxy (ANTHROPIC_KEY secret)
 */
const CORS = {'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST,OPTIONS','Access-Control-Allow-Headers':'Content-Type'};

// One confirmed iol.co.za slug per title (single request each — firing many
// slug variants in parallel tripped IOL's rate limit, error 1015). Daily Voice
// and Isolezwe have no iol.co.za feed, so they use their own domain only.
const PUBS = {
  capeargus:        ['capeargus'],
  capetimes:        ['capetimes'],
  dailyvoice:       [],
  dailynews:        ['dailynews'],
  ios:              ['ios'],
  isolezwe:         [],
  mercury:          ['mercury'],
  pretorianews:     ['pretoria-news'],
  thestar:          ['the-star'],
  saturdaystar:     ['saturday-star'],
  sundaytribune:    ['sunday-tribune'],
  sundayindependent:['sundayindependent'],
  thepost:          ['thepost'],
  weekendargus:     ['weekend-argus'],
  businessreport:   ['business-report'],
};
// Friendly channel label per publication (used as fallback source).
const LABELS = {
  capeargus:'Cape Argus', capetimes:'Cape Times', dailyvoice:'Daily Voice',
  dailynews:'Daily News', ios:'Independent on Saturday', isolezwe:'Isolezwe',
  mercury:'The Mercury', pretorianews:'Pretoria News', thestar:'The Star',
  saturdaystar:'Saturday Star', sundaytribune:'Sunday Tribune',
  sundayindependent:'Sunday Independent', thepost:'The Post',
  weekendargus:'Weekend Argus', businessreport:'Business Report',
};
// Each title has its OWN website + RSS feed (title-specific content). These are
// the source of truth. The old iol.co.za/rss/extended/iol/<slug> feeds returned
// identical shared wire content across every title, so they are NOT used.
const FEED_URLS = {
  capeargus:        ['https://capeargus.co.za/rss/'],
  capetimes:        ['https://capetimes.co.za/rss/'],
  dailyvoice:       ['https://dailyvoice.co.za/rss/'],
  dailynews:        ['https://dailynews.co.za/rss/'],
  ios:              ['https://independentonsaturday.co.za/rss/'],
  isolezwe:         ['https://isolezwe.co.za/rss/'],
  mercury:          ['https://themercury.co.za/rss/'],
  pretorianews:     ['https://pretorianews.co.za/rss/'],
  thestar:          ['https://www.thestar.co.za/rss/','https://thestar.co.za/rss/'],
  saturdaystar:     ['https://www.saturdaystar.co.za/rss/','https://saturdaystar.co.za/rss/'],
  sundaytribune:    ['https://sundaytribune.co.za/rss/'],
  sundayindependent:['https://sundayindependent.co.za/rss/'],
  thepost:          ['https://www.thepost.co.za/rss/','https://thepost.co.za/rss/'],
  weekendargus:     ['https://weekendargus.co.za/rss/'],
  businessreport:   ['https://businessreport.co.za/rss/'],
};
// Substrings that mark a story as belonging to THIS title (its own domain, or
// its section path on iol.co.za). Used to float a title's own stories above the
// shared national/sport wire content.
const TITLE_MARKERS = {
  capeargus:        ['capeargus.co.za','/capeargus/'],
  capetimes:        ['capetimes.co.za','/cape-times/','/capetimes/'],
  dailyvoice:       ['dailyvoice.co.za','/daily-voice/','/dailyvoice/'],
  dailynews:        ['dailynews.co.za','/daily-news/','/dailynews/'],
  ios:              ['independentonsaturday.co.za','/independent-on-saturday/','/ios/'],
  isolezwe:         ['isolezwe.co.za','/isolezwe/'],
  mercury:          ['themercury.co.za','/the-mercury/','/mercury/'],
  pretorianews:     ['pretorianews.co.za','/pretoria-news/','/pretorianews/'],
  thestar:          ['thestar.co.za','/the-star/','/thestar/'],
  saturdaystar:     ['saturdaystar.co.za','/saturday-star/','/saturdaystar/'],
  sundaytribune:    ['sundaytribune.co.za','/sunday-tribune/','/sundaytribune/'],
  sundayindependent:['sundayindependent.co.za','/sunday-independent/','/sundayindependent/'],
  thepost:          ['thepost.co.za','/the-post/','/thepost/'],
  weekendargus:     ['weekendargus.co.za','/weekend-argus/','/weekendargus/'],
  businessreport:   ['businessreport.co.za','/business-report/','/business/'],
};

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') return new Response(null, {headers:CORS});
    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//,'').toLowerCase().trim();

    if (path === 'claude' && request.method === 'POST') {
      const key = env.ANTHROPIC_KEY;
      if (!key) return j({error:'ANTHROPIC_KEY not set in Worker secrets'},500);
      try {
        const body = await request.json();
        const res = await fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'Content-Type':'application/json','x-api-key':key,'anthropic-version':'2023-06-01'},body:JSON.stringify(body)});
        const data = await res.json();
        return new Response(JSON.stringify(data),{status:res.status,headers:{...CORS,'Content-Type':'application/json'}});
      } catch(e){return j({error:e.message},500);}
    }

    if (path === 'image') {
      let imgUrl = url.searchParams.get('url');
      if (!imgUrl) return new Response('Missing ?url=',{status:400,headers:CORS});
      if (imgUrl.includes('iol-prod.appspot.com') || imgUrl.includes('iol.co.za')) {
        try {
          const u = new URL(imgUrl);
          ['impolicy','wid','hei','fit','op_usm','qlt','fmt'].forEach(p => u.searchParams.delete(p));
          u.searchParams.set('wid', '1200');
          imgUrl = u.toString();
        } catch(e) {}
      }
      try {
        const res = await fetch(imgUrl,{headers:{'User-Agent':'Mozilla/5.0 (compatible; Googlebot/2.1)','Referer':'https://www.iol.co.za/'},cf:{cacheTtl:3600,cacheEverything:true}});
        if (!res.ok) return new Response('Failed:'+res.status,{status:res.status,headers:CORS});
        const ct = res.headers.get('content-type')||'image/jpeg';
        return new Response(await res.arrayBuffer(),{status:200,headers:{...CORS,'Content-Type':ct,'Cache-Control':'public,max-age=3600'}});
      } catch(e){return new Response('Error:'+e.message,{status:500,headers:CORS});}
    }

    if (path === 'fullimage') {
      const articleUrl = url.searchParams.get('url');
      if (!articleUrl) return j({ok:false,error:'Missing ?url='},400);
      try {
        const res = await fetch(articleUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'en-ZA,en;q=0.9',
            'Referer': 'https://www.iol.co.za/',
            'Cache-Control': 'no-cache',
          },
          cf: { cacheTtl: 1800, cacheEverything: true }
        });
        if (!res.ok) return j({ok:false, error:'HTTP '+res.status}, 502);
        const html = await res.text();
        let imgUrl = '';
        const ogImg = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
                   || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
        if (ogImg) imgUrl = ogImg[1];
        if (!imgUrl) {
          const twImg = html.match(/<meta[^>]*name=["']twitter:image["'][^>]*content=["']([^"']+)["']/i)
                     || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*name=["']twitter:image["']/i);
          if (twImg) imgUrl = twImg[1];
        }
        if (!imgUrl) {
          const srcMatch = html.match(/https?:\/\/iol-prod\.appspot\.com\/[^"'\s>]+/i);
          if (srcMatch) imgUrl = srcMatch[0];
        }
        // Also try to pull a headline + description for From-URL builder
        let title = '';
        const ogT = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
        if (ogT) title = decodeEntities(ogT[1]);
        let desc = '';
        const ogD = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
        if (ogD) desc = decodeEntities(ogD[1]);
        if (imgUrl) {
          if (imgUrl.startsWith('//')) imgUrl = 'https:' + imgUrl;
          try {
            const u = new URL(imgUrl);
            ['impolicy','wid','hei','fit','op_usm','qlt','fmt','$staticlink$'].forEach(p => u.searchParams.delete(p));
            u.searchParams.set('wid', '1200');
            return j({ok:true, url: u.toString(), title, desc});
          } catch(e) {
            return j({ok:true, url: imgUrl, title, desc});
          }
        }
        return j({ok:false, error:'No og:image found', title, desc}, 404);
      } catch(e) {
        return j({ok:false, error: String(e.message)}, 500);
      }
    }

    if (path === 'shorten') {
      const longUrl = url.searchParams.get('url');
      if (!longUrl) return j({ok:false,error:'Missing ?url='},400);
      const enc = encodeURIComponent(longUrl);
      const UA = 'Mozilla/5.0 (compatible; IOL Titles Studio/1.0)';
      const errors = [];
      const providers = [
        { name:'is.gd', url:'https://is.gd/create.php?format=simple&url='+enc },
        { name:'v.gd',  url:'https://v.gd/create.php?format=simple&url='+enc },
      ];
      for (const p of providers) {
        try {
          const r = await fetch(p.url, { headers: { 'User-Agent': UA } });
          const s = (await r.text()).trim();
          if (r.ok && s.startsWith('http')) return j({ok:true,short:s,long:longUrl,via:p.name});
          errors.push(p.name+': '+(s || ('HTTP '+r.status)));
        } catch(e){ errors.push(p.name+': '+e.message); }
      }
      return j({ok:false,error:errors.join(' | '),fallback:longUrl});
    }

    // ── Publication feed ──
    if (PUBS[path]) {
      try {
        const stories = await fetchPublication(path);
        return j({ok:true, count:stories.length, pub:path, stories});
      } catch(e) { return j({ok:false, error:e.message, pub:path, stories:[]}, 200); }
    }

    return j({ok:false,error:'Unknown path: '+path},400);
  }
};

async function fetchPublication(pub) {
  // Own-site feeds ONLY (no iol.co.za) — each title's own domain is the source
  // of truth. Reliable, no rate-limiting, and no duplicated national wire copy.
  const urls = FEED_URLS[pub] || [];
  const results = await Promise.allSettled(urls.map(u => fetchUrl(u, pub)));
  const all = [];
  for (const r of results) if (r.status === 'fulfilled') all.push(...r.value);

  // Dedupe by article slug, then sort newest-first.
  const seen = new Set(), uniq = [];
  for (const s of all) {
    const k = artKey(s.url);
    if (!k || seen.has(k)) continue;
    seen.add(k); uniq.push(s);
  }
  uniq.sort((a, b) => (b.ts || 0) - (a.ts || 0));

  // FALLBACK: several titles publish a valid but empty (or long-stale) RSS
  // channel while their site is full of current articles. When that happens,
  // read the homepage instead. Only fires when the feed is thin, so titles
  // with healthy feeds are untouched.
  const FRESH_MS = 1000 * 60 * 60 * 72; // 72h
  const newest = uniq.length ? (uniq[0].ts || 0) : 0;
  const stale = !newest || (Date.now() - newest) > FRESH_MS;
  if (uniq.length < 5 || stale) {
    try {
      const scraped = await scrapeHomepage(pub);
      if (scraped.length) {
        for (const s of scraped) {
          const k = artKey(s.url);
          if (!k || seen.has(k)) continue;
          seen.add(k); uniq.push(s);
        }
        uniq.sort((a, b) => (b.ts || 0) - (a.ts || 0));
      }
    } catch (e) { /* keep whatever the feed gave us */ }
  }

  return uniq.slice(0, 40);
}

// Homepage of each title, derived from its own feed URL.
function homepageFor(pub) {
  const u = (FEED_URLS[pub] || [])[0];
  if (!u) return '';
  try { return new URL(u).origin + '/'; } catch (e) { return ''; }
}

// Pull dated article links off a title's homepage, then read og: tags from
// each article to build proper story objects.
async function scrapeHomepage(pub) {
  const home = homepageFor(pub);
  if (!home) return [];
  const HDRS = { 'User-Agent': 'Mozilla/5.0 (compatible; IOL Titles/1.0)', 'Accept': 'text/html' };
  const res = await fetch(home, { headers: HDRS, cf: { cacheTtl: 300 } });
  if (!res.ok) return [];
  const html = await res.text();

  // Links appear as "pubUrl":"/sport/rugby/springboks/2026-08-23-slug" and can be
  // several segments deep, so capture the whole path, not just the last segment.
  const found = [...html.matchAll(/["'\\](\/(?:[a-z0-9-]+\/)*20\d{2}-\d{2}-\d{2}-[a-z0-9-]+)/g)].map(m => m[1]);
  const paths = [...new Set(found)].filter(p => p.length > 24).slice(0, 16);
  if (!paths.length) return [];

  const settled = await Promise.allSettled(
    paths.map(p => articleMeta(new URL(p, home).toString(), pub))
  );
  return settled.filter(r => r.status === 'fulfilled' && r.value).map(r => r.value);
}

async function articleMeta(url, pub) {
  const HDRS = { 'User-Agent': 'Mozilla/5.0 (compatible; IOL Titles/1.0)', 'Accept': 'text/html' };
  const res = await fetch(url, { headers: HDRS, cf: { cacheTtl: 1800 } });
  if (!res.ok) return null;
  const html = await res.text();
  const og = (prop) => {
    const a = html.match(new RegExp('<meta[^>]*property=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)', 'i'));
    if (a) return a[1];
    const b = html.match(new RegExp('<meta[^>]*content=["\']([^"\']*)["\'][^>]*property=["\']' + prop + '["\']', 'i'));
    return b ? b[1] : '';
  };
  const title = decodeEntities(og('og:title')).trim();
  if (!title || title.length < 5) return null;

  let image = og('og:image');
  if (image && image.includes('iol-prod.appspot.com')) image = image.replace(/=[swh]\d+.*$/, '') + '=w1200';

  // Date comes from the slug, which is reliable across all the titles.
  const dm = url.match(/(20\d{2})-(\d{2})-(\d{2})/);
  const ts = dm ? Date.parse(`${dm[1]}-${dm[2]}-${dm[3]}T12:00:00Z`) : 0;

  let cat = 'news';
  if (/\/sport\/|\/bafana\//.test(url)) cat = 'sport';
  else if (/\/politics\//.test(url)) cat = 'politics';
  else if (/\/business\/|business-report/.test(url)) cat = 'business';
  else if (/\/opinion\//.test(url)) cat = 'opinion';
  else if (/\/crime|city-watch/.test(url)) cat = 'crime';
  else if (/\/motoring\//.test(url)) cat = 'motoring';
  else if (/\/travel\//.test(url)) cat = 'travel';
  else if (/\/lifestyle\//.test(url)) cat = 'lifestyle';
  else if (/\/technology\//.test(url)) cat = 'technology';
  else if (/\/entertainment\//.test(url)) cat = 'entertainment';

  return {
    headline: title,
    excerpt: decodeEntities(og('og:description')).replace(/\s+/g, ' ').trim().slice(0, 220),
    category: cat,
    source: LABELS[pub] || 'IOL',
    pubDate: ts ? new Date(ts).toUTCString() : '',
    ts,
    url,
    image: image || '',
  };
}

function artKey(link) {
  try { const u = new URL(link); const p = u.pathname.split('/').filter(Boolean); return (p[p.length-1] || u.pathname).toLowerCase(); }
  catch(e) { return (link || '').toLowerCase(); }
}

async function fetchUrl(u, pub) {
  // A plain crawler UA is allowed straight through; a browser UA triggers IOL's
  // JS bot-challenge (a non-RSS page), so keep this simple. Retry once, and only
  // accept a response that actually parses into items.
  const HDRS = {'User-Agent':'Mozilla/5.0 (compatible; IOL Titles/1.0)','Accept':'application/rss+xml,text/xml'};
  let lastErr = null;
  for (let attempt=0; attempt<2; attempt++) {
    try {
      const res = await fetch(u, {headers:HDRS, cf:{cacheTtl:600}});
      if (!res.ok) { lastErr = new Error('Feed '+res.status); continue; }
      const stories = parseRSS(await res.text(), pub);
      if (stories.length) return stories;
      lastErr = new Error('empty');
    } catch(e) { lastErr = e; }
  }
  throw lastErr || new Error('fetch failed');
}

async function fetchFeed(slug, pub) {
  const paths = [
    'https://iol.co.za/rss/extended/iol/'+slug+'/',
    'https://www.iol.co.za/rss/extended/iol/'+slug+'/',
  ];
  let lastErr = null;
  for (const u of paths) {
    try {
      const stories = await fetchUrl(u, pub);
      if (stories.length) return stories;
    } catch(e) { lastErr = e; }
  }
  if (lastErr) throw lastErr;
  return [];
}

function parseRSS(xml, pub) {
  const stories=[], re=/<item>([\s\S]*?)<\/item>/g; let m;
  const src = LABELS[pub] || 'IOL';
  while((m=re.exec(xml))!==null){
    const item=m[1];
    const title=cdata(item,'title'), link=tag(item,'link')||tag(item,'guid');
    const desc=cdata(item,'description'), author=cdata(item,'author')||src, pub2=tag(item,'pubDate')||'';
    const encM=item.match(/<enclosure[^>]*url="([^"]+)"/i);
    const mediaM=item.match(/<media:content[\s\S]*?url="([^"]+)"/i)||item.match(/<media:thumbnail[\s\S]*?url="([^"]+)"/i);
    const imgM = encM || mediaM;
    if(!title||title.length<5)continue;
    // Detect a rough category from the URL, used to auto-suggest a kicker.
    let cat='news';
    if(link){
      if(/\/sport\//.test(link))cat='sport';
      else if(/\/politics\//.test(link))cat='politics';
      else if(/\/business\//.test(link)||/business-report/.test(link))cat='business';
      else if(/\/opinion\//.test(link))cat='opinion';
      else if(/\/crime/.test(link))cat='crime';
      else if(/\/motoring\//.test(link))cat='motoring';
      else if(/\/travel\//.test(link))cat='travel';
      else if(/\/lifestyle\//.test(link))cat='lifestyle';
      else if(/\/technology\//.test(link))cat='technology';
      else if(/\/entertainment\//.test(link))cat='entertainment';
    }
    stories.push({
      headline:strip(title).trim(),
      excerpt:strip(desc||'').replace(/\s+/g,' ').trim().slice(0,220),
      category:cat,
      source:strip(author).trim().slice(0,50)||src,
      pubDate:pub2,
      ts: Date.parse(pub2) || 0,
      url:link?link.trim():'https://www.iol.co.za/',
      image:imgM?imgM[1]:''
    });
  }
  return stories;
}
function cdata(x,t){const r=new RegExp('<'+t+'[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/'+t+'>','i'),m=x.match(r);return m?(m[1]!==undefined?m[1]:m[2]||'').trim():'';}
function tag(x,t){const r=new RegExp('<'+t+'[^>]*>([\\s\\S]*?)<\\/'+t+'>','i'),m=x.match(r);return m?m[1].trim():'';}
function strip(h){return decodeEntities(h.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function decodeEntities(h){
  let s = String(h||'')
    .replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/&quot;/g,'"').replace(/&apos;/g,"'")
    .replace(/&nbsp;/g,' ').replace(/&hellip;/g,'\u2026')
    .replace(/&ndash;/g,'\u2013').replace(/&mdash;/g,'\u2014')
    .replace(/&lsquo;/g,'\u2018').replace(/&rsquo;/g,'\u2019')
    .replace(/&ldquo;/g,'\u201C').replace(/&rdquo;/g,'\u201D');
  // Numeric entities: decimal (&#39;) and hex (&#x27;). The titles' og: tags are
  // hex-encoded, which is why apostrophes were showing as &#x27; on cards.
  s = s.replace(/&#[xX]([0-9a-fA-F]+);/g, (_, n) => {
        try { return String.fromCodePoint(parseInt(n, 16)); } catch(e){ return _; }
      })
      .replace(/&#(\d+);/g, (_, n) => {
        try { return String.fromCodePoint(parseInt(n, 10)); } catch(e){ return _; }
      });
  // Run &amp; last as well, to catch double-encoded input (&amp;#x27;).
  return s.replace(/&amp;/g,'&');
}
function j(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store, max-age=0'}});}
