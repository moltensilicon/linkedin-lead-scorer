// Content script for LinkedIn Lead Scorer
// Monitors LinkedIn invitation manager page and scores connection requests

// Configuration
const SELECTORS = {
    invitationCard: '.invitation-card, [data-test-invitation-card], .artdeco-entity-lockup',
    invitationList: '.invitation-manager-list, [data-test-invitation-manager-list]',
    profileImage: 'img[alt*="profile"], .presence-entity__image img, .artdeco-entity-lockup__image img',
    acceptButton: '[data-control-name="accept"], .artdeco-button--primary',
    cardContent: '.artdeco-entity-lockup__content, .invitation-card__content'
};

// Track processed cards to avoid duplicate scoring
const processedCards = new Set();

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
} else {
    initialize();
}

/**
 * Initialize the content script
 */
function initialize() {
    console.log('LinkedIn Lead Scorer: Initializing content script');
    
    // Check if we're on the correct page
    if (!isInvitationManagerPage()) {
        console.log('LinkedIn Lead Scorer: Not on invitation manager page');
        return;
    }
    
    // Process existing invitation cards
    processExistingCards();
    
    // Set up observer for dynamically loaded content
    setupMutationObserver();
    
    console.log('LinkedIn Lead Scorer: Content script initialized');
}

/**
 * Check if current page is the invitation manager
 */
function isInvitationManagerPage() {
    return window.location.href.includes('/mynetwork/invitation-manager/received');
}

/**
 * Process invitation cards that are already on the page
 */
function processExistingCards() {
    const cards = findInvitationCards();
    console.log(`LinkedIn Lead Scorer: Found ${cards.length} existing invitation cards`);
    
    cards.forEach(card => {
        if (!isCardProcessed(card)) {
            processInvitationCard(card);
        }
    });
}

/**
 * Set up MutationObserver to watch for new invitation cards
 */
function setupMutationObserver() {
    const observer = new MutationObserver((mutations) => {
        let newCardsFound = false;
        
        mutations.forEach((mutation) => {
            mutation.addedNodes.forEach((node) => {
                if (node.nodeType === Node.ELEMENT_NODE) {
                    // Check if the added node is an invitation card
                    if (isInvitationCard(node)) {
                        if (!isCardProcessed(node)) {
                            processInvitationCard(node);
                            newCardsFound = true;
                        }
                    }
                    
                    // Check if the added node contains invitation cards
                    const cards = node.querySelectorAll ? 
                        Array.from(node.querySelectorAll(SELECTORS.invitationCard)) : [];
                    
                    cards.forEach(card => {
                        if (!isCardProcessed(card)) {
                            processInvitationCard(card);
                            newCardsFound = true;
                        }
                    });
                }
            });
        });
        
        if (newCardsFound) {
            console.log('LinkedIn Lead Scorer: Processed new invitation cards');
        }
    });
    
    // Start observing
    observer.observe(document.body, {
        childList: true,
        subtree: true
    });
    
    console.log('LinkedIn Lead Scorer: MutationObserver set up');
}

/**
 * Find all invitation cards on the page
 */
function findInvitationCards() {
    const cards = [];
    
    // Try multiple selectors to find invitation cards
    Object.values(SELECTORS.invitationCard.split(', ')).forEach(selector => {
        const foundCards = document.querySelectorAll(selector);
        foundCards.forEach(card => {
            if (!cards.includes(card) && isValidInvitationCard(card)) {
                cards.push(card);
            }
        });
    });
    
    return cards;
}

/**
 * Check if an element is an invitation card
 */
function isInvitationCard(element) {
    return SELECTORS.invitationCard.split(', ').some(selector => 
        element.matches && element.matches(selector)
    ) && isValidInvitationCard(element);
}

/**
 * Validate that this is actually an invitation card with relevant content
 */
function isValidInvitationCard(card) {
    // Must have some text content
    const text = card.textContent.trim();
    if (!text || text.length < 10) return false;
    
    // Should not already have a score
    if (card.querySelector('.lead-scorer-badge')) return false;
    
    // Should contain typical invitation card elements
    const hasAcceptButton = card.querySelector(SELECTORS.acceptButton);
    const hasProfileContent = card.querySelector(SELECTORS.cardContent) || 
                             text.includes('mutual connection') || 
                             text.includes('connection');
    
    return hasAcceptButton || hasProfileContent;
}

/**
 * Check if a card has already been processed
 */
function isCardProcessed(card) {
    const cardId = getCardId(card);
    return processedCards.has(cardId) || card.querySelector('.lead-scorer-badge');
}

/**
 * Generate a unique ID for a card based on its content
 */
function getCardId(card) {
    const text = card.textContent.trim();
    const hash = text.substring(0, 100); // Use first 100 chars as identifier
    return btoa(hash).replace(/[^a-zA-Z0-9]/g, '').substring(0, 20);
}

/**
 * Process an individual invitation card
 */
async function processInvitationCard(card) {
    const cardId = getCardId(card);
    
    try {
        // Mark as processed immediately to prevent duplicate processing
        processedCards.add(cardId);
        
        // Extract profile data from the card
        const profileData = extractProfileData(card);
        
        if (!profileData.text || profileData.text.length < 10) {
            console.log('LinkedIn Lead Scorer: Insufficient profile data, skipping card');
            return;
        }
        
        // Add loading indicator
        const loadingBadge = createLoadingBadge();
        insertScoreBadge(card, loadingBadge);
        
        // Send profile data to background script for scoring
        const response = await chrome.runtime.sendMessage({
            type: 'scoreProfile',
            profileData: profileData
        });
        
        // Remove loading indicator
        loadingBadge.remove();
        
        if (response.success) {
            // Create and insert score badge
            const scoreBadge = createScoreBadge(response.score, response.reasoning);
            insertScoreBadge(card, scoreBadge);
            
            console.log(`LinkedIn Lead Scorer: Scored profile - Score: ${response.score}`);
        } else {
            // Show error badge
            const errorBadge = createErrorBadge(response.error);
            insertScoreBadge(card, errorBadge);
            
            console.error('LinkedIn Lead Scorer: Scoring failed:', response.error);
        }
        
    } catch (error) {
        console.error('LinkedIn Lead Scorer: Error processing card:', error);
        
        // Remove loading badge if it exists
        const existingBadge = card.querySelector('.lead-scorer-badge');
        if (existingBadge) {
            existingBadge.remove();
        }
        
        // Show error badge
        const errorBadge = createErrorBadge('Processing failed');
        insertScoreBadge(card, errorBadge);
    }
}

/**
 * Extract profile data from invitation card
 */
function extractProfileData(card) {
    // Get all text content from the card
    const textContent = card.textContent.trim();
    
    // Check for profile image
    const profileImg = card.querySelector(SELECTORS.profileImage);
    const hasProfilePic = profileImg && 
                         !profileImg.src.includes('ghost-person') && 
                         !profileImg.src.includes('default-avatar') &&
                         !profileImg.alt.toLowerCase().includes('default');
    
    // Clean up the text content
    const cleanedText = textContent
        .replace(/\s+/g, ' ')
        .replace(/\n+/g, '\n')
        .trim();
    
    return {
        text: cleanedText,
        hasProfilePic: hasProfilePic
    };
}

/**
 * Create loading badge element
 */
function createLoadingBadge() {
    const badge = document.createElement('div');
    badge.className = 'lead-scorer-badge lead-scorer-loading';
    badge.innerHTML = `
        <div class="lead-scorer-spinner"></div>
        <span>Scoring...</span>
    `;
    return badge;
}

/**
 * Create score badge element
 */
function createScoreBadge(score, reasoning) {
    const badge = document.createElement('div');
    badge.className = `lead-scorer-badge lead-scorer-score ${getScoreClass(score)}`;
    badge.title = reasoning;
    
    badge.innerHTML = `
        <div class="lead-scorer-score-value">${score}</div>
        <div class="lead-scorer-label">Lead Score</div>
    `;
    
    return badge;
}

/**
 * Create error badge element
 */
function createErrorBadge(error) {
    const badge = document.createElement('div');
    badge.className = 'lead-scorer-badge lead-scorer-error';
    badge.title = error;
    
    badge.innerHTML = `
        <div class="lead-scorer-error-icon">!</div>
        <div class="lead-scorer-label">Error</div>
    `;
    
    return badge;
}

/**
 * Get CSS class based on score value
 */
function getScoreClass(score) {
    if (score >= 20) return 'score-excellent';
    if (score >= 10) return 'score-good';
    if (score >= 5) return 'score-fair';
    if (score >= 0) return 'score-poor';
    return 'score-negative';
}

/**
 * Insert score badge into invitation card
 */
function insertScoreBadge(card, badge) {
    // Try to find the best location for the badge
    let insertLocation = null;
    
    // Look for accept button first
    const acceptButton = card.querySelector(SELECTORS.acceptButton);
    if (acceptButton) {
        insertLocation = acceptButton.parentElement;
    }
    
    // Fall back to card content area
    if (!insertLocation) {
        insertLocation = card.querySelector(SELECTORS.cardContent) || card;
    }
    
    // Insert the badge
    if (insertLocation) {
        insertLocation.appendChild(badge);
    } else {
        card.appendChild(badge);
    }
}

// Handle extension updates/reloads
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.type === 'extensionReloaded') {
        // Clear processed cards cache and re-process
        processedCards.clear();
        processExistingCards();
    }
});

