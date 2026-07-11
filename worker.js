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

// Each publication -> ordered list of candidate RSS slugs. The worker tries
// them in order and returns the first that yields items. This absorbs IOL's
// inconsistent slug formatting (some titles hyphenate, some don't).
const PUBS = {
  capeargus:        ['capeargus','cape-argus'],
  capetimes:        ['capetimes','cape-times'],
  dailyvoice:       ['dailyvoice','daily-voice','voice'],
  dailynews:        ['dailynews','daily-news'],
  ios:              ['ios','independent-on-saturday','the-independent-on-saturday'],
  isolezwe:         ['isolezwe','isolezwe-news'],
  mercury:          ['mercury','the-mercury'],
  pretorianews:     ['pretoria-news','pretorianews'],
  thestar:          ['the-star','thestar'],
  saturdaystar:     ['saturday-star','saturdaystar'],
  sundaytribune:    ['sunday-tribune','sundaytribune'],
  sundayindependent:['sundayindependent','sunday-independent'],
  thepost:          ['thepost','the-post'],
  weekendargus:     ['weekend-argus','weekendargus'],
  businessreport:   ['business-report','businessreport','business'],
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
  const slugs = PUBS[pub] || [pub];
  for (const slug of slugs) {
    try {
      const stories = await fetchFeed(slug, pub);
      if (stories.length) return stories;
    } catch(e) { /* try next candidate */ }
  }
  return [];
}

async function fetchFeed(slug, pub) {
  const HDRS = {'User-Agent':'Mozilla/5.0 (compatible; IOL Titles/1.0)','Accept':'application/rss+xml,text/xml'};
  const paths = [
    'https://iol.co.za/rss/extended/iol/'+slug+'/',
    'https://www.iol.co.za/rss/extended/iol/'+slug+'/',
  ];
  let lastErr = null;
  for (const u of paths) {
    try {
      const res = await fetch(u, {headers:HDRS, cf:{cacheTtl:60}});
      if (!res.ok) { lastErr = new Error('Feed '+res.status); continue; }
      const stories = parseRSS(await res.text(), pub);
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
      url:link?link.trim():'https://www.iol.co.za/',
      image:imgM?imgM[1]:''
    });
  }
  return stories;
}
function cdata(x,t){const r=new RegExp('<'+t+'[^>]*>(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))<\\/'+t+'>','i'),m=x.match(r);return m?(m[1]!==undefined?m[1]:m[2]||'').trim():'';}
function tag(x,t){const r=new RegExp('<'+t+'[^>]*>([\\s\\S]*?)<\\/'+t+'>','i'),m=x.match(r);return m?m[1].trim():'';}
function strip(h){return decodeEntities(h.replace(/<[^>]+>/g,' ')).replace(/\s+/g,' ').trim();}
function decodeEntities(h){return String(h||'').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#0?39;/g,"'").replace(/&#8217;/g,"'").replace(/&#8216;/g,"'").replace(/&#8220;/g,'"').replace(/&#8221;/g,'"').replace(/&nbsp;/g,' ');}
function j(data,status=200){return new Response(JSON.stringify(data),{status,headers:{...CORS,'Content-Type':'application/json','Cache-Control':'no-store, max-age=0'}});}
