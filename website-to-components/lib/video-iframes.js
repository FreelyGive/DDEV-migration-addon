/**
 * Replace YouTube <iframe> embeds with their real poster image before capture.
 *
 * Why this exists: YouTube throttles poster rendering for off-screen and
 * automated iframes, so a full-page screenshot captures blank video boxes —
 * dwelling on each iframe only reliably paints the first. The robust fix is to
 * not rely on YouTube painting the iframe at all: extract the video ID from the
 * embed URL and swap in the static poster from YouTube's CDN
 * (https://img.youtube.com/vi/<id>/maxresdefault.jpg, falling back to
 * hqdefault.jpg), wrapped in a play-button overlay so it still reads as a video.
 *
 * Returns the number of iframes swapped (so callers can decide whether to wait
 * for poster <img> load).
 */

import { spawnSync } from "child_process";

function evalIn(browserEval, js) {
  return browserEval(js);
}

/**
 * Swap every youtube.com/embed/<id> iframe for a CDN poster image + play overlay.
 *
 * @param {(js: string) => string} browserEval - runs JS in the live page, returns stringified result
 * @returns {number} count of iframes replaced
 */
export function swapYouTubeIframesForPosters(browserEval) {
  // Build the replacement DOM in-page. We keep the original iframe's box size
  // so the page layout (and section geometry) is unchanged.
  const countStr = evalIn(browserEval, `(() => {
    const iframes = [...document.querySelectorAll('iframe[src*="youtube.com/embed/"], iframe[src*="youtube-nocookie.com/embed/"]')];
    let swapped = 0;
    for (const iframe of iframes) {
      const src = iframe.getAttribute('src') || '';
      // /embed/<id> — id is 11 chars but be permissive; strip query/hash.
      const m = src.match(/\\/embed\\/([^?&#/]+)/);
      if (!m) continue;
      const id = m[1];

      const rect = iframe.getBoundingClientRect();
      const w = Math.round(rect.width) || iframe.clientWidth || 560;
      const h = Math.round(rect.height) || iframe.clientHeight || 315;

      const wrap = document.createElement('div');
      wrap.style.position = 'relative';
      wrap.style.width = (iframe.style.width || w + 'px');
      wrap.style.height = (iframe.style.height || h + 'px');
      wrap.style.overflow = 'hidden';
      wrap.className = iframe.className;

      const img = document.createElement('img');
      img.setAttribute('data-yt-poster', id);
      img.src = 'https://img.youtube.com/vi/' + id + '/maxresdefault.jpg';
      img.style.width = '100%';
      img.style.height = '100%';
      img.style.objectFit = 'cover';
      img.style.display = 'block';
      // maxresdefault is missing for some videos. YouTube serves the miss two
      // ways: a 404 (fires onerror) OR a 120x90 grey placeholder with HTTP 200
      // (fires onload, no error). Handle BOTH — fall back to hqdefault, which
      // always exists.
      const fallBack = function () {
        if (!img.dataset.fellBack) {
          img.dataset.fellBack = '1';
          img.src = 'https://img.youtube.com/vi/' + id + '/hqdefault.jpg';
        }
      };
      img.onerror = fallBack;
      img.onload = function () {
        // The grey "no thumbnail" placeholder is 120x90.
        if (img.naturalWidth <= 120 && img.naturalHeight <= 90) fallBack();
      };

      const play = document.createElement('div');
      play.style.position = 'absolute';
      play.style.top = '50%';
      play.style.left = '50%';
      play.style.transform = 'translate(-50%, -50%)';
      play.style.width = '68px';
      play.style.height = '48px';
      play.style.borderRadius = '14px';
      play.style.background = 'rgba(33,33,33,0.85)';
      play.style.display = 'flex';
      play.style.alignItems = 'center';
      play.style.justifyContent = 'center';
      play.innerHTML = '<div style="width:0;height:0;border-style:solid;border-width:11px 0 11px 19px;border-color:transparent transparent transparent #fff;margin-left:4px;"></div>';

      wrap.appendChild(img);
      wrap.appendChild(play);
      iframe.replaceWith(wrap);
      swapped++;
    }
    return String(swapped);
  })()`);

  return parseInt(countStr, 10) || 0;
}

/**
 * Wait until every swapped YouTube poster <img> has loaded (or times out).
 * Bounded so a missing/slow CDN poster can't hang the run.
 *
 * @param {(js: string) => string} browserEval
 * @param {number} [timeoutMs]
 */
export function waitForYouTubePosters(browserEval, timeoutMs = 8000) {
  const fn =
    "[...document.querySelectorAll('img[data-yt-poster]')].every(img => img.complete && img.naturalWidth > 0)";
  const result = spawnSync(
    "agent-browser",
    ["wait", "--fn", fn, "--timeout", String(timeoutMs)],
    { stdio: "pipe", encoding: "utf8" },
  );
  if (result.status !== 0) {
    console.log("YouTube poster wait timed out — continuing (some posters may be slow).");
  }
}

/**
 * Convenience: swap all YouTube iframes for posters and wait for them to load.
 * @param {(js: string) => string} browserEval
 * @returns {number} count swapped
 */
export function paintVideoIframes(browserEval) {
  const swapped = swapYouTubeIframesForPosters(browserEval);
  if (swapped > 0) {
    console.log(`Swapped ${swapped} YouTube iframe(s) for CDN poster image(s).`);
    waitForYouTubePosters(browserEval);
  }
  return swapped;
}
