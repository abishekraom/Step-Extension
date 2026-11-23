(function() {
    console.log('[StepExt] Virtual Microphone Hook Injected');

    // ── API RESPONSE MIRROR ─────────────────────────────────────────────────
    // v4 calls api.steptest.in/v1/... through axios, which uses XHR in the
    // browser. Mirror fetchattempt/submitAnswer JSON into the content script so
    // the overlay can show answers even though window.fetch is not used.
    const STEP_API_PATTERN = /\/v1\/(fetchattempt|submitAnswer)\b/i;

    function publishApiPayload(url, payload) {
        if (!payload || typeof payload !== 'object') return;
        window.postMessage({
            type: 'STEP_EXT_API_DATA',
            url: String(url || ''),
            payload,
        }, '*');
    }

    function readXhrPayload(xhr) {
        try {
            if (xhr.responseType === 'json') return xhr.response;
            if (xhr.responseType === '' || xhr.responseType === 'text') {
                return xhr.responseText ? JSON.parse(xhr.responseText) : null;
            }
        } catch (error) {
            console.warn('[StepExt] Could not parse XHR payload:', error);
        }
        return null;
    }

    const originalXhrOpen = XMLHttpRequest.prototype.open;
    const originalXhrSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
        this.__stepExtUrl = typeof url === 'string' ? url : String(url || '');
        return originalXhrOpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function(...args) {
        if (STEP_API_PATTERN.test(this.__stepExtUrl || '')) {
            this.addEventListener('load', () => {
                publishApiPayload(this.__stepExtUrl, readXhrPayload(this));
            });
        }
        return originalXhrSend.apply(this, args);
    };

    const originalFetch = window.fetch.bind(window);
    window.fetch = async function(...args) {
        const response = await originalFetch(...args);
        const requestUrl = typeof args[0] === 'string' ? args[0] : args[0]?.url;
        if (STEP_API_PATTERN.test(requestUrl || '')) {
            response.clone().json()
                .then(payload => publishApiPayload(requestUrl, payload))
                .catch(error => console.warn('[StepExt] Could not parse fetch payload:', error));
        }
        return response;
    };

    // Read URL from the script tag attribute (set by content.js)
    const scriptTag = document.currentScript || Array.from(document.querySelectorAll('script')).find(s => s.src.includes('inject.js'));
    const AUDIO_URL = scriptTag ? scriptTag.dataset.voiceUrl : '';
    
    let audioContext = null;
    let audioStream = null;
    let audioElement = null;

    // Override getUserMedia
    const originalGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);

    navigator.mediaDevices.getUserMedia = async function(constraints) {
        if (constraints.audio) {
            console.log('[StepExt] Intercepting getUserMedia for virtual audio');
            
            if (!audioContext) {
                audioContext = new (window.AudioContext || window.webkitAudioContext)();
                audioElement = new Audio(AUDIO_URL);
                audioElement.crossOrigin = "anonymous";
                
                const source = audioContext.createMediaElementSource(audioElement);
                const destination = audioContext.createMediaStreamDestination();
                source.connect(destination);
                source.connect(audioContext.destination); // Optional: play locally too
                
                audioStream = destination.stream;
            }

            return audioStream;
        }
        return originalGetUserMedia(constraints);
    };

    // Listen for control messages from content script
    window.addEventListener('message', (event) => {
        if (event.data.type === 'STEP_EXT_VIRTUAL_MIC') {
            const action = event.data.action;
            console.log('[StepExt] Virtual Mic Action:', action);

            if (action === 'PLAY' && audioElement) {
                audioContext.resume().then(() => {
                    audioElement.currentTime = 0;
                    audioElement.play();
                    
                    // Notify content script of duration
                    audioElement.onloadedmetadata = () => {
                        window.postMessage({ 
                            type: 'STEP_EXT_VIRTUAL_MIC_INFO', 
                            duration: audioElement.duration 
                        }, '*');
                    };
                    // In case already loaded
                    if (audioElement.duration) {
                        window.postMessage({ 
                            type: 'STEP_EXT_VIRTUAL_MIC_INFO', 
                            duration: audioElement.duration 
                        }, '*');
                    }
                });
            } else if (action === 'STOP' && audioElement) {
                audioElement.pause();
                audioElement.currentTime = 0;
            }
        }
    });
})();
