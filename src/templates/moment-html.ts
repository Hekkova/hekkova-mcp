// ─────────────────────────────────────────────────────────────────────────────
// Hekkova MCP Server — Self-Contained Moment HTML Template
//
// Produces a single HTML file that can be opened in any browser.
// Encrypted moments require the owner's passphrase to view.
// Full Moon moments display content directly — no passphrase needed.
//
// The decryption JavaScript uses ONLY the Web Crypto API (no dependencies).
// Crypto parameters MUST stay in sync with src/lib/crypto.ts:
//   PBKDF2: 600,000 iterations, SHA-256, 16-byte salt → 256-bit key
//   AES-GCM: 12-byte IV, 128-bit auth tag appended to ciphertext
// ─────────────────────────────────────────────────────────────────────────────

export interface MomentHTMLOptions {
  title: string;
  content: string;        // plaintext for full_moon; ignored (replaced by encryption.ciphertext) for others
  mediaType: string;      // e.g. 'text/plain', 'image/jpeg', 'video/mp4', 'audio/mp3'
  category: string | null;
  phase: string;
  createdAt: string;
  blockId: string;
  tokenId: string;
  contractAddress: string;
  ipfsCid?: string;
  lighthouseCid?: string;
  encryption?: {
    ciphertext: string;       // base64 — content encrypted with master key
    iv: string;               // base64 — AES-GCM IV
    encryptedEntropy: string; // base64 — Light Key entropy encrypted with passphrase wrapping key
    entropyIV: string;        // base64
    passphraseSalt: string;   // base64
    seedSalt: string;         // base64
    verificationHash: string; // hex SHA-256 of master key
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers
// ─────────────────────────────────────────────────────────────────────────────

function phaseLabel(phase: string): string {
  const map: Record<string, string> = {
    new_moon: 'New Moon',
    crescent: 'Crescent',
    gibbous: 'Gibbous',
    full_moon: 'Full Moon',
  };
  return map[phase] ?? phase;
}

function phaseDescription(phase: string): string {
  const map: Record<string, string> = {
    new_moon: 'Private — owner only',
    crescent: 'Close Circle',
    gibbous: 'Extended Circle',
    full_moon: 'Public',
  };
  return map[phase] ?? '';
}

function categoryLabel(category: string | null): string {
  if (!category) return '';
  const map: Record<string, string> = {
    super_moon: 'Super Moon',
    blue_moon: 'Blue Moon',
    super_blue_moon: 'Super Blue Moon',
    eclipse: 'Eclipse',
  };
  return map[category] ?? category;
}

function categoryColor(category: string | null): string {
  const map: Record<string, string> = {
    super_moon: '#c9a84c',
    blue_moon: '#4a80c9',
    super_blue_moon: 'linear-gradient(135deg,#c9a84c,#4a80c9)',
    eclipse: '#6b3fa0',
  };
  return (category && map[category]) ? map[category] : '#444';
}

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      year: 'numeric', month: 'long', day: 'numeric',
    });
  } catch {
    return iso;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Content renderer snippet (injected into JS as a function body string)
// ─────────────────────────────────────────────────────────────────────────────

function renderContentJS(mediaType: string): string {
  if (mediaType.startsWith('image/')) {
    return `
      var img = document.createElement('img');
      img.src = 'data:${mediaType};base64,' + content;
      img.style.cssText = 'max-width:100%;border-radius:12px;margin-top:1rem;';
      img.alt = '';
      contentEl.appendChild(img);`;
  }
  if (mediaType.startsWith('video/')) {
    return `
      var vid = document.createElement('video');
      vid.src = 'data:${mediaType};base64,' + content;
      vid.controls = true;
      vid.style.cssText = 'max-width:100%;border-radius:12px;margin-top:1rem;';
      contentEl.appendChild(vid);`;
  }
  if (mediaType.startsWith('audio/')) {
    return `
      var aud = document.createElement('audio');
      aud.src = 'data:${mediaType};base64,' + content;
      aud.controls = true;
      aud.style.cssText = 'width:100%;margin-top:1rem;';
      contentEl.appendChild(aud);`;
  }
  // text/plain or anything else
  return `
      var p = document.createElement('p');
      p.textContent = content;
      p.style.cssText = 'white-space:pre-wrap;line-height:1.7;margin:0;';
      contentEl.appendChild(p);`;
}

// Render content inline for full_moon (server-side, no JS decryption needed)
function renderContentInline(content: string, mediaType: string): string {
  if (mediaType.startsWith('image/')) {
    return `<img src="data:${mediaType};base64,${content}" style="max-width:100%;border-radius:12px;margin-top:1rem;" alt="">`;
  }
  if (mediaType.startsWith('video/')) {
    return `<video controls style="max-width:100%;border-radius:12px;margin-top:1rem;"><source src="data:${mediaType};base64,${content}"></video>`;
  }
  if (mediaType.startsWith('audio/')) {
    return `<audio controls style="width:100%;margin-top:1rem;"><source src="data:${mediaType};base64,${content}"></audio>`;
  }
  // text
  const escaped = content
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return `<p style="white-space:pre-wrap;line-height:1.7;margin:0;">${escaped}</p>`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main export
// ─────────────────────────────────────────────────────────────────────────────

export function buildMomentHTML(opts: MomentHTMLOptions): string {
  const {
    title, content, mediaType, category, phase,
    createdAt, blockId, tokenId, contractAddress,
    ipfsCid = '', lighthouseCid = '', encryption,
  } = opts;

  const isEncrypted = !!encryption;
  const catLabel = categoryLabel(category);
  const catColor = categoryColor(category);
  const phLabel = phaseLabel(phase);
  const phDesc = phaseDescription(phase);
  const dateStr = formatDate(createdAt);
  const polygonscanUrl = `https://polygonscan.com/token/${contractAddress}?a=${tokenId}`;
  const ipfsUrl = ipfsCid ? `https://ipfs.io/ipfs/${ipfsCid}` : '';

  // ── Shared styles ─────────────────────────────────────────────────────────
  const css = `
*{box-sizing:border-box;margin:0;padding:0}
html{height:100%}
body{
  font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;
  background:#0a0a0f;
  color:#e8e2d9;
  min-height:100%;
  padding:2rem 1rem 4rem;
  line-height:1.6;
}
a{color:#c9a84c;text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:680px;margin:0 auto}
.wordmark{
  font-size:1.1rem;
  font-weight:700;
  letter-spacing:.12em;
  text-transform:uppercase;
  color:#c9a84c;
  margin-bottom:2.5rem;
  display:block;
}
/* ── Metadata bar ── */
.meta{
  border:1px solid #1e1e2a;
  border-radius:12px;
  padding:1.25rem 1.5rem;
  background:#0f0f18;
  margin-bottom:1.5rem;
  display:flex;
  flex-wrap:wrap;
  gap:.75rem;
  align-items:center;
}
.badge{
  display:inline-block;
  padding:.25rem .7rem;
  border-radius:20px;
  font-size:.75rem;
  font-weight:600;
  letter-spacing:.06em;
  text-transform:uppercase;
}
.badge-cat{background:${catColor.startsWith('linear') ? '#222' : catColor + '22'};color:${catColor.startsWith('linear') ? '#c9a84c' : catColor};border:1px solid ${catColor.startsWith('linear') ? '#c9a84c44' : catColor + '44'}}
.badge-phase{background:#1a1a2a;color:#a09080;border:1px solid #2a2a3a;font-size:.7rem}
.meta-date{font-size:.8rem;color:#6a6070;margin-left:auto}
.meta-links{width:100%;display:flex;flex-wrap:wrap;gap:1rem;font-size:.8rem;color:#6a6070;margin-top:.25rem}
.meta-links a{color:#7a6a9a}
/* ── Passphrase card ── */
.card{
  background:#0f0f18;
  border:1px solid #1e1e2a;
  border-radius:16px;
  padding:2.5rem 2rem;
  margin-bottom:1.5rem;
  text-align:center;
}
.card-icon{font-size:2.5rem;margin-bottom:1rem;opacity:.7}
.card h2{font-size:1.25rem;font-weight:600;margin-bottom:.5rem;color:#e8e2d9}
.card p{font-size:.9rem;color:#8a8090;margin-bottom:1.5rem}
.input-wrap{position:relative;margin-bottom:1rem}
input[type=password],input[type=text]{
  width:100%;
  padding:.75rem 2.75rem .75rem 1rem;
  background:#1a1a24;
  border:1px solid #2a2a3a;
  border-radius:10px;
  color:#e8e2d9;
  font-size:1rem;
  outline:none;
  transition:border-color .2s;
}
input:focus{border-color:#c9a84c44}
.toggle-vis{
  position:absolute;right:.75rem;top:50%;transform:translateY(-50%);
  background:none;border:none;cursor:pointer;
  color:#6a6070;font-size:.85rem;padding:.25rem;
}
.btn{
  width:100%;
  padding:.8rem;
  background:#c9a84c;
  color:#0a0a0f;
  border:none;
  border-radius:10px;
  font-size:1rem;
  font-weight:700;
  cursor:pointer;
  letter-spacing:.04em;
  transition:opacity .2s;
}
.btn:hover{opacity:.88}
.btn:disabled{opacity:.4;cursor:not-allowed}
.error{color:#e05555;font-size:.85rem;margin-top:.75rem;min-height:1.2em}
/* ── Moment view ── */
.moment{
  background:#0f0f18;
  border:1px solid #1e1e2a;
  border-radius:16px;
  padding:2rem;
  margin-bottom:1.5rem;
}
.moment h1{font-size:1.5rem;font-weight:700;margin-bottom:1.25rem;color:#f0ece4}
.moment-content{font-size:1rem;color:#c8c0b8}
/* ── Footer ── */
.footer{font-size:.78rem;color:#3a3545;text-align:center;margin-top:2rem}
@media(max-width:480px){
  .card{padding:1.75rem 1.25rem}
  .moment{padding:1.5rem}
  .meta{padding:1rem}
}`;

  // ── Metadata bar HTML (always visible) ────────────────────────────────────
  const metaBar = `<div class="meta">
  ${catLabel ? `<span class="badge badge-cat">${catLabel}</span>` : ''}
  <span class="badge badge-phase">${phLabel} &middot; ${phDesc}</span>
  <span class="meta-date">${dateStr}</span>
  <div class="meta-links">
    <span>Block ID: <span style="color:#c9a84c;font-family:monospace;font-size:.75rem">${blockId}</span></span>
    ${ipfsUrl ? `<a href="${ipfsUrl}" target="_blank" rel="noopener">IPFS</a>` : ''}
    ${lighthouseCid ? `<a href="https://gateway.lighthouse.storage/ipfs/${lighthouseCid}" target="_blank" rel="noopener">Filecoin</a>` : ''}
    <a href="${polygonscanUrl}" target="_blank" rel="noopener">Polygonscan</a>
  </div>
</div>`;

  // ── Full Moon (public) path ───────────────────────────────────────────────
  if (!isEncrypted) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title} \u2014 Hekkova</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <span class="wordmark">Hekkova</span>
  ${metaBar}
  <div class="moment">
    <h1>${title.replace(/</g, '&lt;')}</h1>
    <div class="moment-content">${renderContentInline(content, mediaType)}</div>
  </div>
  <p class="footer">This moment is public and permanently stored on IPFS and the Polygon blockchain.</p>
</div>
</body>
</html>`;
  }

  // ── Encrypted path ────────────────────────────────────────────────────────
  const enc = encryption!;
  const encDataJson = JSON.stringify({
    ciphertext: enc.ciphertext,
    iv: enc.iv,
    encryptedEntropy: enc.encryptedEntropy,
    entropyIV: enc.entropyIV,
    passphraseSalt: enc.passphraseSalt,
    seedSalt: enc.seedSalt,
    verificationHash: enc.verificationHash,
    mediaType,
  });

  const decryptJS = `
(function(){
console.log('[Hekkova] decrypt script initialized');
var ENC=${encDataJson};

function b64ToBytes(b64){
  var bin=atob(b64),buf=new Uint8Array(bin.length);
  for(var i=0;i<bin.length;i++)buf[i]=bin.charCodeAt(i);
  return buf;
}
function hexStr(buf){
  return Array.from(new Uint8Array(buf)).map(function(b){return b.toString(16).padStart(2,'0')}).join('');
}

function showError(msg){
  document.getElementById('err').textContent=msg;
  document.getElementById('btn').disabled=false;
}

async function unlock(){
  console.log('[Hekkova] unlock() called');
  document.getElementById('err').textContent='';
  document.getElementById('btn').disabled=true;
  var pass=document.getElementById('pp').value;
  if(!pass){document.getElementById('btn').disabled=false;return;}

  try{
    var subtle=window.crypto&&window.crypto.subtle;
    if(!subtle){
      console.error('[Hekkova] Web Crypto API unavailable — page must be served over HTTPS or localhost');
      return showError('Decryption unavailable. Open this file over HTTPS or localhost.');
    }

    // 1. Import passphrase as PBKDF2 key material
    var passKey=await subtle.importKey(
      'raw',new TextEncoder().encode(pass),
      {name:'PBKDF2'},false,['deriveBits']
    );

    // 2. Derive wrapping key from passphrase + passphraseSalt
    var wkBits=await subtle.deriveBits(
      {name:'PBKDF2',salt:b64ToBytes(ENC.passphraseSalt),iterations:600000,hash:'SHA-256'},
      passKey,256
    );
    var wk=await subtle.importKey('raw',wkBits,{name:'AES-GCM'},false,['decrypt']);
    console.log('[Hekkova] wrapping key derived');

    // 3. Decrypt entropy (raw 32 bytes) using wrapping key
    var entropyBytes;
    try{
      entropyBytes=await subtle.decrypt(
        {name:'AES-GCM',iv:b64ToBytes(ENC.entropyIV)},
        wk,b64ToBytes(ENC.encryptedEntropy)
      );
      console.log('[Hekkova] entropy decrypted');
    }catch(e){
      console.error('[Hekkova] entropy decrypt failed (wrong passphrase?):', e);
      return showError('Incorrect passphrase. Please try again.');
    }

    // 4. Derive master key from entropy + seedSalt
    var entropyKey=await subtle.importKey(
      'raw',entropyBytes,{name:'PBKDF2'},false,['deriveBits']
    );
    var mkBits=await subtle.deriveBits(
      {name:'PBKDF2',salt:b64ToBytes(ENC.seedSalt),iterations:600000,hash:'SHA-256'},
      entropyKey,256
    );
    console.log('[Hekkova] master key derived');

    // 5. Verify master key
    var mkHash=hexStr(await subtle.digest('SHA-256',mkBits));
    console.log('[Hekkova] verification hash computed:', mkHash, '| expected:', ENC.verificationHash);
    if(mkHash!==ENC.verificationHash){
      console.error('[Hekkova] verification hash mismatch — wrong passphrase or corrupt data');
      return showError('Incorrect passphrase. Please try again.');
    }

    // 6. Import master key and decrypt content
    var mk=await subtle.importKey('raw',mkBits,{name:'AES-GCM'},false,['decrypt']);
    var contentBytes;
    try{
      contentBytes=await subtle.decrypt(
        {name:'AES-GCM',iv:b64ToBytes(ENC.iv)},
        mk,b64ToBytes(ENC.ciphertext)
      );
      console.log('[Hekkova] content decrypted, bytes:', contentBytes.byteLength);
    }catch(e){
      console.error('[Hekkova] content decrypt failed:', e);
      return showError('Decryption failed. Please try again.');
    }

    // 7. Decode content string.
    //    The encrypted payload stores content as a base64-encoded string regardless of media type.
    //    For binary media (image/video/audio) the base64 string goes directly into a data URL.
    //    For text content the base64 string must be decoded once more to recover the original text.
    var content=new TextDecoder().decode(contentBytes);
    var mt=ENC.mediaType;
    if(!mt.startsWith('image/')&&!mt.startsWith('video/')&&!mt.startsWith('audio/')){
      try{
        content=new TextDecoder().decode(b64ToBytes(content));
        console.log('[Hekkova] text content base64-decoded');
      }catch(decodeErr){
        console.warn('[Hekkova] text base64 decode failed, using raw string:', decodeErr);
      }
    }

    // 8. Render decrypted content and swap views
    var contentEl=document.getElementById('mc');
    ${renderContentJS(mediaType)}
    console.log('[Hekkova] content rendered — swapping views');

    document.getElementById('lock-view').style.display='none';
    document.getElementById('open-view').style.display='block';

  }catch(e){
    console.error('[Hekkova] unexpected error in unlock():', e);
    showError('Something went wrong. Please try again.');
    document.getElementById('btn').disabled=false;
  }
}

function toggleVis(){
  var f=document.getElementById('pp');
  var b=document.getElementById('tv');
  if(f.type==='password'){f.type='text';b.textContent='Hide';}
  else{f.type='password';b.textContent='Show';}
}

// Keep on window for console debugging; primary binding is via addEventListener below.
window.unlock=unlock;
window.toggleVis=toggleVis;

document.getElementById('btn').addEventListener('click',unlock);
document.getElementById('pp').addEventListener('keydown',function(e){
  if(e.key==='Enter')unlock();
});
})();`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title.replace(/</g, '&lt;')} \u2014 Hekkova</title>
<style>${css}</style>
</head>
<body>
<div class="wrap">
  <span class="wordmark">Hekkova</span>

  <!-- Lock view: passphrase prompt -->
  <div id="lock-view">
    <div class="card">
      <div class="card-icon">&#x1F319;</div>
      <h2>This moment is private</h2>
      <p>Enter your passphrase to view this memory</p>
      <div class="input-wrap">
        <input type="password" id="pp" placeholder="Your passphrase" autocomplete="current-password" spellcheck="false">
        <button class="toggle-vis" id="tv" type="button" onclick="toggleVis()">Show</button>
      </div>
      <button class="btn" id="btn" type="button">Unlock</button>
      <div class="error" id="err"></div>
    </div>
    ${metaBar}
    <p class="footer">This moment is encrypted and permanently stored on IPFS and the Polygon blockchain.</p>
  </div>

  <!-- Open view: decrypted content -->
  <div id="open-view" style="display:none">
    <div class="moment">
      <h1>${title.replace(/</g, '&lt;')}</h1>
      <div class="moment-content" id="mc"></div>
    </div>
    ${metaBar}
    <p class="footer">This moment is encrypted and permanently stored on IPFS and the Polygon blockchain.</p>
  </div>
</div>
<script>${decryptJS}</script>
</body>
</html>`;
}
