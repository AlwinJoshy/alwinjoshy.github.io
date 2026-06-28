document.addEventListener("DOMContentLoaded", () => {
    const track = document.getElementById('portfolioTrack');
    const prevBtn = document.getElementById('prevBtn');
    const nextBtn = document.getElementById('nextBtn');
    let workItems = document.querySelectorAll('.work, .blog-display');

    if (!track || workItems.length === 0) return;

    // 1. Clone cards to create a seamless infinite track loop
    const visibleItems = 3; 
    
    // Clone the first few items and append them to the end
    for (let i = 0; i < visibleItems; i++) {
        const clone = workItems[i].cloneNode(true);
        track.appendChild(clone);
    }
    
    // Re-select work items to include the new clones
    workItems = document.querySelectorAll('.work, .blog-display');
    
    let currentIndex = 0;
    const totalItems = workItems.length - visibleItems; // original items count
    let autoPlayTimer = null;
    let isTransitioning = false;

    function updateCarousel(immediate = false) {
        const itemWidth = workItems[0].getBoundingClientRect().width;
        const gap = 20; 
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
       
        

        // If we reach the clone, seamlessly jump back to the true start after the slide animation finishes
        if (currentIndex >= totalItems - (visibleItems + 1)) {
            setTimeout(() => {
                currentIndex = 0;
                updateCarousel(true); // Jump instantly with no transition animation
                // isTransitioning = false;
            }, 500); // Matches the 0.5s CSS transition time
        }
        
        updateCarousel();
        setTimeout(() => { isTransitioning = false; }, 500);
        
    }

    function handlePrev() {
        if (isTransitioning) return;
        isTransitioning = true;

         console.log("moved id : " + currentIndex.toString());

        if (currentIndex <= 0) {
            // Instantly jump to the end clone position, then slide backwards to the last real item
            currentIndex = totalItems - visibleItems - 1;
            updateCarousel(true);
            // Small timeout allows the browser to register the instant jump before animating
            setTimeout(() => {
                currentIndex--;
                updateCarousel();
                setTimeout(() => { isTransitioning = false; }, 500);
            }, 20);
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

    // Initialize layout setup
    updateCarousel();
    startAutoPlay();
});