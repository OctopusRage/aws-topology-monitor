// Generate a strong random password with the Web Crypto API. Ambiguous glyphs
// (l/1/I, O/0) are excluded so it's safe to read out / copy. Guarantees at least
// one lowercase, uppercase, digit and symbol.
const SETS = {
  lower: 'abcdefghijkmnpqrstuvwxyz',
  upper: 'ABCDEFGHJKLMNPQRSTUVWXYZ',
  digit: '23456789',
  symbol: '!@#$%^&*-_=+?',
};

function randInt(max) {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0] % max;
}

const pick = (chars) => chars[randInt(chars.length)];

export function generatePassword(length = 16) {
  const all = Object.values(SETS).join('');
  const out = [pick(SETS.lower), pick(SETS.upper), pick(SETS.digit), pick(SETS.symbol)];
  while (out.length < length) out.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed chars aren't always at the front.
  for (let i = out.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out.join('');
}

export async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    /* fall through */
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}
