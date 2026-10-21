/* Work-card videos: progressive enhancement over the card image, no dependencies.
   Usage on any .project-media (or other wrapper holding the <img>):
     data-video="images/work/x.mp4"            required, H.264 MP4 (plays everywhere)
     data-video-webm="images/work/x.webm"      optional, tried first (AV1 WebM by default)
     data-video-webm-type='video/webm; codecs="vp9"'   optional, only if the WebM isn't AV1
     data-poster="images/work/x-poster.webp"   optional
   The image stays until the video is actually playing, then crossfades (CSS .is-playing).
   Nothing loads until the card is ~200px from the viewport; it pauses offscreen.
   Skipped entirely for prefers-reduced-motion, Save-Data, or no IntersectionObserver. */
(function () {
    var cards = document.querySelectorAll('[data-video]');
    if (!cards.length || !('IntersectionObserver' in window)) return;
    var rm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
    var conn = navigator.connection;
    if ((rm && rm.matches) || (conn && conn.saveData)) return;

    function attr(v, name, val) { v.setAttribute(name, val); }

    function build(el) {
        var v = document.createElement('video');
        v.muted = true; v.defaultMuted = true; v.loop = true; v.playsInline = true;
        attr(v, 'muted', ''); attr(v, 'loop', ''); attr(v, 'playsinline', ''); attr(v, 'webkit-playsinline', '');
        attr(v, 'disablepictureinpicture', ''); attr(v, 'disableremoteplayback', '');
        attr(v, 'controlslist', 'nodownload noremoteplayback nofullscreen');
        attr(v, 'aria-hidden', 'true'); attr(v, 'tabindex', '-1');
        attr(v, 'preload', 'none');
        if (el.dataset.poster) attr(v, 'poster', el.dataset.poster);
        var img = el.querySelector('img');
        if (img) v.style.objectPosition = getComputedStyle(img).objectPosition;   // same crop as the image
        var list = [];
        if (el.dataset.videoWebm) list.push([el.dataset.videoWebm, el.dataset.videoWebmType || 'video/webm; codecs="av01.0.05M.08"']);
        list.push([el.dataset.video, 'video/mp4; codecs="avc1.64001F"']);
        list.forEach(function (s) {
            var src = document.createElement('source');
            src.src = s[0]; src.type = s[1];
            v.appendChild(src);
        });
        var fail = function () { el.classList.remove('is-playing'); el.dataset.videoState = 'failed'; v.remove(); };
        var last = v.lastElementChild;
        last.addEventListener('error', fail);          // all sources failed
        v.addEventListener('error', fail);
        v.addEventListener('playing', function () { el.classList.add('is-playing'); });
        el.appendChild(v);
        return v;
    }

    function play(el) {
        if (el.dataset.videoState === 'failed') return;
        var v = el._cardVideo || (el._cardVideo = build(el));
        if (v.getAttribute('preload') === 'none') { attr(v, 'preload', 'auto'); attr(v, 'autoplay', ''); v.load(); }
        var p = v.play();
        if (p && p.catch) p.catch(function () { /* autoplay refused: keep the image */ });
    }

    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
            var el = e.target;
            if (e.isIntersecting) play(el);
            else if (el._cardVideo && !el._cardVideo.paused) el._cardVideo.pause();
        });
    }, { rootMargin: '200px 0px' });

    for (var i = 0; i < cards.length; i++) io.observe(cards[i]);
})();
