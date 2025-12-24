// Lightbox functionality for captioned images
(function () {
    'use strict';

    let overlay = null;

    function createOverlay() {
        if (overlay) return overlay;

        overlay = document.createElement('div');
        overlay.id = 'lightbox-overlay';
        overlay.className = 'lightbox-overlay';
        overlay.innerHTML = '<span class="lightbox-close">&times;</span><img src="" alt="">';
        document.body.appendChild(overlay);

        // Close on overlay click
        overlay.addEventListener('click', function (e) {
            if (e.target === overlay || e.target.className === 'lightbox-close') {
                closeLightbox();
            }
        });

        // Close on Escape key
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && overlay.classList.contains('active')) {
                closeLightbox();
            }
        });

        return overlay;
    }

    function openLightbox(img) {
        const overlay = createOverlay();
        const overlayImg = overlay.querySelector('img');
        overlayImg.src = img.src;
        overlayImg.alt = img.alt;
        overlay.classList.add('active');
    }

    function closeLightbox() {
        if (overlay) {
            overlay.classList.remove('active');
        }
    }

    // Initialize on DOM ready
    function init() {
        const images = document.querySelectorAll('.lightbox-trigger');
        images.forEach(function (img) {
            img.addEventListener('click', function () {
                openLightbox(this);
            });
        });
    }

    // Run on DOM ready
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

    // Re-run when new content is added (for dynamic content)
    if (typeof MutationObserver !== 'undefined') {
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                mutation.addedNodes.forEach(function (node) {
                    if (node.nodeType === 1 && node.classList && node.classList.contains('lightbox-trigger')) {
                        node.addEventListener('click', function () {
                            openLightbox(this);
                        });
                    }
                });
            });
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }
})();
