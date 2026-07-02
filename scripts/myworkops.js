document.addEventListener("DOMContentLoaded", () => {
    const track = document.getElementById('portfolioTrack');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    
    if (!track) return;

    // 1. Remove any stale clones from the previous run/reload first
    const existingClones = track.querySelectorAll('.carousel-clone');
    existingClones.forEach(clone => clone.remove());

    // 2. Select only true, original items now that track is clean
    let workItems = track.querySelectorAll('.work, .blog-display');
    if (workItems.length === 0) return;

    const visibleItems = 3; 
    
    // 3. Clone the first 3 items and mark them with a class name
    for (let i = 0; i < visibleItems; i++) {
        if (!workItems[i]) break;
        const clone = workItems[i].cloneNode(true);
        clone.classList.add('carousel-clone'); // Explicitly flag it as a clone
        track.appendChild(clone);
    }
    
    // 4. Re-select everything to calculate the final infinite track length
    workItems = track.querySelectorAll('.work, .blog-display');
    
    let currentIndex = 0;
    const totalItems = workItems.length - visibleItems; // This will now consistently equal your true original count
    let autoPlayTimer = null;
    let isTransitioning = false;

    function updateCarousel(immediate = false) {
        const itemWidth = workItems[0].getBoundingClientRect().width;
        const gap = 40; 
        const moveAmount = (itemWidth + gap) * currentIndex;
        
        if (immediate) {
            track.style.transition = 'none';
        } else {
            track.style.transition = 'transform 0.5s ease-in-out';
        }
        
        track.style.transform = `translateX(-${moveAmount}px)`;
    }

    function handleNext() {
        if (isTransitioning) return;
        isTransitioning = true;
        currentIndex++;
        updateCarousel();

        if (currentIndex >= totalItems) {
            setTimeout(() => {
                currentIndex = 0;
                updateCarousel(true);
                isTransitioning = false;
            }, 500);
        } else {
            setTimeout(() => { isTransitioning = false; }, 500);
        }
    }

    function handlePrev() {
        if (isTransitioning) return;
        isTransitioning = true;

        if (currentIndex <= 0) {
            currentIndex = totalItems;
            updateCarousel(true);
            setTimeout(() => {
                updateCarousel();
                setTimeout(() => { isTransitioning = false; }, 500);
            }, 20);
            
            currentIndex = totalItems - 1;
            updateCarousel();
        } else {
            currentIndex--;
            updateCarousel();
            setTimeout(() => { isTransitioning = false; }, 500);
        }
    }

    function startAutoPlay() {
        stopAutoPlay();
        autoPlayTimer = setInterval(handleNext, 3000);
    }

    function stopAutoPlay() {
        if (autoPlayTimer) clearInterval(autoPlayTimer);
    }

    nextBtn.addEventListener('click', () => {
        handleNext();
        startAutoPlay();
    });

    prevBtn.addEventListener('click', () => {
        handlePrev();
        startAutoPlay();
    });

    track.addEventListener('mouseenter', stopAutoPlay);
    track.addEventListener('mouseleave', startAutoPlay);

    updateCarousel();
    startAutoPlay();
});