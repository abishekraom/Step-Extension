(function() {
    console.log('[StepExt] Virtual Microphone Hook Injected');

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
