// Model configurations for different providers
const MODEL_CONFIGS = {
    openai: [
        { value: 'gpt-4o', label: 'GPT-4o' },
        { value: 'gpt-4o-mini', label: 'GPT-4o Mini' },
        { value: 'gpt-3.5-turbo', label: 'GPT-3.5 Turbo' }
    ],
    gemini: [
        { value: 'gemini-1.5-pro', label: 'Gemini 1.5 Pro' },
        { value: 'gemini-1.5-flash', label: 'Gemini 1.5 Flash' },
        { value: 'gemini-pro', label: 'Gemini Pro' }
    ],
    anthropic: [
        { value: 'claude-3-5-sonnet-20241022', label: 'Claude 3.5 Sonnet' },
        { value: 'claude-3-haiku-20240307', label: 'Claude 3 Haiku' },
        { value: 'claude-3-opus-20240229', label: 'Claude 3 Opus' }
    ]
};

// DOM elements
let modelProviderSelect;
let modelSelectionSelect;
let apiKeyTextarea;
let testConnectionBtn;
let saveSettingsBtn;
let statusMessage;
let settingsForm;

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
    initializeElements();
    setupEventListeners();
    await loadSavedSettings();
});

/**
 * Initialize DOM element references
 */
function initializeElements() {
    modelProviderSelect = document.getElementById('model-provider');
    modelSelectionSelect = document.getElementById('model-selection');
    apiKeyTextarea = document.getElementById('api-key');
    testConnectionBtn = document.getElementById('test-connection');
    saveSettingsBtn = document.getElementById('save-settings');
    statusMessage = document.getElementById('status-message');
    settingsForm = document.getElementById('settings-form');
}

/**
 * Setup event listeners for form interactions
 */
function setupEventListeners() {
    // Model provider change handler
    modelProviderSelect.addEventListener('change', handleProviderChange);
    
    // Test connection button
    testConnectionBtn.addEventListener('click', handleTestConnection);
    
    // Form submission
    settingsForm.addEventListener('submit', handleSaveSettings);
    
    // Clear status message when user starts typing
    apiKeyTextarea.addEventListener('input', clearStatusMessage);
    modelProviderSelect.addEventListener('change', clearStatusMessage);
    modelSelectionSelect.addEventListener('change', clearStatusMessage);
}

/**
 * Handle provider selection change
 */
function handleProviderChange() {
    const selectedProvider = modelProviderSelect.value;
    updateModelSelection(selectedProvider);
}

/**
 * Update model selection dropdown based on provider
 */
function updateModelSelection(provider) {
    // Clear existing options
    modelSelectionSelect.innerHTML = '<option value="">Select Model</option>';
    
    if (provider && MODEL_CONFIGS[provider]) {
        MODEL_CONFIGS[provider].forEach(model => {
            const option = document.createElement('option');
            option.value = model.value;
            option.textContent = model.label;
            modelSelectionSelect.appendChild(option);
        });
        modelSelectionSelect.disabled = false;
    } else {
        modelSelectionSelect.disabled = true;
    }
}

/**
 * Load saved settings from Chrome storage
 */
async function loadSavedSettings() {
    try {
        const result = await chrome.storage.sync.get(['modelProvider', 'modelSelection', 'apiKey']);
        
        if (result.modelProvider) {
            modelProviderSelect.value = result.modelProvider;
            updateModelSelection(result.modelProvider);
            
            if (result.modelSelection) {
                modelSelectionSelect.value = result.modelSelection;
            }
        }
        
        if (result.apiKey) {
            apiKeyTextarea.value = result.apiKey;
        }
    } catch (error) {
        console.error('Error loading settings:', error);
        showStatusMessage('Error loading saved settings', 'error');
    }
}

/**
 * Handle test connection button click
 */
async function handleTestConnection() {
    const provider = modelProviderSelect.value;
    const model = modelSelectionSelect.value;
    const apiKey = apiKeyTextarea.value.trim();
    
    if (!provider || !model || !apiKey) {
        showStatusMessage('Please fill in all fields before testing', 'error');
        return;
    }
    
    setButtonLoading(testConnectionBtn, true);
    
    try {
        // Send message to background script to test connection
        const response = await chrome.runtime.sendMessage({
            type: 'testConnection',
            provider: provider,
            model: model,
            apiKey: apiKey
        });
        
        if (response.success) {
            showStatusMessage('Connection successful!', 'success');
        } else {
            showStatusMessage(`Connection failed: ${response.error}`, 'error');
        }
    } catch (error) {
        console.error('Test connection error:', error);
        showStatusMessage('Error testing connection', 'error');
    } finally {
        setButtonLoading(testConnectionBtn, false);
    }
}

/**
 * Handle save settings form submission
 */
async function handleSaveSettings(event) {
    event.preventDefault();
    
    const provider = modelProviderSelect.value;
    const model = modelSelectionSelect.value;
    const apiKey = apiKeyTextarea.value.trim();
    
    if (!provider || !model || !apiKey) {
        showStatusMessage('Please fill in all fields', 'error');
        return;
    }
    
    setButtonLoading(saveSettingsBtn, true);
    
    try {
        await chrome.storage.sync.set({
            modelProvider: provider,
            modelSelection: model,
            apiKey: apiKey
        });
        
        showStatusMessage('Settings saved successfully!', 'success');
        
        // Close popup after a short delay
        setTimeout(() => {
            window.close();
        }, 1500);
        
    } catch (error) {
        console.error('Error saving settings:', error);
        showStatusMessage('Error saving settings', 'error');
    } finally {
        setButtonLoading(saveSettingsBtn, false);
    }
}

/**
 * Show status message with specified type
 */
function showStatusMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
    statusMessage.style.display = 'block';
    
    // Auto-hide success messages after 3 seconds
    if (type === 'success') {
        setTimeout(() => {
            statusMessage.style.display = 'none';
        }, 3000);
    }
}

/**
 * Clear status message
 */
function clearStatusMessage() {
    statusMessage.style.display = 'none';
}

/**
 * Set button loading state
 */
function setButtonLoading(button, loading) {
    if (loading) {
        button.classList.add('loading');
        button.disabled = true;
    } else {
        button.classList.remove('loading');
        button.disabled = false;
    }
}

